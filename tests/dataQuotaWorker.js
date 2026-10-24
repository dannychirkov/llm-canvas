const { PrismaClient } = require("@prisma/client")
const fs = require("node:fs/promises")
const path = require("node:path")
const { createLoader } = require("./loadSource")

async function run() {
  const [directory, database, userId, canvasId] = process.argv.slice(2)
  if (!directory.startsWith("/tmp/") || !database.startsWith(directory + "/")) throw new Error("Quota worker requires an isolated database")
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${database}` } } })
  const { withStorageReservation } = createLoader({ "@/lib/prisma": { prisma } })("src/lib/storageUtils.ts")
  process.chdir(directory)
  try {
    await withStorageReservation(userId, 600, async reservation => {
      reservation.verify(600)
      await new Promise(resolve => setTimeout(resolve, 100))
      const target = path.join(directory, "public/uploads/canvases", canvasId)
      await fs.mkdir(target, { recursive: true })
      await fs.writeFile(path.join(target, `${process.pid}.csv`), Buffer.alloc(600))
    })
  } catch (error) {
    process.exitCode = error.status === 403 ? 23 : 24
  } finally { await prisma.$disconnect() }
}

run().catch(() => { process.exitCode = 25 })
