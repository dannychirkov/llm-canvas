const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const { createHash } = require("node:crypto")
const { fork, execFileSync, spawn } = require("node:child_process")
const { EventEmitter } = require("node:events")
const { createLoader } = require("./loadSource")

const repository = process.cwd()
const { acquireStorageLock } = createLoader()("src/lib/storageLock.ts")
const workerPath = path.join(__dirname, "storageLockWorker.js")
const marker = "llm-canvas-storage-lock-v1\n"

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "llm-canvas-storage-lock-"))
  const root = path.join(directory, "public/uploads/.quota-locks")
  await fs.mkdir(root, { recursive: true })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return { directory, root, lockPath: path.join(root, createHash("sha256").update("user").digest("hex")) }
}

function worker(t, directory, action) {
  const child = fork(workerPath, [directory, action], { cwd: repository, stdio: ["ignore", "pipe", "pipe", "ipc"] })
  let stderr = ""
  child.stderr.on("data", data => { stderr += data })
  const messages = new Map()
  const waiters = new Map()
  child.on("message", message => {
    messages.set(message, true)
    waiters.get(message)?.resolve()
  })
  const exited = new Promise(resolve => child.once("exit", (code, signal) => {
    for (const [message, waiter] of waiters) {
      if (!messages.has(message)) waiter.reject(new Error(`Worker exited before ${message}: ${stderr}`))
    }
    resolve({ code, signal })
  }))
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited })
  return {
    child, exited,
    message: name => messages.has(name) ? Promise.resolve() : new Promise((resolve, reject) => { waiters.set(name, { resolve, reject }) }),
  }
}

test("RR009: live descriptor survives flock helper exit and an old mtime never permits takeover", { timeout: 15000 }, async t => {
  const { directory, lockPath } = await fixture(t)
  const holder = worker(t, directory, "hold")
  await holder.message("acquired")
  await fs.utimes(lockPath, new Date(0), new Date(0))
  await assert.rejects(acquireStorageLock(lockPath, 100), { status: 409 })
  holder.child.send("release")
  assert.deepEqual(await holder.exited, { code: 0, signal: null })
  const release = await acquireStorageLock(lockPath)
  await release()
})

test("RR009: SIGKILL releases ownership and competing successors serialize on the same inode", { timeout: 20000 }, async t => {
  const { directory, lockPath } = await fixture(t)
  await fs.writeFile(path.join(directory, "count"), "0")
  const holder = worker(t, directory, "hold")
  await holder.message("acquired")
  const before = await fs.stat(lockPath)
  holder.child.kill("SIGKILL")
  assert.equal((await holder.exited).signal, "SIGKILL")
  const writers = Array.from({ length: 6 }, () => worker(t, directory, "increment"))
  for (const result of await Promise.all(writers.map(writer => writer.exited))) assert.deepEqual(result, { code: 0, signal: null })
  assert.equal(await fs.readFile(path.join(directory, "count"), "utf8"), "6")
  const after = await fs.stat(lockPath)
  assert.equal(after.ino, before.ino)
  assert.equal(after.dev, before.dev)
})

test("RR009: crash during atomic publication leaves a usable complete lock", { timeout: 15000 }, async t => {
  const { directory, lockPath, root } = await fixture(t)
  const publisher = worker(t, directory, "publish")
  await publisher.message("published")
  publisher.child.kill("SIGKILL")
  await publisher.exited
  assert.equal(await fs.readFile(lockPath, "utf8"), marker)
  assert.equal((await fs.readdir(root)).filter(name => name.startsWith(".candidate-")).length, 1)
  const release = await acquireStorageLock(lockPath)
  await release()
})

test("RR009: repeated release cannot unlock a successor or replace its inode", async t => {
  const { lockPath } = await fixture(t)
  const first = await acquireStorageLock(lockPath)
  const before = await fs.stat(lockPath)
  await first()
  const second = await acquireStorageLock(lockPath)
  try {
    await first()
    await assert.rejects(acquireStorageLock(lockPath, 50), { status: 409 })
    assert.equal((await fs.stat(lockPath)).ino, before.ino)
  } finally { await second() }
})

test("RR009: legacy, malformed, symlink and FIFO entries fail closed and stay untouched", async t => {
  const { root } = await fixture(t)
  const cases = [
    ["legacy", target => fs.mkdir(target)],
    ["unknown-directory", async target => { await fs.mkdir(target); await fs.writeFile(path.join(target, "owner"), "unknown") }],
    ["empty", target => fs.writeFile(target, "")],
    ["malformed", target => fs.writeFile(target, "x".repeat(Buffer.byteLength(marker)))],
    ["symlink", target => fs.symlink(path.join(root, "valid"), target)],
    ["fifo", target => execFileSync("mkfifo", [target])],
  ]
  await fs.writeFile(path.join(root, "valid"), marker)
  for (const [name, setup] of cases) {
    const target = path.join(root, name)
    await setup(target)
    const before = await fs.lstat(target)
    await assert.rejects(acquireStorageLock(target, 0), { status: 409 })
    assert.equal((await fs.lstat(target)).ino, before.ino, name)
  }
  assert.equal(await fs.readFile(path.join(root, "valid"), "utf8"), marker)
  assert.equal(await fs.readFile(path.join(root, "unknown-directory/owner"), "utf8"), "unknown")
})

