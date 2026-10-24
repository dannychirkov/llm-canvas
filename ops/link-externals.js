const fs = require("node:fs")
const path = require("node:path")
const assert = require("node:assert/strict")

function validateExternalLinks(links) {
  assert.ok(Array.isArray(links) && links.length <= 2, "Unsupported external package links")
  const aliases = new Set()
  for (const entry of links) {
    assert.ok(entry && ["jsdom", "@prisma/client"].includes(entry.package), "Unsupported external package")
    const prefix = entry.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    assert.ok(typeof entry.alias === "string" && new RegExp("^" + prefix + "-[a-f0-9]{16}$").test(entry.alias) && !aliases.has(entry.alias), "Invalid external package alias")
    aliases.add(entry.alias)
  }
  return links
}

function installExternalLinks(links, nextRoot = "/app/.next", modulesRoot = "/app/node_modules") {
  for (const entry of validateExternalLinks(links)) {
    const target = path.join(modulesRoot, entry.package)
    assert.ok(fs.statSync(target).isDirectory(), "Native runtime package is missing")
    const alias = path.join(nextRoot, "node_modules", entry.alias)
    fs.mkdirSync(path.dirname(alias), { recursive: true })
    fs.symlinkSync(path.relative(path.dirname(alias), target), alias, "dir")
  }
}

module.exports = { validateExternalLinks, installExternalLinks }

if (require.main === module) installExternalLinks(JSON.parse(fs.readFileSync(process.argv[2], "utf8")))
