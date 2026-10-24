const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const { createLoader } = require("./loadSource")

function callbacks(names, context) {
  const tree = ts.createSourceFile("editor.tsx", fs.readFileSync("src/components/CanvasEditor.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const selected = new Map()
  function visit(node) {
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(tree))) selected.set(node.name.getText(tree), node.initializer.getText(tree))
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.equal(selected.size, names.length)
  const source = names.map(name => "const " + name + " = " + selected.get(name)).join("\n").replaceAll('await import("@/lib/contextService")', "contextServiceFixture") + "\nmodule.exports={" + names.join(",") + "}"
  const moduleRecord = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { activeRunsRef: { current: new Set() }, showToast() {}, ...context, module: moduleRecord, useCallback: callback => callback })
  return moduleRecord.exports
}

test("save-and-leave preserves navigation and dirty snapshot when the save fails", async () => {
  let navigated = false
  const snapshot = { current: "unchanged" }
  const editor = callbacks(["saveCanvas", "handleSaveAndLeave"], {
    nodes: [], edges: [], canvasId: "fixture", setIsSaving() {}, setIsSaved() {}, setIsDirty() {},
    lastSavedSnapshotRef: snapshot, localStorage: { getItem: () => null },
    nodesRef: { current: [] }, edgesRef: { current: [] }, savingRef: { current: false }, revisionRef: { current: "2026-10-23T00:00:00.000Z" },
    fetch: async () => new Response("failure", { status: 500 }), alert() {}, console: { error() {}, warn() {} },
    pendingNavigation: () => { navigated = true }, setTimeout() {}
  })
  await editor.handleSaveAndLeave()
  assert.equal(navigated, false)
  assert.equal(snapshot.current, "unchanged")
})

test("image-only completion preserves final text, image and exact output snapshot without progress frames", async () => {
  const original = { id: "node", type: "custom", data: { promptText: "Draw", modelName: "image", endpointId: "gateway", mode: "image-generation" } }
  const nodesRef = { current: [original] }
  const generatedImage = { url: "/uploads/canvases/fixture/image.png", mediaId: "media", width: 1, height: 1 }
  const { usageTotal } = createLoader()("src/lib/tokenUsage.ts")
  const editor = callbacks(["runNode"], {
    nodesRef, edgesRef: { current: [] }, canvasId: "fixture", contextServiceFixture: { assembleContextWithMedia: async () => ({ text: "", images: [], csvFiles: [], videos: [] }) },
    debugPreview: value => value, usageTotal, saveLastUsedModel() {}, setCanvasTotalTokensUsed() {},
    onNodeUpdate(id, patch) { nodesRef.current = nodesRef.current.map(node => ({ ...node, data: { ...node.data, ...patch } })) },
    fetch: async () => new Response("data: " + JSON.stringify({ done: true, fullResponse: "Generated image", generatedImage, tokens: 0, usageSource: "provider", tokenBreakdown: { inputTokens: 0, outputTokens: 0 } }) + "\n\n"),
    TextDecoder, TextEncoder, console: { error() {}, warn() {} }
  })
  await editor.runNode("node")
  const result = nodesRef.current[0].data
  assert.equal(result.status, "done")
  assert.equal(result.responseText, "Generated image")
  assert.equal(result.lastExecutionState.generatedImage.mediaId, "media")
  assert.equal(result.lastExecutionState.imageResponseFormat, "auto")
  assert.equal(result.lastExecutionState.tokens, 0)
})

test("a successful save confirms its revision but preserves edits made while saving", async () => {
  const original = [{ id: "node", data: { promptText: "original" } }]
  const nodesRef = { current: original }
  const revisionRef = { current: "2026-10-23T00:00:00.000Z" }
  const lastSavedSnapshotRef = { current: "baseline" }
  let dirty
  let navigated = false
  let submitted
  const editor = callbacks(["saveCanvas", "handleSaveAndLeave"], {
    nodes: original, edges: [], canvasId: "fixture", nodesRef, edgesRef: { current: [] }, savingRef: { current: false }, revisionRef,
    compactCanvasDocument: value => value, setIsSaving() {}, setIsSaved() {}, setIsDirty(value) { dirty = value },
    lastSavedSnapshotRef, localStorage: { getItem: () => null },
    fetch: async (url, options) => {
      submitted = JSON.parse(options.body)
      nodesRef.current = [{ id: "node", data: { promptText: "new draft" } }]
      return Response.json({ updatedAt: "2026-10-23T00:00:01.000Z" })
    }, alert() {}, console: { error() {}, warn() {} }, pendingNavigation: () => { navigated = true }, setTimeout() {}
  })
  await editor.handleSaveAndLeave()
  assert.equal(navigated, false)
  assert.equal(dirty, true)
  assert.equal(submitted.expectedUpdatedAt, "2026-10-23T00:00:00.000Z")
  assert.equal(revisionRef.current, "2026-10-23T00:00:01.000Z")
  assert.equal(JSON.parse(lastSavedSnapshotRef.current).nodes[0].data.promptText, "original")
})

test("Undo restores deleted custom-node content, endpoint and token usage", () => {
  const source = ts.createSourceFile("history.ts", fs.readFileSync("src/hooks/useCanvasHistory.ts", "utf8"), ts.ScriptTarget.Latest, true)
  const helper = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "extractStructuralData")
  const moduleRecord = { exports: {} }
  vm.runInNewContext(ts.transpileModule(helper.getText(source) + "\nmodule.exports=extractStructuralData", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { module: moduleRecord })
  const data = { promptText: "Question", responseText: "Answer", endpointId: "gateway", tokens: 170, tokenBreakdown: { inputTokens: 128, outputTokens: 42 } }
  const snapshot = moduleRecord.exports([{ id: "deleted", type: "custom", position: { x: 1, y: 2 }, data }], [])
  let restored
  callbacks(["handleUndo"], { nodes: [], edges: [], undo: () => snapshot, historyLimitReachedRef: { current: false }, setNodes: callback => { restored = callback([]) }, setEdges() {}, showToast() {} }).handleUndo()
  assert.equal(restored[0].data, data)
  assert.equal(restored[0].data.tokens, 170)
})

test("stable node renderers receive current graph data after content-only edits", () => {
  let nodes = [{ id: "upstream", data: { textContent: "first" } }]
  const mockNode = props => React.createElement("span", null, props.allNodes?.[0]?.data.textContent)
  const overrides = { reactflow: { useNodes: () => nodes, useEdges: () => [] } }
  for (const name of ["Text", "Summarizer", "Gemini", "OpenAI", "OpenRouter", "NanoBanana", "Media", "Memory", "Notes", "Test"]) overrides["./nodes/" + name + "Node"] = mockNode
  const types = createLoader(overrides)("src/components/nodeTypes.tsx").createNodeTypes(() => {}, () => {}, () => {})
  const component = types.custom
  const first = renderToStaticMarkup(React.createElement(component, { id: "target", data: {} }))
  nodes = [{ id: "upstream", data: { textContent: "updated" } }]
  const second = renderToStaticMarkup(React.createElement(component, { id: "target", data: {} }))
  assert.ok(first.includes("first"))
  assert.ok(second.includes("updated"))
  assert.equal(types.custom, component)
})
