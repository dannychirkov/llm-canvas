const test = require("node:test")
const assert = require("node:assert/strict")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const { createLoader } = require("./loadSource")

test("custom model discovery uses individual gateway metadata, not a shared guess", () => {
  const { parseCustomModels } = createLoader()("src/lib/providers/customModels.ts")
  const result = parseCustomModels({ data: [
    { id: "small", context_length: 4096, max_input_tokens: 3072 },
    { id: "large", context_window: 200000 },
    { id: "router", top_provider: { context_length: 128000 } },
    { id: "local", max_model_len: "32768" },
    { id: "unknown", max_output_tokens: 8192 }
  ] })
  assert.deepEqual(result.modelContextWindows, { small: 4096, large: 200000, router: 128000, local: 32768 })
  assert.equal(result.modelsWithCapabilities.find(model => model.id === "unknown").contextWindow, 0)
})

test("context metadata rejects invalid limits and preserves old fallback contracts", () => {
  const load = createLoader()
  const { parseCustomModels } = load("src/lib/providers/customModels.ts")
  const result = parseCustomModels({ data: [{ id: "invalid", context_length: -1, context_window: Infinity, max_model_len: true }, { id: "input", max_input_tokens: 16384 }] })
  assert.deepEqual(result.modelContextWindows, { input: 16384 })
  const { customModelContextWindow } = load("src/lib/providers/customTypes.ts")
  const endpoint = { contextWindow: 32000, discoveredModelContextWindows: { known: 200000 }, modelContextWindows: { known: 64000 } }
  assert.equal(customModelContextWindow(endpoint, "known"), 64000)
  assert.equal(customModelContextWindow({ ...endpoint, modelContextWindows: {} }, "known"), 200000)
  assert.equal(customModelContextWindow(endpoint, "unknown"), 32000)
})

test("built-in and custom cards share their shell and English status labels", () => {
  const endpoint = { id: "fixture", label: "Fixture gateway", baseUrl: "http://fixture.invalid/v1", authStyle: "bearer", models: ["small"], contextWindow: 32000, discoveredModelContextWindows: { small: 4096 }, hasKey: true, hasHeaders: false }
  const load = createLoader({ "@/components/providers/SettingsProvider": { useSettings: () => ({ customEndpoints: [endpoint], refresh: async () => {} }) } })
  const builtin = load("src/components/settings/ProviderCompactCard.tsx").default
  const custom = load("src/components/settings/CustomProviderSettings.tsx").default
  const markup = [renderToStaticMarkup(React.createElement(builtin, { provider: "openai", title: "OpenAI", hasKey: true, activeModels: ["small"], onApiKeyChange: async () => {}, onModelsChange: async () => {}, onTestKey: async () => ({ valid: true }) })), renderToStaticMarkup(React.createElement(custom))]
  for (const html of markup) {
    assert.ok(html.includes("Configured") && html.includes("1 models active") && html.includes("Edit"))
    assert.ok(!/[\u0400-\u04ff]/.test(html))
    assert.ok(!html.includes('"enc"'))
  }
  assert.ok(markup[1].includes("Add custom provider"))
})
