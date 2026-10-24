const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const ts = require("typescript")
const React = require("react")
const { JSDOM } = require("jsdom")
const { createLoader } = require("../loadSource")

function editorExpressions() {
  const tree = ts.createSourceFile("editor.tsx", fs.readFileSync("src/components/CanvasEditor.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const callbacks = new Map()
  let synchronization
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ["onNodeUpdate", "runNode", "onRunSelectedNodes", "onRestore"].includes(node.name.getText(tree))) callbacks.set(node.name.getText(tree), node.initializer.getText(tree))
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "useEffect" && node.getText(tree).includes("nodesRef.current = nodes")) synchronization = node.getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.equal(callbacks.size, 4)
  assert.ok(synchronization)
  const code = [...callbacks].map(([name, value]) => "const " + name + "=" + value).join("\n").replaceAll('await import("@/lib/contextService")', "contextServiceFixture")
  return ts.transpileModule(code + "\n" + synchronization + ";\nmodule.exports={onNodeUpdate,runNode,onRunSelectedNodes,onRestore}", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}

function completion(text, extra = {}) {
  return new Response("data: " + JSON.stringify({ done: true, fullResponse: text, tokens: 0, usageSource: "provider", tokenBreakdown: { inputTokens: 0, outputTokens: 0 }, ...extra }) + "\n\n")
}

async function mountEditor(options) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://fixture.invalid" })
  const previous = new Map()
  const requests = []
  const fetchRequest = async (url, init = {}) => {
    const request = { url: String(url), body: typeof init.body === "string" ? JSON.parse(init.body) : null }
    requests.push(request)
    return options.fetch(url, init, request)
  }
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true, fetch: fetchRequest }
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  const { createRoot } = require("react-dom/client")
  const root = createRoot(dom.window.document.getElementById("root"))
  const load = createLoader()
  const contextServiceFixture = load("src/lib/contextService.ts")
  const { debugPreview, compactNodeData } = load("src/lib/debugPayload.ts")
  const { usageTotal } = load("src/lib/tokenUsage.ts")
  const { patchExecutionNode } = load("src/lib/nodeExecutionState.ts")
  const { runSelectedGraph } = load("src/lib/selectedExecution.ts")
  const { getNanoAutoMode } = load("src/lib/nanoContextMode.ts")
  const code = editorExpressions()
  const latest = { current: null }
  function Harness() {
    const [nodes, setNodes] = React.useState(options.nodes)
    const [edges, setEdges] = React.useState(options.edges ?? [])
    const nodesRef = React.useRef(options.nodes)
    const edgesRef = React.useRef(options.edges ?? [])
    const activeRunsRef = React.useRef(new Set())
    const moduleRecord = { exports: {} }
    vm.runInNewContext(code, {
      module: moduleRecord, useCallback: React.useCallback, useEffect: React.useEffect,
      nodes, edges, setNodes, nodesRef, edgesRef, activeRunsRef, canvasId: options.canvasId ?? "fixture", isSaved: false,
      isInitializedRef: { current: true }, lastSavedSnapshotRef: { current: "initialized" },
      setIsDirty() {}, setIsSaved() {}, trackNodeEdited() {}, saveLastUsedModel() {}, setCanvasTotalTokensUsed() {},
      contextServiceFixture, debugPreview, compactNodeData, usageTotal, patchExecutionNode, runSelectedGraph, getNanoAutoMode,
      showToast: message => options.onToast?.(message), fetch: fetchRequest,
      TextDecoder, TextEncoder, Error, SyntaxError, JSON, Date, Promise,
      console: { error() {}, warn() {} }
    })
    React.useLayoutEffect(() => { latest.current = { ...moduleRecord.exports, nodes, edges, nodesRef, setEdges } })
    return null
  }
  const dispose = async () => {
    try { await React.act(async () => { root.unmount() }) }
    finally {
      dom.window.close()
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else delete globalThis[name]
      }
    }
  }
  try { await React.act(async () => { root.render(React.createElement(Harness)) }) }
  catch (error) { await dispose(); throw error }
  const begin = async (name, argument) => {
    let pending
    await React.act(async () => { pending = latest.current[name](argument) })
    return { pending }
  }
  return {
    requests,
    nodes: () => latest.current.nodes,
    state: id => latest.current.nodes.find(node => node.id === id)?.data,
    async run(id) { await React.act(async () => { await latest.current.runNode(id) }) },
    async update(id, patch) { await React.act(async () => { latest.current.onNodeUpdate(id, patch) }) },
    async restore(id) { await React.act(async () => { latest.current.onRestore(id) }) },
    async edges(value) { await React.act(async () => { latest.current.setEdges(value) }) },
    beginRun: id => begin("runNode", id),
    beginBatch: ids => begin("onRunSelectedNodes", ids),
    async finish(handle) { await React.act(async () => { await handle.pending }) },
    dispose
  }
}

module.exports = { mountEditor, completion }
