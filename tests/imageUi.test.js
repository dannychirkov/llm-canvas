const test = require("node:test")
const assert = require("node:assert/strict")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const { createLoader } = require("./loadSource")
const fs = require("node:fs")
const ts = require("typescript")

function uiFixture(context, preview, options = {}) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "window", { configurable: true, value: { innerWidth: 1200 } })
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } })
  context.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow)
    else delete globalThis.window
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage)
    else delete globalThis.localStorage
  })
  const load = createLoader({
    "react": { ...React, useState: initial => React.useState(initial === null && preview ? preview : initial), useEffect: (effect, dependencies) => { options.effects?.push(effect); React.useEffect(effect, dependencies) } },
    "@/components/providers/SettingsProvider": { useSettings: () => ({ customEndpoints: options.customEndpoints ?? [], providers: { openai: { hasKey: true, activeModels: ["fixture"] }, gemini: { hasKey: false, activeModels: [] }, openrouter: { hasKey: false, activeModels: [] } } }) },
    "@/components/MarkdownRenderer": ({ content }) => React.createElement("p", null, content),
    "@/components/NodeThoughts": () => null,
    "./CustomHandle": () => null,
    "@/components/nodes/NodeTypeIcon": { isNavigableNodeType: () => false, getNodeTypeIcon: () => null },
    "@/hooks/useNodeTokens": { useNodeTokens: () => ({ tokenPreview: preview ?? null, isCalculatingTokens: false }) },
    "@/lib/tokenPreviewCalculator": { calculateTokenPreview: async () => null },
    "@lobehub/icons": { OpenAI: () => null }
  })
  return {
    node: load("src/components/nodes/OpenAINode.tsx").default,
    inspector: load("src/components/NodeDetailsPanel.tsx").default,
    media: load("src/components/nodes/MediaNode.tsx").default,
    summary: load("src/components/nodes/SummarizerNode.tsx").default
  }
}

for (const status of ["idle", "edited"]) test(`${status} custom inspector exposes the computed token preview`, context => {
  const ui = uiFixture(context)
  const selectedNode = { id: "custom", type: "custom", position: { x: 0, y: 0 }, data: { status, promptText: "Hello" } }
  const html = renderToStaticMarkup(React.createElement(ui.inspector, { selectedNode, isOpen: true, embedded: true, allNodes: [selectedNode], allEdges: [], onClose() {} }))
  assert.ok(html.includes("Token Preview"))
})

for (const surface of ["media", "inspector"]) test(`${surface} renders wrapped video frame metadata without a map crash`, context => {
  const ui = uiFixture(context)
  const frame = { width: 512, height: 512, timestampMs: 0, mimeType: "image/jpeg", path: "/uploads/canvases/fixture/frame.jpg" }
  const selectedNode = { id: "video", type: "media", position: { x: 0, y: 0 }, data: { mediaId: "video-media", filename: "fixture.mp4", filePath: "/uploads/canvases/fixture/video.mp4", mimeType: "video/mp4", durationMs: 1000, videoFrames: { frames: [frame] } } }
  const props = surface === "media" ? { ...selectedNode, isConnectable: false, onNodeUpdate() {} } : { selectedNode, isOpen: true, embedded: true, allNodes: [selectedNode], allEdges: [], onClose() {} }
  const html = renderToStaticMarkup(React.createElement(ui[surface], props))
  assert.ok(html.includes("fixture.mp4"))
  assert.ok(html.includes("255"))
  assert.ok(html.includes("256"))
})

for (const provider of ["custom", "openrouter", "gemini"]) test(`${provider} summary card shows chain history separately from its next input estimate`, context => {
  const preview = { contextTokens: { openai: { totalTokens: 111 }, gemini: { totalTokens: 222 } }, promptTokens: { openai: 0, gemini: 0 }, totalTokens: { openai: 111, gemini: 222 }, executedTokens: { openai: 999, gemini: 999 } }
  const ui = uiFixture(context, preview)
  const html = renderToStaticMarkup(React.createElement(ui.summary, { id: "summary", data: { status: "idle", provider, modelName: "fixture" }, isConnectable: false, onNodeUpdate() {} }))
  assert.ok(html.includes("Chain history:"))
  assert.ok(html.includes("999"))
  assert.ok(html.includes(provider === "gemini" ? "222" : "111"))
})

