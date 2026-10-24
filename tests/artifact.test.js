const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const http = require("node:http")
const { stageArtifact, verifyArtifact } = require("../ops/stage-artifact")
const { verifyFrontend } = require("../ops/frontend-smoke")

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-artifact-test-"))
  const root = path.join(directory, "source")
  const output = path.join(directory, "context")
  function put(filename, value) {
    const target = path.join(root, filename)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, value)
  }
  put(".next/BUILD_ID", "fixture-build")
  put(".next/standalone/.next/BUILD_ID", "fixture-build")
  put(".next/standalone/.next/server/app/settings.html", '<script src="/_next/static/chunks/app.js"></script><link rel="stylesheet" href="/_next/static/chunks/app.css">')
  put(".next/standalone/server.js", "server fixture")
  put(".next/standalone/node_modules/secret.txt", "excluded dependencies")
  put(".next/static/chunks/app.js", "fixture script")
  put(".next/static/chunks/app.css", "body {}")
  put("public/icon.svg", "icon fixture")
  put("public/uploads/private.png", "private upload")
  put("public/canvases/private.png", "private generation")
  put("docker.env", "private env")
  put("package.json", "{}")
  put("docker-entrypoint.sh", "#!/bin/sh\nexec node server.js\n")
  put("ops/Dockerfile.artifact", fs.readFileSync("ops/Dockerfile.artifact"))
  put("ops/link-externals.js", fs.readFileSync("ops/link-externals.js"))
  return { directory, root, output, put }
}

test("generated external aliases are described without copying host-native modules or symlinks", () => {
  const setup = fixture()
  try {
    setup.put(".next/standalone/node_modules/jsdom/package.json", "{}")
    const modules = path.join(setup.root, ".next/standalone/.next/node_modules")
    fs.mkdirSync(modules, { recursive: true })
    fs.symlinkSync("../../node_modules/jsdom", path.join(modules, "jsdom-0123456789abcdef"))
    stageArtifact(setup.output, setup.root)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(setup.output, "external-packages.json"))), [{ alias: "jsdom-0123456789abcdef", package: "jsdom" }])
    assert.equal(fs.existsSync(path.join(setup.output, "next/node_modules")), false)
    verifyArtifact(setup.output)
  } finally { fs.rmSync(setup.directory, { recursive: true, force: true }) }
})

test("external package aliases cannot point at unrelated files", () => {
  const setup = fixture()
  try {
    setup.put(".next/standalone/node_modules/jsdom/package.json", "{}")
    const modules = path.join(setup.root, ".next/standalone/.next/node_modules")
    fs.mkdirSync(modules, { recursive: true })
    fs.symlinkSync(path.join(setup.root, "docker.env"), path.join(modules, "jsdom-0123456789abcdef"))
    assert.throws(() => stageArtifact(setup.output, setup.root), /escapes/)
  } finally { fs.rmSync(setup.directory, { recursive: true, force: true }) }
})

test("artifact staging explicitly includes standalone server and separate matching static assets", () => {
  const setup = fixture()
  try {
    const result = stageArtifact(setup.output, setup.root)
    assert.equal(result.referencedChunks, 2)
    assert.equal(result.staticFiles, 2)
    assert.ok(fs.existsSync(path.join(setup.output, "static/chunks/app.js")))
    assert.ok(fs.existsSync(path.join(setup.output, "static/chunks/app.css")))
    assert.match(fs.readFileSync(path.join(setup.output, "Dockerfile"), "utf8"), /COPY --chown=nextjs:nodejs static\/ \.\/\.next\/static\//)
    for (const excluded of ["public/uploads", "public/canvases", "node_modules", "docker.env"]) assert.ok(!fs.existsSync(path.join(setup.output, excluded)))
  } finally { fs.rmSync(setup.directory, { recursive: true, force: true }) }
})

test("artifact verification rejects the deployment regression when referenced JS is omitted", () => {
  const setup = fixture()
  try {
    stageArtifact(setup.output, setup.root)
    fs.renameSync(path.join(setup.output, "static/chunks/app.js"), path.join(setup.output, "static/chunks/other.js"))
    assert.throws(() => verifyArtifact(setup.output), /Missing referenced asset/)
    fs.rmSync(path.join(setup.output, "static"), { recursive: true })
    assert.throws(() => verifyArtifact(setup.output))
  } finally { fs.rmSync(setup.directory, { recursive: true, force: true }) }
})

test("artifact staging rejects a standalone build from a different static build", () => {
  const setup = fixture()
  try {
    setup.put(".next/standalone/.next/BUILD_ID", "old-build")
    assert.throws(() => stageArtifact(setup.output, setup.root), /Mismatched standalone and static builds/)
    assert.ok(!fs.existsSync(setup.output))
  } finally { fs.rmSync(setup.directory, { recursive: true, force: true }) }
})

test("artifact staging refuses credential files traced into the server artifact", () => {
  const setup = fixture()
  try {
    setup.put(".next/standalone/.next/docker.env", "synthetic credential")
    assert.throws(() => stageArtifact(setup.output, setup.root), /Credential or database file/)
  } finally { fs.rmSync(setup.directory, { recursive: true, force: true }) }
})

async function withServer(callback) {
  const state = { missing: true, wrongType: false }
  const server = http.createServer((request, response) => {
    if (request.url.startsWith("/_next/static/")) {
      response.statusCode = state.missing ? 404 : 200
      response.setHeader("Content-Type", state.wrongType || state.missing ? "text/html" : request.url.endsWith(".js") ? "application/javascript" : "text/css")
      response.end(state.missing ? "Not found" : "fixture")
      return
    }
    response.setHeader("Content-Type", "text/html")
    response.end('<div>Loading...</div><script src="/_next/static/chunks/app.js"></script><link rel="stylesheet" href="/_next/static/chunks/app.css">')
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  try { await callback("http://127.0.0.1:" + server.address().port, state) }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}

test("frontend gate rejects Loading HTML with missing JS even when documents return 200", async () => {
  await withServer(async (origin, state) => {
    await assert.rejects(verifyFrontend(origin), /Frontend asset failed/)
    state.missing = false
    assert.deepEqual(await verifyFrontend(origin), { pages: 3, assets: 2, assetStatus: 200 })
  })
})

test("frontend gate rejects HTML masquerading as a successful script response", async () => {
  await withServer(async (origin, state) => {
    state.missing = false
    state.wrongType = true
    await assert.rejects(verifyFrontend(origin), /Invalid script content type/)
  })
})
