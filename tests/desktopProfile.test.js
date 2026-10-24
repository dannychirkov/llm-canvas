const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const { randomBytes, createCipheriv, createDecipheriv } = require("node:crypto")
const { loadAuthSecret } = require("../desktop/profile.cjs")

const failure = { message: "Unable to load desktop authentication secret" }

test("missing secret beside existing desktop data fails without generating a replacement", async t => {
  const { profile, filename } = await fixture(t)
  const directory = path.join(profile, "data", "prisma")
  await fs.mkdir(directory, { recursive: true })
  const database = path.join(directory, "dev.db")
  await fs.writeFile(database, "existing private database")
  const safeStorage = storage()
  await assert.rejects(loadAuthSecret(profile, safeStorage), failure)
  await assert.rejects(fs.access(filename))
  assert.equal(safeStorage.calls.encrypt, 0)
  assert.equal(await fs.readFile(database, "utf8"), "existing private database")
})

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "desktop-profile-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const profile = path.join(root, "profile")
  return { root, profile, filename: path.join(profile, "auth-secret.bin") }
}

// Exercise real non-plaintext bytes and authentication failures without Electron.
function storage() {
  const key = randomBytes(32)
  const calls = { encrypt: 0, decrypt: 0 }
  const api = {
    calls,
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptStringAsync: async secret => {
      calls.encrypt++
      const iv = randomBytes(12)
      const cipher = createCipheriv("aes-256-gcm", key, iv)
      const bytes = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), bytes])
    },
    decryptStringAsync: async encrypted => {
      calls.decrypt++
      const decipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(0, 12))
      decipher.setAuthTag(encrypted.subarray(12, 28))
      return { result: Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString("utf8"), shouldReEncrypt: false }
    },
    isEncryptionAvailable: () => assert.fail("The parent owns synchronous initialization"),
    encryptString: () => assert.fail("Encryption must be asynchronous"),
    decryptString: () => assert.fail("Decryption must be asynchronous"),
  }
  return api
}

test("profile creates a private encrypted secret and preserves it across restarts", async t => {
  const { profile, filename } = await fixture(t)
  const safeStorage = storage()
  const secret = await loadAuthSecret(profile, safeStorage)
  assert.match(secret, /^[0-9a-f]{64}$/)
  const encrypted = await fs.readFile(filename)
  assert.equal(encrypted.includes(Buffer.from(secret)), false)
  assert.equal((await safeStorage.decryptStringAsync(encrypted)).result, secret)
  // Reload the module as well as calling the loader again: no in-memory cache.
  delete require.cache[require.resolve("../desktop/profile.cjs")]
  assert.equal(await require("../desktop/profile.cjs").loadAuthSecret(profile, safeStorage), secret)
  assert.deepEqual(await fs.readFile(filename), encrypted)
  assert.equal(safeStorage.calls.encrypt, 1)
  assert.deepEqual(await fs.readdir(profile), ["auth-secret.bin"])
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(profile)).mode & 0o777, 0o700)
    assert.equal((await fs.stat(filename)).mode & 0o777, 0o600)
    await fs.chmod(profile, 0o755)
    await fs.chmod(filename, 0o644)
    assert.equal(await loadAuthSecret(profile, safeStorage), secret)
    assert.equal((await fs.stat(profile)).mode & 0o777, 0o700)
    assert.equal((await fs.stat(filename)).mode & 0o777, 0o600)
  }
})

test("separate profiles receive independent secrets and nested directories can be created", async t => {
  const { profile } = await fixture(t)
  const safeStorage = storage()
  const first = await loadAuthSecret(profile, safeStorage, "darwin")
  const second = await loadAuthSecret(path.join(profile, "nested", "profile"), safeStorage, "win32")
  assert.notEqual(first, second)
})

test("unavailable encryption leaves existing ciphertext intact and never creates a replacement", async t => {
  const { root, profile, filename } = await fixture(t)
  const safeStorage = storage()
  await loadAuthSecret(profile, safeStorage)
  const before = await fs.readFile(filename)
  for (const available of [async () => false, async () => { throw new Error("keychain sensitive details") }]) {
    safeStorage.isAsyncEncryptionAvailable = available
    await assert.rejects(loadAuthSecret(profile, safeStorage), failure)
    assert.deepEqual(await fs.readFile(filename), before)
    const empty = path.join(root, "empty")
    await assert.rejects(loadAuthSecret(empty, safeStorage), failure)
    assert.deepEqual(await fs.readdir(empty), [])
  }
  assert.equal(safeStorage.calls.encrypt, 1)
  assert.equal(safeStorage.calls.decrypt, 0)
})

