const test = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const { createLoader } = require("./loadSource")

function fixture(paths, workspace, { symlinks = [], missing = [], failure } = {}) {
  const inspected = []
  const api = createLoader({
    path: {
      ...paths,
      // Keep the loader's real cwd; resolve application paths in the target OS.
      resolve: (cwd, ...parts) => {
        assert.equal(cwd, process.cwd())
        return paths.resolve(workspace, ...parts)
      },
    },
    fs: {
      lstatSync: current => {
        inspected.push(current)
        if (failure) throw failure
        if (missing.includes(current)) throw Object.assign(new Error("Missing"), { code: "ENOENT" })
        return { isSymbolicLink: () => symlinks.includes(current) }
      },
    },
  })("src/lib/publicPath.ts")
  return { ...api, inspected, root: paths.join(workspace, "public") }
}

for (const [platform, paths, workspace] of [
  ["POSIX", path.posix, "/srv/llm-canvas"],
  ["Windows", path.win32, "C:\\Users\\Desktop User\\llm-canvas"],
  ["Windows UNC", path.win32, "\\\\desktop\\share\\llm-canvas"],
]) {
  test(`${platform}: owned media resolves and every path component is inspected`, () => {
    const api = fixture(paths, workspace)
    const parts = ["uploads", "canvases", "owned", "nested", "image.png"]
    const expected = paths.join(api.root, ...parts)
    assert.equal(api.resolvePublicPath("/uploads/canvases/owned/nested/image.png", "owned", { allowLegacy: false }), expected)
    assert.deepEqual(api.inspected, parts.map((_, index) => paths.join(api.root, ...parts.slice(0, index + 1))))
    assert.equal(api.resolvePublicPath("uploads/canvases/owned/image.png", "owned"), paths.join(api.root, "uploads/canvases/owned/image.png"))
    assert.equal(api.resolvePublicPath("/canvases/owned/legacy.png", "owned"), paths.join(api.root, "canvases/owned/legacy.png"))
    assert.equal(api.resolvePublicPath("/uploads/canvases/owned/..preview.png", "owned"), paths.join(api.root, "uploads/canvases/owned/..preview.png"))
  })

  test(`${platform}: traversal and invalid ownership fail before filesystem access`, () => {
    const api = fixture(paths, workspace)
    for (const candidate of [
      "../outside.png",
      "/uploads/canvases/owned/../foreign/image.png",
      "/uploads/canvases/owned/./image.png",
      "/uploads/canvases/owned\\..\\foreign\\image.png",
      "/uploads/canvases/owned/nested\\image.png",
      "/uploads/canvases/owned/%2e%2e/foreign/image.png",
      "/uploads/canvases/owned/%252e%252e/image.png",
      "/uploads/canvases/owned/%5c..%5cimage.png",
      "/uploads/canvases/foreign/image.png",
      "/uploads/canvases/owned/image.png?download=1",
    ]) assert.throws(() => api.resolvePublicPath(candidate, "owned"), /Invalid media path/, candidate)
    assert.throws(() => api.resolvePublicPath("/uploads/canvases/owned/image.png", "../owned"), /Invalid storage identifier/)
    assert.throws(() => api.resolvePublicPath("/canvases/owned/image.png", "owned", { allowLegacy: false }), /Invalid media path/)
    assert.deepEqual(api.inspected, [])
  })

  test(`${platform}: public root, sibling prefixes and outside paths fail containment`, () => {
    const api = fixture(paths, workspace)
    for (const candidate of [
      api.root,
      paths.dirname(api.root),
      paths.join(workspace, "public-other", "image.png"),
      paths.resolve(api.root, "..", "outside.png"),
      paths.join("public", "uploads", "image.png"),
      ...(paths === path.win32 ? ["D:\\outside\\image.png", "\\\\other\\share\\image.png", "C:public\\image.png"] : []),
    ]) assert.throws(() => api.assertNoSymlinks(candidate), /Invalid media path/, candidate)
    assert.deepEqual(api.inspected, [])
  })

  test(`${platform}: symlinks at every media component fail closed`, () => {
    const parts = ["uploads", "canvases", "owned", "nested", "image.png"]
    for (let index = 0; index < parts.length; index++) {
      const symlink = paths.join(workspace, "public", ...parts.slice(0, index + 1))
      const api = fixture(paths, workspace, { symlinks: [symlink] })
      assert.throws(() => api.resolvePublicPath("/uploads/canvases/owned/nested/image.png", "owned"), /Invalid media path/)
      assert.equal(api.inspected.length, index + 1)
      assert.equal(api.inspected.at(-1), symlink)
    }
  })

  test(`${platform}: missing descendants permit creation, other filesystem errors propagate`, () => {
    const missing = paths.join(workspace, "public", "uploads", "canvases", "owned")
    const api = fixture(paths, workspace, { missing: [missing] })
    assert.equal(api.resolvePublicPath("/uploads/canvases/owned/new.png", "owned"), paths.join(missing, "new.png"))
    assert.equal(api.inspected.at(-1), missing)
    assert.equal(api.inspected.length, 3)
    const failure = Object.assign(new Error("Access denied"), { code: "EACCES" })
    const denied = fixture(paths, workspace, { failure })
    assert.throws(() => denied.resolvePublicPath("/uploads/canvases/owned/image.png", "owned"), error => error === failure)
  })
}
