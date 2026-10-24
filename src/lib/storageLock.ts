import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { constants, promises as fs } from "node:fs"
import { dirname, join } from "node:path"
import { performance } from "node:perf_hooks"
import { ApiError } from "@/lib/apiErrors"

const marker = "llm-canvas-storage-lock-v1\n"
const maximumWaitMs = 10000
const busy = () => new ApiError("Storage is busy; retry the operation", 409)
const unavailable = () => new ApiError("Storage locking is unavailable", 503)
const desktopLocks = new Map<string, symbol>()

// Desktop has exactly one backend per profile, enforced by Electron's instance
// lock plus the PID lease/watchdog in desktop/runtime.cjs and backend.cjs.
// Web/server deployments continue to use the cross-process kernel lock below.
async function acquireDesktopLock(lockPath: string, deadline: number): Promise<() => Promise<void>> {
  while (desktopLocks.has(lockPath)) {
    const remaining = deadline - performance.now()
    if (remaining <= 0) throw busy()
    await new Promise(resolve => setTimeout(resolve, Math.min(50, remaining)))
  }
  if (performance.now() >= deadline) throw busy()
  const owner = Symbol()
  desktopLocks.set(lockPath, owner)
  return async () => { if (desktopLocks.get(lockPath) === owner) desktopLocks.delete(lockPath) }
}

function hasCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === code
}

/**
 * Requires Linux, a local filesystem supporting flock(2), and BusyBox/util-linux
 * flock at /usr/bin/flock. Uses only -x -n and fd mode. Never delete/replace
 * these persistent lock files while any application process can use storage.
 * The kernel tracks the open file description, independent of PID reuse, boot,
 * or container/PID namespace identity; closing its last fd releases the lock.
 * Legacy directories and unrecognized entries require offline operator repair.
 */
export async function acquireStorageLock(
  lockPath: string,
  timeoutMs = maximumWaitMs
): Promise<() => Promise<void>> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > maximumWaitMs) throw unavailable()
  const deadline = performance.now() + timeoutMs
  if (process.env.LLM_CANVAS_DESKTOP === "1") {
    if (typeof process.send !== "function" || !process.connected) throw unavailable()
    return acquireDesktopLock(lockPath, deadline)
  }

  // Publish a complete marker atomically. A crash before publication leaves only
  // an unused candidate, never a partially initialized canonical lock file.
  const candidate = join(dirname(lockPath), `.candidate-${randomUUID()}`)
  const prepared = await fs.open(candidate, "wx", 0o600)
  try {
    await prepared.writeFile(marker)
    await prepared.sync()
    try {
      await fs.link(candidate, lockPath)
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error
    }
  } finally {
    await prepared.close()
    await fs.unlink(candidate).catch(error => { if (!hasCode(error, "ENOENT")) throw error })
  }

  // O_NONBLOCK prevents an unexpected FIFO from hanging open; O_NOFOLLOW avoids
  // following symlinks. Validate before allowing flock to touch the descriptor.
  const handle = await fs.open(lockPath, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    .catch(error => {
      if (["ELOOP", "EISDIR", "ENXIO", "ENOENT"].some(code => hasCode(error, code))) throw busy()
      throw error
    })
  let acquired = false
  try {
    const stats = await handle.stat()
    if (!stats.isFile() || stats.size !== Buffer.byteLength(marker)) throw busy()
    const contents = Buffer.alloc(Buffer.byteLength(marker))
    const { bytesRead } = await handle.read(contents, 0, contents.length, 0)
    if (bytesRead !== contents.length || contents.toString() !== marker) throw busy()

    // fd 3 is a duplicate of Node's open file description. flock exits after
    // acquisition, but Node retains the SAME description and therefore its lock.
    // No helper process must stay alive, and no PID-based reaper is involved.
    while (true) {
      const remaining = deadline - performance.now()
      if (remaining <= 0) throw busy()
      const locked = await new Promise<boolean>((resolve, reject) => {
        const child = spawn("/usr/bin/flock", ["-x", "-n", "3"], {
          stdio: ["ignore", "ignore", "ignore", handle.fd],
        })
        let expired = false
        // Kill a stalled helper at the deadline and reap it before closing our
        // fd: the child inherits the same open file description.
        const timer = setTimeout(() => { expired = true; child.kill("SIGKILL") }, remaining)
        child.once("error", () => { clearTimeout(timer); reject(unavailable()) })
        child.once("close", code => {
          clearTimeout(timer)
          if (expired || performance.now() >= deadline) reject(busy())
          else if (code === 0) resolve(true)
          else if (code === 1) resolve(false)
          else reject(unavailable())
        })
      })
      if (locked) break
      const delay = Math.min(100, deadline - performance.now())
      if (delay <= 0) throw busy()
      // One child at a time per admitted request; no queued spawn promises.
      await new Promise(resolve => setTimeout(resolve, delay))
    }
    const current = await fs.lstat(lockPath)
    if (!current.isFile() || current.dev !== stats.dev || current.ino !== stats.ino) throw busy()
    acquired = true
    // Never unlink the path: a successor must always lock the same inode.
    return async () => { await handle.close() }
  } finally {
    if (!acquired) await handle.close()
  }
}
