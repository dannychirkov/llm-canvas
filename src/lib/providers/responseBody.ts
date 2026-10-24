import { ApiError } from "@/lib/apiErrors"

export const MAX_PROVIDER_RESPONSE_BYTES = 32 * 1024 * 1024

export async function readProviderJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > MAX_PROVIDER_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new ApiError("Provider response exceeds the 32 MiB limit", 502)
  }
  if (!response.body) throw new ApiError("Provider returned no response body", 502)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_PROVIDER_RESPONSE_BYTES) throw new ApiError("Provider response exceeds the 32 MiB limit", 502)
      chunks.push(chunk.value)
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) } catch { throw new ApiError("Provider returned malformed JSON", 502) }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
