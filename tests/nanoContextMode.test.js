const test = require("node:test")
const assert = require("node:assert/strict")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const { createLoader } = require("./loadSource")

const node = (id, type, data = {}) => ({ id, type, data, position: { x: 0, y: 0 } })
const edge = (source, target) => ({ id: source + "-" + target, source, target })
const image = (id, data = {}) => node(id, "media", { mediaId: id + "-media", mimeType: "image/png", ...data })
const generated = (id, type, data = {}) => node(id, type, {
  mode: "image-generation", status: "done", generatedImage: { mediaId: id + "-media", url: "/fixture.png" }, ...data
})
const target = node("T", "nanobanana", { mode: "text-to-image" })

let effects = []
const load = createLoader({
  react: { ...React, useEffect: callback => effects.push(callback) },
  "@/components/providers/SettingsProvider": { useSettings: () => ({ refresh: async () => {} }) },
  "@/components/MarkdownRenderer": () => null,
  "@/components/NodeThoughts": () => null,
  "./CustomHandle": () => null,
  "@/hooks/useNodeTokens": { useNodeTokens: () => ({ tokenPreview: null, isCalculatingTokens: false }) }
})
const { getNanoAutoMode, default: NanoBananaNode } = load("src/components/nodes/NanoBananaNode.tsx")
const service = load("src/lib/contextService.ts")

const scenarios = [
  ["hidden direct image", [image("I", { hidden: true })], [edge("I", "T")], "text-to-image", []],
  ["hidden intermediary cuts its image branch", [image("I"), node("H", "openai", { hidden: true })], [edge("I", "H"), edge("H", "T")], "text-to-image", []],
  ["visible bypass recovers the image", [image("I"), node("H", "openai", { hidden: true })], [edge("I", "H"), edge("H", "T"), edge("I", "T")], "image-edit", ["I"]],
  ["image behind a text model", [image("I"), node("A", "openai")], [edge("I", "A"), edge("A", "T")], "image-edit", ["I"]],
  ["diamond counts a shared image once", [image("I"), node("A", "openai"), node("B", "summarizer")], [edge("I", "A"), edge("I", "B"), edge("A", "T"), edge("B", "T")], "image-edit", ["I"]],
  ["two transitive images compose", [image("I"), image("J"), node("A", "notes")], [edge("I", "A"), edge("A", "T"), edge("J", "T")], "composition", ["I", "J"]],
  ["CSV alone does not select image editing", [node("C", "media", { mediaId: "csv", mimeType: "text/csv" })], [edge("C", "T")], "text-to-image", ["C"]],
  ["CSV beside one image is not composition", [image("I"), node("C", "media", { mediaId: "csv", mimeType: "text/csv" })], [edge("I", "T"), edge("C", "T")], "image-edit", ["I", "C"]],
  ["completed Nano image selects iterative", [generated("G", "nanobanana")], [edge("G", "T")], "iterative", ["G"]],
  ["transitive custom Images API output selects iterative", [generated("G", "custom"), node("A", "openai")], [edge("G", "A"), edge("A", "T")], "iterative", ["G"]],
  ["custom Chat image output selects iterative", [generated("G", "custom", { mode: "chat-image" })], [edge("G", "T")], "iterative", ["G"]],
  ["hidden completed generator is omitted", [generated("G", "custom", { hidden: true })], [edge("G", "T")], "text-to-image", []],
  ["chat-mode custom node's stale image is omitted", [generated("G", "custom", { mode: "chat" })], [edge("G", "T")], "text-to-image", []],
  ["generated image takes precedence over original images", [image("I"), generated("G", "custom")], [edge("I", "G"), edge("G", "T")], "iterative", ["G", "I"]]
]

for (const [name, ancestors, edges, expected, expectedMedia] of scenarios) {
  test("Nano mode agrees with collected attachments: " + name, async context => {
    const nodes = [...ancestors, target]
    assert.deepEqual(service.getConnectedMediaNodes("T", nodes, edges).map(value => value.id), expectedMedia)
    assert.equal(getNanoAutoMode("T", nodes, edges), expected)

    // Resolve the same canonical media through the actual browser attachment path.
    const descriptors = new Map(["window", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
    context.after(() => {
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
    })
    globalThis.window = {}
    globalThis.fetch = async url => {
      const source = ancestors.find(value => url === `/api/media/${value.data.mediaId || value.data.generatedImage?.mediaId}/base64`)
      assert.ok(source, "only fixture attachments may be fetched")
      return { ok: true, json: async () => ({ mimeType: source.data.mimeType || "image/png", dataUrl: "data:image/png;base64,AA==", csvData: "row", filename: "fixture" }) }
    }
    const actualContext = await service.assembleContextWithMedia("T", nodes, edges)
    const expectedImageIds = expectedMedia.filter(id => ancestors.find(value => value.id === id).data.mimeType !== "text/csv").map(id => id + "-media")
    assert.deepEqual(actualContext.images.map(value => value.id), expectedImageIds)
  })
}

for (const status of ["idle", "processing", "edited", "error"]) {
  test(`Nano excludes ${status} generated images but keeps their visible original image`, () => {
    const nodes = [target, image("I"), generated("G", "nanobanana", { status })]
    const edges = [edge("I", "G"), edge("G", "T")]
    assert.deepEqual(service.getConnectedMediaNodes("T", nodes, edges).map(value => value.id), ["I"])
    assert.equal(getNanoAutoMode("T", nodes, edges), "image-edit")
  })
}

test("Nano ignores videos and image references without a persisted media ID", () => {
  const nodes = [target, node("V", "media", { mediaId: "video", mimeType: "video/mp4" }), generated("G", "custom", { generatedImage: { url: "/stale.png" } })]
  nodes.push(image("I", { mediaId: undefined }))
  assert.equal(getNanoAutoMode("T", nodes, [edge("V", "T"), edge("G", "T"), edge("I", "T")]), "text-to-image")
})

test("Nano's own previous image is excluded even in a graph cycle", () => {
  const previousTarget = generated("T", "nanobanana")
  assert.equal(getNanoAutoMode("T", [previousTarget, node("A", "openai")], [edge("T", "A"), edge("A", "T")]), "text-to-image")
})

test("Nano displays the current automatic mode on both surfaces and persists graph changes", () => {
  const patches = []
  function render(nodes, edges, savedMode) {
    effects = []
    const html = renderToStaticMarkup(React.createElement(NanoBananaNode, {
      id: "T", data: { mode: savedMode }, allNodes: [...nodes, target], allEdges: edges,
      onNodeUpdate: (id, patch) => patches.push({ id, ...patch })
    }))
    for (const effect of effects) effect()
    return html
  }
  const html = render([image("I")], [edge("I", "T")], "text-to-image")
  assert.ok(html.includes("image-edit"), "collapsed mode reflects the current graph before effects")
  assert.ok(html.includes("Edit Image"), "expanded indicator reflects the current graph before effects")
  assert.deepEqual(patches.splice(0), [{ id: "T", mode: "image-edit" }])
  render([image("I")], [edge("I", "T")], "image-edit")
  assert.deepEqual(patches.splice(0), [], "unchanged automatic mode causes no write")
  const disconnected = render([image("I")], [], "image-edit")
  assert.ok(disconnected.includes("Text → Image"))
  assert.deepEqual(patches, [{ id: "T", mode: "text-to-image" }])
})