test("RR009: missing or incompatible flock fails closed without running a reservation", async t => {
  const { directory } = await fixture(t)
  const original = process.cwd()
  let executed = false
  const reservations = ["missing", "incompatible", "terminated"].map(outcome => createLoader({
      "@/lib/prisma": { prisma: {} },
      "node:child_process": {
        spawn: () => {
          const child = new EventEmitter()
          process.nextTick(() => {
            if (outcome === "missing") child.emit("error", Object.assign(new Error("not installed"), { code: "ENOENT" }))
            else child.emit("close", outcome === "terminated" ? null : 2)
          })
          return child
        },
      },
    })("src/lib/storageUtils.ts").withStorageReservation)
  process.chdir(directory)
  try {
    for (const reserve of reservations) await assert.rejects(reserve("user", 0, async () => { executed = true }), { status: 503 })
    assert.equal(executed, false)
  } finally { process.chdir(original) }
})

test("RR009: BusyBox-compatible probes retry serially on fd 3 and stop at the deadline", { timeout: 15000 }, async t => {
  const { lockPath } = await fixture(t)
  const timeoutMs = 240
  let active = 0
  let attempts = 0
  let descriptor
  const portable = createLoader({
    "node:child_process": {
      spawn: (command, args, options) => {
        assert.equal(command, "/usr/bin/flock")
        assert.deepEqual(args, ["-x", "-n", "3"])
        if (descriptor !== undefined) assert.equal(options.stdio[3], descriptor)
        descriptor = options.stdio[3]
        assert.equal(++active, 1)
        attempts++
        const child = new EventEmitter()
        process.nextTick(() => { active--; child.emit("close", 1) })
        return child
      },
    },
  })("src/lib/storageLock.ts").acquireStorageLock
  const started = performance.now()
  await assert.rejects(portable(lockPath, timeoutMs), { status: 409 })
  assert.ok(performance.now() - started >= timeoutMs, "contention must exhaust the acquisition deadline")
  // Allow timer rounding and the shortened final sleep without permitting a hot
  // retry loop. CPU load may also exhaust the deadline before the first probe.
  assert.ok(attempts <= Math.ceil(timeoutMs / 10), `bounded probes: ${attempts}`)
  assert.equal(active, 0)
  const previousAttempts = attempts
  await assert.rejects(portable(lockPath, 10001), { status: 503 })
  assert.equal(attempts, previousAttempts)
  // A failed probe never owns or closes a successor's independent description.
  const release = await acquireStorageLock(lockPath)
  await release()
})

test("RR009: hung helper is killed and reaped at the acquisition deadline", async t => {
  const { lockPath } = await fixture(t)
  let helper
  let helperStarted
  let attempts = 0
  let reaped = false
  t.after(() => { if (helper?.exitCode === null && helper?.signalCode === null) helper.kill("SIGKILL") })
  const portable = createLoader({
    // Measure the stalled helper's deadline independently of fixture fsync and
    // filesystem scheduling, which may consume a short budget before spawning.
    "node:perf_hooks": {
      performance: { now: () => helperStarted === undefined ? 0 : performance.now() - helperStarted },
    },
    "node:child_process": {
      spawn: (command, args, options) => {
        attempts++
        helperStarted = performance.now()
        helper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options)
        helper.once("close", () => { reaped = true })
        return helper
      },
    },
  })("src/lib/storageLock.ts").acquireStorageLock
  await assert.rejects(portable(lockPath, 100), { status: 409 })
  assert.equal(attempts, 1)
  assert.equal(helper.signalCode, "SIGKILL")
  assert.equal(reaped, true)
  const release = await acquireStorageLock(lockPath)
  await release()
})

test("RR009: installed BusyBox flock preserves kernel ownership and repeated-release safety", async t => {
  const busybox = ["/usr/bin/busybox", "/bin/busybox"].find(binary => {
    try { execFileSync(binary, ["flock", "--help"], { stdio: "ignore" }); return true }
    catch { return false }
  })
  if (!busybox) { t.skip("BusyBox flock is not installed in this test environment"); return }
  const { lockPath } = await fixture(t)
  const portable = createLoader({
    "node:child_process": {
      spawn: (command, args, options) => {
        assert.equal(command, "/usr/bin/flock")
        assert.deepEqual(args, ["-x", "-n", "3"])
        return spawn(busybox, ["flock", ...args], options)
      },
    },
  })("src/lib/storageLock.ts").acquireStorageLock
  const first = await portable(lockPath, 500)
  await assert.rejects(acquireStorageLock(lockPath, 100), { status: 409 })
  await first()
  const second = await portable(lockPath, 500)
  try {
    await first()
    await assert.rejects(portable(lockPath, 100), { status: 409 })
  } finally { await second() }
})

test("RR009: reservation failure releases its kernel lock for the next operation", async t => {
  const { directory, lockPath } = await fixture(t)
  const prisma = {
    user: { findUnique: async () => ({ id: "user", isOwner: true }) },
    canvas: { findMany: async () => [] },
    node: { count: async () => 0 },
    media: { count: async () => 0 },
    $queryRaw: async () => [{ bytes: 0 }],
  }
  const { withStorageReservation } = createLoader({ "@/lib/prisma": { prisma } })("src/lib/storageUtils.ts")
  const original = process.cwd()
  process.chdir(directory)
  try {
    await assert.rejects(withStorageReservation("user", 0, async () => { throw new Error("operation failed") }), /operation failed/)
    assert.equal(await withStorageReservation("user", 0, async () => "next"), "next")
    assert.equal(await fs.readFile(lockPath, "utf8"), marker)
  } finally { process.chdir(original) }
})