test("Linux refuses plaintext, unknown and missing backends without calling async encryption", async t => {
  const { profile, filename } = await fixture(t)
  const safeStorage = storage()
  await loadAuthSecret(profile, safeStorage, "linux")
  const before = await fs.readFile(filename)
  safeStorage.isAsyncEncryptionAvailable = () => assert.fail("Unsafe backend must be refused first")
  for (const backend of ["basic_text", "unknown", undefined, "unrecognized"]) {
    safeStorage.getSelectedStorageBackend = () => backend
    await assert.rejects(loadAuthSecret(profile, safeStorage, "linux"), failure)
    assert.deepEqual(await fs.readFile(filename), before)
  }
  delete safeStorage.getSelectedStorageBackend
  await assert.rejects(loadAuthSecret(profile, safeStorage, "linux"), failure)
  assert.equal(safeStorage.calls.encrypt, 1)
})

test("Linux keyring backends are accepted; other platforms do not query the Linux backend", async t => {
  const { profile } = await fixture(t)
  const safeStorage = storage()
  for (const backend of ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]) {
    safeStorage.getSelectedStorageBackend = () => backend
    await loadAuthSecret(path.join(profile, backend), safeStorage, "linux")
  }
  safeStorage.getSelectedStorageBackend = () => assert.fail("Linux-only guard")
  await loadAuthSecret(path.join(profile, "mac"), safeStorage, "darwin")
  await loadAuthSecret(path.join(profile, "windows"), safeStorage, "win32")
})

test("corrupt ciphertext and a different keychain fail closed without regeneration", async t => {
  const { profile, filename } = await fixture(t)
  const safeStorage = storage()
  await loadAuthSecret(profile, safeStorage)
  const other = storage()
  const before = await fs.readFile(filename)
  await assert.rejects(loadAuthSecret(profile, other), failure)
  assert.equal(other.calls.encrypt, 0)
  assert.deepEqual(await fs.readFile(filename), before)
  for (const corrupt of [Buffer.alloc(0), randomBytes(12), Buffer.from("plaintext-invalid-secret")]) {
    await fs.writeFile(filename, corrupt)
    await assert.rejects(loadAuthSecret(profile, safeStorage), failure)
    assert.deepEqual(await fs.readFile(filename), corrupt)
  }
  assert.equal(safeStorage.calls.encrypt, 1)
})

test("invalid decrypted results never rotate or replace an existing secret", async t => {
  const { profile, filename } = await fixture(t)
  const safeStorage = storage()
  await loadAuthSecret(profile, safeStorage)
  const before = await fs.readFile(filename)
  for (const result of ["not-hex", "a".repeat(63), "a".repeat(65), "g".repeat(64), undefined, 42]) {
    safeStorage.decryptStringAsync = async () => ({ result, shouldReEncrypt: true })
    await assert.rejects(loadAuthSecret(profile, safeStorage), failure)
    assert.deepEqual(await fs.readFile(filename), before)
  }
  safeStorage.decryptStringAsync = async () => { throw new Error("secret native exception") }
  await assert.rejects(loadAuthSecret(profile, safeStorage), failure)
  assert.equal(safeStorage.calls.encrypt, 1)
})

test("an unreadable or disappearing existing file is never treated as a fresh profile", async t => {
  const { profile, filename } = await fixture(t)
  const safeStorage = storage()
  const secret = await loadAuthSecret(profile, safeStorage)
  const before = await fs.readFile(filename)
  const open = fs.open
  for (const code of ["EACCES", "ENOENT"]) {
    const mocked = t.mock.method(fs, "open", async (target, ...args) => {
      if (target === filename) throw Object.assign(new Error(secret), { code })
      return open(target, ...args)
    })
    await assert.rejects(loadAuthSecret(profile, safeStorage), error => {
      assert.equal(error.message, failure.message)
      assert.equal(error.cause, undefined)
      assert.equal(error.stack.includes(secret), false)
      return true
    })
    mocked.mock.restore()
    assert.deepEqual(await fs.readFile(filename), before)
  }
  assert.equal(safeStorage.calls.encrypt, 1)
  assert.equal(safeStorage.calls.decrypt, 0)
})

test("rotation atomically replaces ciphertext while preserving the authentication secret", async t => {
  const { profile, filename } = await fixture(t)
  const safeStorage = storage()
  const secret = await loadAuthSecret(profile, safeStorage)
  const before = await fs.readFile(filename)
  const decrypt = safeStorage.decryptStringAsync
  safeStorage.decryptStringAsync = async encrypted => ({ ...await decrypt(encrypted), shouldReEncrypt: true })
  const encrypt = safeStorage.encryptStringAsync
  safeStorage.encryptStringAsync = async value => {
    assert.equal(value, secret)
    assert.deepEqual(await fs.readFile(filename), before, "old ciphertext remains until replacement is ready")
    return encrypt(value)
  }
  assert.equal(await loadAuthSecret(profile, safeStorage), secret)
  assert.notDeepEqual(await fs.readFile(filename), before)
  assert.equal((await decrypt(await fs.readFile(filename))).result, secret)
  assert.deepEqual(await fs.readdir(profile), ["auth-secret.bin"])
  if (process.platform !== "win32") assert.equal((await fs.stat(filename)).mode & 0o777, 0o600)
})

