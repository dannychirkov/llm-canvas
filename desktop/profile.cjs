const fs = require("node:fs/promises")
const { constants } = require("node:fs")
const path = require("node:path")
const { randomBytes } = require("node:crypto")

async function prepareProfile(profile) {
  const root = path.parse(profile).root
  if (profile === root) throw new Error()
  let current = root
  for (const part of path.relative(root, profile).split(path.sep)) {
    current = path.join(current, part)
    try {
      await fs.mkdir(current, { mode: 0o700 })
    } catch (error) {
      if (error.code !== "EEXIST") throw error
    }
    const stat = await fs.lstat(current)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error()
  }
  await fs.chmod(profile, 0o700)
}

async function secretEntry(filename) {
  let stat
  try {
    stat = await fs.lstat(filename)
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw error
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error()
  return stat
}

async function loadAuthSecret(profile, safeStorage, platform = process.platform) {
  let temporary
  try {
    if (typeof profile !== "string" || !profile) throw new Error()
    profile = path.resolve(profile)
    await prepareProfile(profile)
    // The parent initializes the deprecated synchronous backend on Electron 45.
    // Its Linux guard prevents accepting the unprotected fallback provider.
    if (platform === "linux" && !["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(safeStorage.getSelectedStorageBackend())) throw new Error()
    if (await safeStorage.isAsyncEncryptionAvailable() !== true) throw new Error()

    const filename = path.join(profile, "auth-secret.bin")
    const existing = await secretEntry(filename)
    let secret
    let rotate = false
    if (existing) {
      const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0))
      let encrypted
      try {
        const opened = await handle.stat()
        if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== existing.ino || opened.dev !== existing.dev) throw new Error()
        await handle.chmod(0o600)
        encrypted = await handle.readFile()
      } finally {
        await handle.close()
      }
      const decrypted = await safeStorage.decryptStringAsync(encrypted)
      secret = decrypted.result
      rotate = decrypted.shouldReEncrypt === true
      if (typeof secret !== "string" || !/^[0-9a-f]{64}$/i.test(secret)) throw new Error()
    } else {
      // A missing key beside an existing database is recovery, not first run.
      // Replacing it would silently strand all encrypted provider settings.
      try {
        const database = await fs.lstat(path.join(profile, "data", "prisma", "dev.db"))
        if (database.size > 0 || database.isSymbolicLink()) throw new Error("Existing desktop data requires its original secret")
      } catch (error) { if (error.code !== "ENOENT") throw error }
      secret = randomBytes(32).toString("hex")
    }

    if (!existing || rotate) {
      const encrypted = await safeStorage.encryptStringAsync(secret)
      if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) throw new Error()
      const candidate = path.join(profile, `.auth-secret-${randomBytes(16).toString("hex")}.tmp`)
      const handle = await fs.open(candidate, "wx", 0o600)
      temporary = candidate
      try {
        await handle.writeFile(encrypted)
        await handle.sync()
      } finally {
        await handle.close()
      }
      if (existing) {
        const current = await secretEntry(filename)
        if (!current || current.ino !== existing.ino || current.dev !== existing.dev) throw new Error()
        await fs.rename(temporary, filename)
      } else {
        // Publish without overwriting a secret created by another startup.
        await fs.link(temporary, filename)
      }
    }
    return secret
  } catch {
    // Storage errors and native keychain errors can contain sensitive data.
    throw new Error("Unable to load desktop authentication secret")
  } finally {
    if (temporary) await fs.unlink(temporary).catch(() => {})
  }
}

module.exports = { loadAuthSecret }
