const fs = require("node:fs")
const path = require("node:path")
const { createRequire } = require("node:module")
const ts = require("typescript")

function createLoader(overrides = {}) {
  const cache = new Map()
  function load(filename) {
    const absolute = path.resolve(filename)
    if (cache.has(absolute)) return cache.get(absolute).exports
    const moduleRecord = { exports: {} }
    cache.set(absolute, moduleRecord)
    const source = fs.readFileSync(absolute, "utf8")
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText
    const nativeRequire = createRequire(absolute)
    function loadLocal(base) {
      const resolved = [base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")].find(candidate => fs.existsSync(candidate))
      if (!resolved) throw new Error("Unresolved local test import: " + base)
      return load(resolved)
    }
    function requireModule(name) {
      if (Object.hasOwn(overrides, name)) return overrides[name]
      if (name.startsWith("@/")) return loadLocal(path.join(process.cwd(), "src", name.slice(2)))
      if (name.startsWith(".")) return loadLocal(path.resolve(path.dirname(absolute), name))
      return nativeRequire(name)
    }
    new Function("require", "module", "exports", compiled)(requireModule, moduleRecord, moduleRecord.exports)
    return moduleRecord.exports
  }
  return load
}

module.exports = { createLoader }
