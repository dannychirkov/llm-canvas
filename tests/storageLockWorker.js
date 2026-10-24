const fs = require("node:fs")
const path = require("node:path")
const { createHash } = require("node:crypto")
const { createLoader } = require("./loadSource")

async function run() {
  const [directory, action] = process.argv.slice(2)
  if (!directory.startsWith(require("node:os").tmpdir() + path.sep)) throw new Error("Disposable directory required")
  const lockPath = path.join(directory, "public/uploads/.quota-locks", createHash("sha256").update("user").digest("hex"))
  const overrides = {}
  if (action === "publish") {
    overrides["node:fs"] = {
      ...fs,
      promises: {
        ...fs.promises,
        link: async (...args) => {
          await fs.promises.link(...args)
          process.send("published")
          await new Promise(() => { setInterval(() => {}, 1000) })
        },
      },
    }
  }
  const { acquireStorageLock } = createLoader(overrides)("src/lib/storageLock.ts")
  const release = await acquireStorageLock(lockPath)
  if (action === "hold") {
    process.send("acquired")
    await new Promise(resolve => process.once("message", resolve))
  } else if (action === "increment") {
    // An exclusive sentinel detects overlap independently of the final count.
    const sentinel = await fs.promises.open(path.join(directory, "critical"), "wx")
    try {
      const count = Number(await fs.promises.readFile(path.join(directory, "count"), "utf8"))
      await new Promise(resolve => setTimeout(resolve, 20))
      await fs.promises.writeFile(path.join(directory, "count"), String(count + 1))
    } finally {
      await sentinel.close()
      await fs.promises.unlink(path.join(directory, "critical"))
    }
  }
  await release()
}

run().catch(() => { process.exitCode = 1; if (process.connected) process.disconnect() })