test("failed atomic replacement preserves old ciphertext and removes the private temporary file", async t => {
  const { profile, filename } = await fixture(t)
  const safeStorage = storage()
  const secret = await loadAuthSecret(profile, safeStorage)
  const before = await fs.readFile(filename)
  const decrypt = safeStorage.decryptStringAsync
  safeStorage.decryptStringAsync = async encrypted => ({ ...await decrypt(encrypted), shouldReEncrypt: true })
  let staged
  const mocked = t.mock.method(fs, "rename", async (candidate, target) => {
    staged = { target, directory: path.dirname(candidate), secret: (await decrypt(await fs.readFile(candidate))).result, mode: (await fs.stat(candidate)).mode & 0o777 }
    throw new Error(secret)
  })
  await assert.rejects(loadAuthSecret(profile, safeStorage), failure)
  mocked.mock.restore()
  assert.ok(staged, "replacement must be attempted with fully written ciphertext")
  assert.equal(staged.target, filename)
  assert.equal(staged.directory, profile)
  assert.equal(staged.secret, secret)
  if (process.platform !== "win32") assert.equal(staged.mode, 0o600)
  assert.deepEqual(await fs.readFile(filename), before)
  assert.deepEqual(await fs.readdir(profile), ["auth-secret.bin"])
})

test("encryption failures and malformed ciphertext results never overwrite an existing secret", async t => {
  const { root, profile, filename } = await fixture(t)
  const safeStorage = storage()
  await loadAuthSecret(profile, safeStorage)
  const before = await fs.readFile(filename)
  const decrypt = safeStorage.decryptStringAsync
  safeStorage.decryptStringAsync = async encrypted => ({ ...await decrypt(encrypted), shouldReEncrypt: true })
  for (const encrypt of [async () => { throw new Error("sensitive encryption details") }, async () => Buffer.alloc(0), async () => "plaintext"]) {
    safeStorage.encryptStringAsync = encrypt
    await assert.rejects(loadAuthSecret(profile, safeStorage), failure)
    assert.deepEqual(await fs.readFile(filename), before)
    const empty = path.join(root, "empty")
    await assert.rejects(loadAuthSecret(empty, safeStorage), failure)
    assert.deepEqual(await fs.readdir(empty), [])
  }
})

test("profile directory symlinks, including ancestor symlinks, are refused", async t => {
  const { root, profile } = await fixture(t)
  const target = path.join(root, "target")
  await fs.mkdir(target, { mode: 0o755 })
  const originalMode = (await fs.stat(target)).mode
  await fs.symlink(target, profile, process.platform === "win32" ? "junction" : "dir")
  await assert.rejects(loadAuthSecret(profile, storage()), failure)
  await assert.rejects(loadAuthSecret(path.join(profile, "child"), storage()), failure)
  assert.deepEqual(await fs.readdir(target), [])
  assert.equal((await fs.stat(target)).mode, originalMode)
})

test("secret symlinks, directories and hardlinks are refused without changing their targets", async t => {
  const { root, profile, filename } = await fixture(t)
  await fs.mkdir(profile)
  const target = path.join(root, "target")
  const bytes = randomBytes(100)
  await fs.writeFile(target, bytes, { mode: 0o644 })
  const originalMode = (await fs.stat(target)).mode
  // A junction needs no Windows symlink privilege and must also be refused.
  await fs.symlink(process.platform === "win32" ? root : target, filename, process.platform === "win32" ? "junction" : "file")
  await assert.rejects(loadAuthSecret(profile, storage()), failure)
  await fs.unlink(filename)
  await fs.symlink(path.join(root, "missing"), filename, process.platform === "win32" ? "junction" : "file")
  await assert.rejects(loadAuthSecret(profile, storage()), failure)
  await fs.unlink(filename)
  await fs.link(target, filename)
  await assert.rejects(loadAuthSecret(profile, storage()), failure)
  await fs.unlink(filename)
  await fs.mkdir(filename)
  await assert.rejects(loadAuthSecret(profile, storage()), failure)
  assert.deepEqual(await fs.readFile(target), bytes)
  assert.equal((await fs.stat(target)).mode, originalMode)
})
