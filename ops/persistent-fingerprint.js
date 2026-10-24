const fs = require("node:fs")
const path = require("node:path")
const { createHash } = require("node:crypto")
const { DatabaseSync } = require("node:sqlite")

const extensions = { users: { authVersion: "0" }, token_usage: { usageSource: "NULL" } }
const quote = name => '"' + name.replaceAll('"', '""') + '"'

async function fileHash(filename) {
  const digest = createHash("sha256")
  for await (const chunk of fs.createReadStream(filename)) digest.update(chunk)
  return digest.digest("hex")
}

async function directoryHash(root) {
  const digest = createHash("sha256")
  async function visit(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      if (directory === root && name.startsWith(".readiness-")) continue
      const filename = path.join(directory, name)
      const entry = fs.lstatSync(filename)
      if (entry.isSymbolicLink()) throw new Error("Unexpected symlink in persistent uploads")
      if (entry.isDirectory()) await visit(filename)
      else if (entry.isFile()) digest.update(JSON.stringify([path.relative(root, filename), entry.size, await fileHash(filename)]))
      else throw new Error("Unexpected persistent file type")
    }
  }
  await visit(root)
  return digest.digest("hex")
}

async function fingerprint(prismaRoot = "/backup/prisma", uploadsRoot = "/backup/uploads") {
  const databasePath = path.join(prismaRoot, "dev.db")
  const database = new DatabaseSync(databasePath, { readOnly: true })
  const logical = {}
  try {
    for (const { name } of database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name").all()) {
      const fields = database.prepare("PRAGMA table_info(" + quote(name) + ")").all()
      const existing = new Set(fields.map(field => field.name))
      const columns = [...new Set([...existing, ...Object.keys(extensions[name] ?? {})])].sort()
      const selection = columns.map(column => existing.has(column) ? quote(column) : extensions[name][column] + " AS " + quote(column)).join(", ")
      const primary = fields.filter(field => field.pk).sort((left, right) => left.pk - right.pk).map(field => quote(field.name))
      const digest = createHash("sha256").update(JSON.stringify(columns))
      const statement = database.prepare("SELECT " + selection + " FROM " + quote(name) + " ORDER BY " + (primary.length ? primary.join(", ") : columns.map(quote).join(", ")))
      statement.setReadBigInts(true)
      let rows = 0
      for (const row of statement.iterate()) { digest.update(JSON.stringify(row, (key, value) => typeof value === "bigint" ? value.toString() : value)); rows++ }
      logical[name] = { rows, digest: digest.digest("hex") }
    }
    if (database.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("Database integrity check failed")
  } finally { database.close() }
  return { database: await fileHash(databasePath), secret: await fileHash(path.join(prismaRoot, ".auth.secret")), uploads: await directoryHash(uploadsRoot), logical }
}

function preserved(before, after) {
  return before.secret === after.secret && before.uploads === after.uploads && JSON.stringify(before.logical) === JSON.stringify(after.logical)
}

module.exports = { fingerprint, preserved }

if (require.main === module) fingerprint().then(value => process.stdout.write(JSON.stringify(value))).catch(() => { process.stderr.write("Persistent fingerprint failed\n"); process.exitCode = 1 })