for (const status of ["idle", "done"]) test(`${status} summary strategy uses discovered custom capacity without replacing completed results`, context => {
  const preview = { contextTokens: { openai: { totalTokens: 6000 }, gemini: { totalTokens: 6000 } }, promptTokens: { openai: 0, gemini: 0 }, totalTokens: { openai: 6000, gemini: 6000 }, executedTokens: { openai: 0, gemini: 0 } }
  const effects = []
  const patches = []
  const ui = uiFixture(context, preview, { effects, customEndpoints: [{ id: "endpoint", label: "Fixture", models: ["fixture"], contextWindow: 32000, discoveredModelContextWindows: { fixture: 4096 } }] })
  const data = { status, provider: "custom", endpointId: "endpoint", modelName: "fixture", summaryStyle: "preserve-details", autoStrategy: "refine", contextWindow: 32000 }
  renderToStaticMarkup(React.createElement(ui.summary, { id: "summary", data, isConnectable: false, onNodeUpdate: (id, patch) => patches.push(patch) }))
  for (const effect of effects) effect()
  if (status === "done") assert.deepEqual(patches, [])
  else assert.deepEqual(patches, [{ autoStrategy: "map-reduce", contextWindow: 4096 }])
})

test("Gemini summary inspector selects Gemini estimates instead of OpenAI image estimates", context => {
  const preview = { contextTokens: { openai: { totalTokens: 111 }, gemini: { totalTokens: 222 } }, promptTokens: { openai: 0, gemini: 0 }, totalTokens: { openai: 111, gemini: 222 }, executedTokens: { openai: 0, gemini: 0 } }
  const ui = uiFixture(context, preview)
  const selectedNode = { id: "summary", type: "summarizer", position: { x: 0, y: 0 }, data: { status: "idle", provider: "gemini", promptText: "Summarize" } }
  const html = renderToStaticMarkup(React.createElement(ui.inspector, { selectedNode, isOpen: true, embedded: true, allNodes: [selectedNode], allEdges: [], onClose() {} }))
  assert.ok(html.includes("~222"))
  assert.ok(!html.includes("~111"))
})

test("inspector prompt/text/caption bind directly to canonical graph data without delayed stale writeback", () => {
  const source = fs.readFileSync("src/components/NodeDetailsPanel.tsx", "utf8")
  const tree = ts.createSourceFile("panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fields = new Map()
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ["localPromptText", "localTextContent", "localCaption"].includes(node.name.getText(tree))) fields.set(node.name.getText(tree), node.initializer.getText(tree))
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.equal(fields.size, 3)
  for (const expression of fields.values()) assert.match(expression, /selectedNode\?\.data\?\./)
  assert.ok(!source.includes("setLocalPromptText"))
  assert.ok(!source.includes("setLocalTextContent"))
  assert.ok(!source.includes("setLocalCaption"))
  assert.ok(source.includes("{ promptText: e.target.value }"))
})

for (const [usageSource, label] of [["provider", "Provider reported"], ["estimated", "Estimated"], ["unreported", "Not reported"], [undefined, "Source unavailable"]]) {
  for (const surface of ["node", "inspector"]) {
    test(`${surface} labels ${usageSource || "legacy unknown"} zero usage honestly`, context => {
      const ui = uiFixture(context)
      const data = { tokens: 0, usageSource, status: "done", responseText: "Fixture answer", modelName: "fixture" }
      if (usageSource === "provider") data.tokenBreakdown = { inputTokens: 0, outputTokens: 0 }
      const selectedNode = { id: "fixture", type: "custom", position: { x: 0, y: 0 }, data }
      const props = surface === "node"
        ? { ...selectedNode, providerKind: "custom", onNodeUpdate() {} }
        : { selectedNode, isOpen: true, embedded: true, allNodes: [selectedNode], allEdges: [], onClose() {} }
      const html = renderToStaticMarkup(React.createElement(ui[surface], props))
      assert.ok(html.includes(label))
      if (usageSource === "unreported") {
        assert.ok(!html.includes("Provider reported"))
        assert.ok(!html.includes("Token counts are estimated."))
        assert.match(html, /—|not reported by the provider/)
      } else if (surface === "node" || usageSource === "provider") {
        assert.match(html, />0</)
      } else {
        assert.match(html, /Estimated tokens: 0|Recorded total: 0/)
      }
      if (usageSource === "estimated") assert.ok(!html.includes("Provider reports"))
    })
  }
}
