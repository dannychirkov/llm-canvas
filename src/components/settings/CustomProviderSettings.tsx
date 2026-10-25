"use client"

import { useId, useState } from "react"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CardContent } from "@/components/ui/card"
import { useSettings } from "@/components/providers/SettingsProvider"
import type { SafeCustomEndpoint } from "@/lib/providers/customTypes"
import type { ModelInfo } from "./ModelDualListSelector"
import ModelSelectionModal from "./ModelSelectionModal"
import ProviderCardShell from "./ProviderCardShell"

const emptyForm = () => ({ label: "", baseUrl: "", apiKey: "", apiType: "openai-compatible" as "openai-compatible" | "comfyui", chatApi: "chat-completions" as "chat-completions" | "responses", workflow: "", clearWorkflow: false, authStyle: "bearer" as "bearer" | "none", models: [] as string[], contextWindow: 32000, modelContextWindows: {} as Record<string, number>, headers: "" })
const initialForm = (endpoint?: SafeCustomEndpoint) => endpoint ? { ...emptyForm(), label: endpoint.label, baseUrl: endpoint.baseUrl, apiType: endpoint.apiType ?? "openai-compatible", chatApi: endpoint.chatApi ?? "chat-completions", authStyle: endpoint.authStyle, models: endpoint.models, contextWindow: endpoint.contextWindow, modelContextWindows: endpoint.modelContextWindows ?? {} } : emptyForm()
const initialModels = (endpoint?: SafeCustomEndpoint): ModelInfo[] => [...new Set([...(endpoint?.models ?? []), ...Object.keys(endpoint?.discoveredModelContextWindows ?? {})])].map(id => ({ id, contextWindow: endpoint?.discoveredModelContextWindows?.[id] ?? 0 }))

interface CustomEndpointCardProps {
  endpoint?: SafeCustomEndpoint
  onSaved: (notice?: string) => void
  onCancel?: () => void
  setup?: boolean
  onBusyChange?: (busy: boolean) => void
}

