const fs = require("node:fs")
const path = require("node:path")
const { validateExternalLinks } = require("./link-externals")

function externalLinks(standalone) {
  const root = path.join(standalone, ".next", "node_modules")
  if (!fs.existsSync(root)) return []
  const result = []
  function visit(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const alias = prefix + entry.name
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory() && !prefix && /^@[a-z0-9._-]+$/.test(entry.name)) visit(filename, alias + "/")
      else {
        if (!entry.isSymbolicLink()) throw new Error("Unsupported standalone external package entry")
        const packageName = alias.replace(/-[a-f0-9]{16}$/, "")
        validateExternalLinks([{ alias, package: packageName }])
        if (fs.realpathSync(filename) !== fs.realpathSync(path.join(standalone, "node_modules", packageName))) throw new Error("External package link escapes its expected package")
        result.push({ alias, package: packageName })
      }
    }
  }
  visit(root)
  return validateExternalLinks(result)
}

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error("Artifact symlinks are not allowed")
    return entry.isDirectory() ? filesIn(filename) : [filename]
  })
}

function verifyArtifact(directory) {
  validateExternalLinks(JSON.parse(fs.readFileSync(path.join(directory, "external-packages.json"), "utf8")))
  const files = filesIn(directory)
  for (const filename of files) {
    if (/(^|\/)(?:\.env(?:\..*)?|docker\.env(?:\..*)?|.*\.(?:db|key)|\.auth\.secret)$/.test(filename)) throw new Error("Credential or database file in artifact")
  }
  const staticRoot = path.join(directory, "static")
  const staticFiles = filesIn(staticRoot)
  if (!staticFiles.some(filename => filename.endsWith(".js")) || !staticFiles.some(filename => filename.endsWith(".css"))) throw new Error("Missing JavaScript or CSS assets")
  const chunks = new Set()
  for (const filename of filesIn(path.join(directory, "next"))) {
    if (!/(?:client-reference-manifest\.js|\.html|build-manifest\.json)$/.test(filename)) continue
    for (const match of fs.readFileSync(filename, "utf8").matchAll(/static\/chunks\/[^"'\\\s<>]+?\.(?:js|css)/g)) chunks.add(match[0])
  }
  if (!chunks.size) throw new Error("No rendered or client-manifest asset references")
  for (const chunk of chunks) {
    const target = path.resolve(directory, chunk)
    if (!target.startsWith(path.resolve(staticRoot) + path.sep) || !fs.existsSync(target)) throw new Error("Missing referenced asset: " + chunk)
  }
  return { files: files.length, staticFiles: staticFiles.length, referencedChunks: chunks.size }
}

function stageArtifact(directory, root = process.cwd()) {
  const build = path.join(root, ".next")
  const standalone = path.join(build, "standalone")
  const id = fs.readFileSync(path.join(build, "BUILD_ID"), "utf8")
  if (id !== fs.readFileSync(path.join(standalone, ".next/BUILD_ID"), "utf8")) throw new Error("Mismatched standalone and static builds")
  fs.mkdirSync(directory, { mode: 0o700 })
  const aliases = externalLinks(standalone)
  fs.cpSync(path.join(standalone, ".next"), path.join(directory, "next"), { recursive: true, filter: filename => !["static", "node_modules"].includes(path.relative(path.join(standalone, ".next"), filename).split(path.sep)[0]) })
  fs.writeFileSync(path.join(directory, "external-packages.json"), JSON.stringify(aliases))
  fs.copyFileSync(path.join(root, "ops/link-externals.js"), path.join(directory, "link-externals.js"))
  fs.cpSync(path.join(build, "static"), path.join(directory, "static"), { recursive: true })
  fs.copyFileSync(path.join(standalone, "server.js"), path.join(directory, "server.js"))
  fs.copyFileSync(path.join(root, "package.json"), path.join(directory, "package.json"))
  fs.copyFileSync(path.join(root, "docker-entrypoint.sh"), path.join(directory, "docker-entrypoint.sh"))
  fs.copyFileSync(path.join(root, "ops/Dockerfile.artifact"), path.join(directory, "Dockerfile"))
  fs.cpSync(path.join(root, "public"), path.join(directory, "public"), { recursive: true, filter: filename => !["uploads", "canvases"].includes(path.relative(path.join(root, "public"), filename).split(path.sep)[0]) })
  return verifyArtifact(directory)
}

module.exports = { stageArtifact, verifyArtifact, externalLinks }

if (require.main === module) {
  try {
    const directory = path.resolve(process.argv[2] || "")
    if (!/^\/tmp\/llm-canvas-deploy-[a-zA-Z0-9]+\/context$/.test(directory) || fs.realpathSync(path.dirname(directory)) !== path.dirname(directory)) throw new Error("Use a fresh private deployment context under /tmp")
    process.stdout.write(JSON.stringify({ check: "artifact-staged", ...stageArtifact(directory) }) + "\n")
  } catch (failure) {
    process.stderr.write("Artifact staging failed: " + failure.message + "\n")
    process.exitCode = 1
  }
}
