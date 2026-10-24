export function readGeminiText(json: unknown): string {
  try {
    const candidates = (json as { candidates?: unknown[] })?.candidates || []
    if (!Array.isArray(candidates) || candidates.length === 0) return ""
    const parts = (candidates[0] as { content?: { parts?: unknown[] } })?.content?.parts || []
    if (!Array.isArray(parts)) return ""
    return parts.map((p: unknown) => (p as { text?: string })?.text || "").filter(Boolean).join("\n")
  } catch {
    return ""
  }
}