export function CustomEndpointCard({ endpoint: configuredEndpoint, onSaved, onCancel, setup = false, onBusyChange }: CustomEndpointCardProps) {
  const [createdEndpoint, setCreatedEndpoint] = useState<SafeCustomEndpoint>()
  const endpoint = configuredEndpoint ?? createdEndpoint
  const settings = useSettings()
  const fieldId = useId()
  const [open, setOpen] = useState(!endpoint)
  const [form, setForm] = useState(() => initialForm(endpoint))
  const [models, setModels] = useState<ModelInfo[]>(() => initialModels(endpoint))
  const [modelsOpen, setModelsOpen] = useState(false)
  const [manualModel, setManualModel] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  async function action(callback: () => Promise<void>) {
    setBusy(true)
    onBusyChange?.(true)
    setError("")
    setMessage("")
    try { await callback() } catch (failure) { setError(failure instanceof Error ? failure.message : "Request failed") } finally { setBusy(false); onBusyChange?.(false) }
  }

  async function persist(selected = form.models): Promise<SafeCustomEndpoint> {
    let workflow: unknown
    if (form.workflow.trim()) {
      try { workflow = JSON.parse(form.workflow) } catch { throw new Error("Workflow must be a ComfyUI API-format JSON graph") }
    }
    let headers: Record<string, string> | undefined
    if (form.headers.trim()) {
      try { headers = JSON.parse(form.headers) } catch { throw new Error("Custom headers must be a JSON object") }
    }
    const response = await fetch("/api/providers/custom", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, id: endpoint?.id, models: selected, headers, workflow }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || "Failed to save provider")
    if (!configuredEndpoint) setCreatedEndpoint(result)
    setForm(previous => ({ ...previous, apiKey: "", headers: "", workflow: "", clearWorkflow: false, models: result.models, baseUrl: result.baseUrl }))
    return result
  }

  async function check(endpointId: string) {
    const response = await fetch("/api/providers/custom/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpointId }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || "Connection failed; add model IDs manually")
    setModels(result.modelsWithCapabilities)
    const reported = Object.keys(result.modelContextWindows).length
    setMessage(result.apiType === "comfyui" ? `Connected to ComfyUI in ${result.latencyMs} ms. ${result.workflowConfigured ? "Workflow configured." : "Add an API workflow before generating."}` : `Connected in ${result.latencyMs} ms. ${result.models.length} models; context windows reported for ${reported}.`)
    await settings.refresh()
  }

  function changeOpen(value: boolean) {
    if (setup) return
    setOpen(value)
    setShowKey(false)
    setError("")
    if (value) {
      setForm(initialForm(endpoint))
      setModels(initialModels(endpoint))
      setMessage("")
      if (endpoint) action(() => check(endpoint.id))
    } else {
      setForm(previous => ({ ...previous, apiKey: "", headers: "" }))
      if (!endpoint) onCancel?.()
    }
  }

  async function saveModels(selected: string[]) {
    if (setup) {
      setForm(previous => ({ ...previous, models: selected }))
      return
    }
    setBusy(true)
    setError("")
    try {
      await persist(selected)
      await settings.refresh()
      onSaved()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Failed to save models")
      throw failure
    } finally { setBusy(false) }
  }

  const allModels = [...new Map([...models, ...form.models.filter(id => !models.some(model => model.id === id)).map(id => ({ id, contextWindow: 0 }))].map(model => [model.id, model])).values()]
  const configured = !!endpoint && (endpoint.hasKey || endpoint.authStyle === "none")
  const readyForSetup = form.models.length > 0
    && (form.authStyle === "none" || Boolean(form.apiKey.trim() || endpoint?.hasKey))
    && (form.apiType !== "comfyui" || (!form.clearWorkflow && Boolean(form.workflow.trim() || endpoint?.hasWorkflow)))

  return (
    <>
      <ProviderCardShell title={endpoint?.label || "Custom provider"} configured={configured} modelCount={endpoint?.models.length ?? 0} open={open} onOpenChange={changeOpen}>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor={fieldId + "-name"}>Provider name</Label><Input id={fieldId + "-name"} maxLength={100} value={form.label} placeholder="OmniRoute, LM Studio, Ollama..." onChange={event => setForm({ ...form, label: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor={fieldId + "-url"}>Base URL</Label><Input id={fieldId + "-url"} type="url" placeholder={form.apiType === "comfyui" ? "http://localhost:8188" : "https://api.example.com/v1"} value={form.baseUrl} onChange={event => setForm({ ...form, baseUrl: event.target.value })} /></div>
          </div>
          <div><Label htmlFor={fieldId + "-api"}>API type</Label><select id={fieldId + "-api"} className="h-10 w-full rounded-md border bg-background px-3" value={form.apiType} onChange={event => setForm({ ...form, apiType: event.target.value as "openai-compatible" | "comfyui" })}><option value="openai-compatible">OpenAI-compatible (chat and images)</option><option value="comfyui">ComfyUI workflow API</option></select></div>
          {form.apiType === "comfyui" && <div className="space-y-2">
            <Label htmlFor={fieldId + "-workflow"}>ComfyUI API workflow (encrypted)</Label>
            <textarea id={fieldId + "-workflow"} className="min-h-40 w-full rounded-md border bg-background p-2 font-mono text-xs" value={form.workflow} placeholder={endpoint?.hasWorkflow ? "Workflow stored. Leave empty to keep it, or paste a replacement API graph." : 'Paste the exported API graph and replace its positive prompt with {{prompt}}.'} onChange={event => setForm({ ...form, workflow: event.target.value })} />
            <p className="text-xs text-muted-foreground">Use API format, not the visual editor graph. Bind text with {"{{prompt}}"}, an optional seed with {"{{seed}}"}, and uploaded image inputs with {"{{image:0}}"}. Stored workflow contents remain on the server. Add a model/workflow name below.</p>
            {endpoint?.hasWorkflow && <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.clearWorkflow} onChange={event => setForm({ ...form, clearWorkflow: event.target.checked })} />Remove stored workflow</label>}
          </div>}
          <div className="space-y-2">
            <Label htmlFor={fieldId + "-key"}>API key</Label>
            <div className="flex gap-2">
              <Input id={fieldId + "-key"} type={showKey ? "text" : "password"} autoComplete="new-password" value={form.apiKey} disabled={form.authStyle === "none"} placeholder={endpoint?.hasKey ? "•••••••••• (set; leave empty to keep)" : "Enter your API key"} onChange={event => setForm({ ...form, apiKey: event.target.value })} />
              {form.apiKey && <Button variant="outline" size="icon" aria-label={showKey ? "Hide API key" : "Show API key"} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>}
              <Button variant="outline" disabled={busy || !form.label.trim()} onClick={() => action(async () => {
                const saved = await persist()
                let notice: string | undefined
                try { await check(saved.id) } catch (failure) {
                  if (endpoint || setup) throw failure
                  notice = failure instanceof Error ? failure.message : "Connection failed; edit the saved provider to retry or enter models manually"
                }
                await settings.refresh()
                if (!endpoint && !setup) onSaved(notice)
              })}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test Connection"}</Button>
            </div>
            <p className="text-xs text-muted-foreground">{form.apiType === "comfyui" ? "ComfyUI workflow API." : "OpenAI-compatible API."} Stored keys remain on the server.</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between"><Label>Models</Label><Button variant="outline" size="sm" disabled={busy} onClick={() => setModelsOpen(true)}>Manage Models</Button></div>
            <p className="text-sm text-muted-foreground">{form.models.length} models selected. {form.apiType === "comfyui" ? "Names identify this saved workflow; configure checkpoints inside its API graph." : "Context windows are discovered per model."}</p>
            <div className="flex gap-2"><Input aria-label="Manual model ID" value={manualModel} placeholder="Model ID if discovery is unavailable" onChange={event => setManualModel(event.target.value)} /><Button variant="outline" onClick={() => {
              const model = manualModel.trim()
              if (!model) return
              setModels(previous => previous.some(item => item.id === model) ? previous : [...previous, { id: model, contextWindow: 0 }])
              setForm(previous => ({ ...previous, models: [...new Set([...previous.models, model])] }))
              setManualModel("")
            }}>Add model</Button></div>
          </div>
          <details className="space-y-3">
            <summary className="cursor-pointer text-sm">Advanced settings and context overrides</summary>
            <div className="space-y-3 pt-3">
              {form.apiType !== "comfyui" && <div><Label htmlFor={fieldId + "-chat-api"}>Chat API</Label><select id={fieldId + "-chat-api"} className="h-10 w-full rounded-md border bg-background px-3" value={form.chatApi} onChange={event => setForm({ ...form, chatApi: event.target.value as "chat-completions" | "responses" })}><option value="chat-completions">Chat Completions</option><option value="responses">Responses API</option></select></div>}
              <div><Label htmlFor={fieldId + "-auth"}>Authentication</Label><select id={fieldId + "-auth"} className="h-10 w-full rounded-md border bg-background px-3" value={form.authStyle} onChange={event => setForm({ ...form, authStyle: event.target.value as "bearer" | "none" })}><option value="bearer">Bearer key</option><option value="none">No authentication (local server)</option></select></div>
              {form.apiType !== "comfyui" && <>
              <div><Label htmlFor={fieldId + "-fallback"}>Fallback context window (only when not reported)</Label><Input id={fieldId + "-fallback"} type="number" min={128} max={100000000} value={form.contextWindow} onChange={event => setForm({ ...form, contextWindow: Number(event.target.value) })} /></div>
              {form.models.map(model => {
                const reported = allModels.find(item => item.id === model)?.contextWindow ?? 0
                return <div className="flex items-center gap-2" key={model}><span className="min-w-0 flex-1 truncate text-sm">{model} · {reported ? `${reported.toLocaleString("en-US")} reported` : "Not reported"}</span><Input className="w-40" aria-label={`Context override for ${model}`} type="number" min={128} max={100000000} placeholder="Automatic" value={form.modelContextWindows[model] ?? ""} onChange={event => {
                  const windows = { ...form.modelContextWindows }
                  if (event.target.value) windows[model] = Number(event.target.value)
                  else delete windows[model]
                  setForm({ ...form, modelContextWindows: windows })
                }} /></div>
              })}
              </>}
              <div><Label htmlFor={fieldId + "-headers"}>Custom headers (encrypted)</Label><textarea id={fieldId + "-headers"} className="w-full rounded-md border bg-background p-2 text-sm" placeholder={'{"X-Custom-Header":"value"} — leave empty to keep'} value={form.headers} onChange={event => setForm({ ...form, headers: event.target.value })} /></div>
            </div>
          </details>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {message && <p role="status" className="text-sm text-green-600">{message}</p>}
          <div className="flex gap-2 pt-2">
            <Button className="flex-1" disabled={busy || !form.label.trim() || !form.baseUrl.trim() || (setup && !readyForSetup)} onClick={() => action(async () => { await persist(); await settings.refresh(); setOpen(false); onSaved() })}>{setup ? "Finish Setup" : "Save"}</Button>
            {endpoint && !setup && <Button variant="destructive" disabled={busy} onClick={() => {
              if (!window.confirm(`Delete ${endpoint.label}? Existing nodes will need another provider.`)) return
              action(async () => { const response = await fetch("/api/providers/custom", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: endpoint.id }) }); if (!response.ok) throw new Error("Failed to delete provider"); await settings.refresh() })
            }}>Delete Provider</Button>}
            <Button variant="outline" disabled={busy} onClick={() => setup ? onCancel?.() : changeOpen(false)}>{setup ? "Previous" : "Cancel"}</Button>
          </div>
        </CardContent>
      </ProviderCardShell>
      <ModelSelectionModal open={modelsOpen} onOpenChange={setModelsOpen} provider={form.label || "Custom provider"} providerKey="custom" availableModels={allModels} selectedModels={form.models} onSave={saveModels} loading={busy} />
    </>
  )
}

export default function CustomProviderSettings({ onConfigured }: { onConfigured?: () => void }) {
  const settings = useSettings()
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState("")
  const saved = (message?: string) => { setAdding(false); setNotice(message ?? ""); onConfigured?.() }
  return <>
    {settings.customEndpoints.map(endpoint => <CustomEndpointCard key={endpoint.id} endpoint={endpoint} onSaved={() => {}} />)}
    {notice && <p role="alert" className="text-sm text-destructive">Provider saved. {notice}</p>}
    {adding ? <CustomEndpointCard onSaved={saved} onCancel={() => setAdding(false)} /> : <Button variant="outline" onClick={() => { setNotice(""); setAdding(true) }}>Add custom provider</Button>}
  </>
}
