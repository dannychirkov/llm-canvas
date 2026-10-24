const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const ts = require("typescript")
const { addEdge } = require("reactflow")
const { createLoader } = require("./loadSource")
const load = createLoader()
const { persistentCanvasEdges } = load("src/lib/canvasConnections.ts")
const { parseCanonicalGraph } = load("src/lib/canonicalGraph.ts")

function fixture() {
  const tree = ts.createSourceFile("editor.tsx", fs.readFileSync("src/components/CanvasEditor.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = ["onConnectStart", "onConnect", "onConnectEnd", "createNodeFromHandle"]
  const expressions = new Map()
  function visit(node) { if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(tree))) expressions.set(node.name.getText(tree), node.initializer.getText(tree)); ts.forEachChild(node, visit) }
  visit(tree)
  const nodes = ["a", "b"].map(id => ({ id, type: "custom", data: {}, position: { x: 0, y: 0 } }))
  const context = { nodes, nodesRef: { current: nodes }, edges: [], handleMenuSourceNode: null, temporaryEdge: null, handleMenuEndPos: { x: 0, y: 0 }, connectionSuccessful: false, connectionSuccessfulRef: { current: false }, GRID_SIZE: 20, canvasId: "fixture", crypto: { randomUUID: () => "new-node" },
    useCallback: callback => callback, flushSync: callback => callback(), addEdge, persistentCanvasEdges,
    reactFlowInstance: { project: value => value }, reactFlowWrapper: { current: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } },
    getInitialData: () => ({}), trackNodeAdded() {}, history: [], pushHistory(nodes, edges) { context.history.push({ nodes, edges }) },
    setNodes(update) { context.nodes = update(context.nodes) }, setEdges(update) { context.edges = update(context.edges) },
    setTemporaryEdge(value) { context.temporaryEdge = value }, setHandleMenuSourceNode(value) { context.handleMenuSourceNode = value },
    setConnectionSuccessful(value) { context.connectionSuccessful = value }, setIsConnecting() {}, setHandleMenuOpen() {}, setHandleMenuPos() {}, setHandleMenuEndPos(value) { context.handleMenuEndPos = value }, module: { exports: {} }
  }
  const code = names.map(name => "const " + name + "=" + expressions.get(name)).join("\n") + "\nmodule.exports={" + names.join(",") + "}"
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { context, ...context.module.exports }
}

test("handle dragging never puts a nonexistent target in the persistent graph or Undo snapshot", () => {
  const state = fixture()
  state.onConnectStart({}, { nodeId: "a", handleType: "source", handleId: null })
  assert.equal(state.context.edges.length, 0)
  state.onConnect({ source: "a", target: "b", sourceHandle: null, targetHandle: null })
  state.onConnectEnd({ clientX: 10, clientY: 10 })
  assert.equal(state.context.temporaryEdge, null)
  assert.equal(state.context.edges.length, 1)
  assert.equal(state.context.history[0].edges.length, 0)
  assert.doesNotThrow(() => parseCanonicalGraph(state.context))
})

for (const handleType of ["source", "target"]) test(`creating a node from a ${handleType} handle preserves direction and the actual handle ID`, () => {
  const state = fixture()
  state.onConnectStart({}, { nodeId: "a", handleType, handleId: "named-handle" })
  state.onConnectEnd({ changedTouches: [{ clientX: 80, clientY: 120 }] })
  state.createNodeFromHandle("custom")
  const edge = state.context.edges[0]
  assert.equal(edge.source, handleType === "source" ? "a" : "new-node")
  assert.equal(edge.target, handleType === "source" ? "new-node" : "a")
  assert.equal(edge[handleType === "source" ? "sourceHandle" : "targetHandle"], "named-handle")
  assert.doesNotThrow(() => parseCanonicalGraph(state.context))
})

test("legacy sentinel cleanup removes only known dangling drag edges and preserves real or independently invalid links", () => {
  const nodes = [{ id: "a", data: {} }, { id: "b", data: {} }]
  const real = { id: "real", source: "a", target: "b" }
  const invalid = { id: "unrelated", source: "missing", target: "b" }
  assert.deepEqual(persistentCanvasEdges(nodes, [real, { id: "temp-edge", source: "a", target: "temp-target" }, invalid]), [real, invalid])
  const named = { id: "temp-edge", source: "a", target: "temp-target" }
  assert.deepEqual(persistentCanvasEdges([...nodes, { id: "temp-target", data: {} }], [named]), [named])
})
