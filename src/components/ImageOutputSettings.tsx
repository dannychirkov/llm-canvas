"use client"

import { Label } from "@/components/ui/label"

interface ImageOutputSettingsProps {
  mode?: string
  imageResponseFormat?: string
  apiType?: string
  onChange: (patch: Record<string, unknown>) => void
}

export default function ImageOutputSettings({ mode = "chat", imageResponseFormat = "auto", apiType, onChange }: ImageOutputSettingsProps) {
  const comfy = apiType === "comfyui"
  return <div className="space-y-2">
    <Label>Output mode</Label>
    <select aria-label="Output mode" className="w-full rounded-md border bg-background px-3 py-2 text-sm nodrag" value={mode} onChange={event => onChange({ mode: event.target.value })}>
      {!comfy && <option value="chat">Chat</option>}
      <option value="image-generation">{comfy ? "ComfyUI workflow" : "Images API"}</option>
      <option value="image-edit">{comfy ? "ComfyUI workflow with image inputs" : "Images API editing"}</option>
      {!comfy && <option value="chat-image">Chat image output</option>}
    </select>
    {!comfy && (mode === "image-generation" || mode === "image-edit") && <>
      <Label>Image response format</Label>
      <select aria-label="Image response format" className="w-full rounded-md border bg-background px-3 py-2 text-sm nodrag" value={imageResponseFormat} onChange={event => onChange({ imageResponseFormat: event.target.value })}>
        <option value="auto">Provider default (GPT Image)</option>
        <option value="b64_json">Request base64 (legacy APIs)</option>
      </select>
    </>}
    {mode !== "chat" && <p className="text-xs text-muted-foreground">{comfy ? "Runs the configured API workflow. Image inputs require workflow bindings; outputs are stored as private canvas media." : "Requires a compatible model and gateway. Images API editing needs connected source images. Outputs must contain inline PNG, JPEG or WebP data; arbitrary result URLs are not fetched."}</p>}
  </div>
}
