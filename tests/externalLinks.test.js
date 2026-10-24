const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { validateExternalLinks, installExternalLinks } = require("../ops/link-externals")

test("only exact generated aliases for supported external packages are accepted", () => {
  assert.equal(validateExternalLinks([{ alias: "@prisma/client-0123456789abcdef", package: "@prisma/client" }]).length, 1)
  for (const entry of [{ alias: "../../prisma/.auth.secret", package: "@prisma/client" }, { alias: "jsdom-0123456789abcdef", package: "../../prisma" }, { alias: "jsdom", package: "jsdom" }]) assert.throws(() => validateExternalLinks([entry]))
})

test("aliases are recreated relative to the verified native runtime, not host modules", context => {
  const root = fs.mkdtempSync("/tmp/llm-canvas-externals-")
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const next = path.join(root, "next")
  const modules = path.join(root, "native_modules")
  fs.mkdirSync(path.join(modules, "@prisma", "client"), { recursive: true })
  const alias = "@prisma/client-0123456789abcdef"
  installExternalLinks([{ alias, package: "@prisma/client" }], next, modules)
  assert.equal(fs.realpathSync(path.join(next, "node_modules", alias)), fs.realpathSync(path.join(modules, "@prisma", "client")))
  assert.equal(path.isAbsolute(fs.readlinkSync(path.join(next, "node_modules", alias))), false)
})
