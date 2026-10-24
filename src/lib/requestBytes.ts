import { ApiError } from "./apiErrors"

export async function readRequestBytes(request: Request, limit: number, timeoutMs = 15_000): Promise<Buffer> {
  const declared = request.headers.get("content-length")
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > limit)) throw new ApiError("Request body exceeds the size limit", 413)
  if (!request.body) throw new ApiError("Request body is required")
  if (request.signal.aborted) throw new ApiError("Request was cancelled", 408)
  const reader = request.body.getReader()
  let interrupt: (error: ApiError) => void = () => {}
  const interrupted = new Promise<never>((_, reject) => { interrupt = reject })
  const cancel = () => { void reader.cancel().catch(() => {}) }
  const aborted = () => { interrupt(new ApiError("Request was cancelled", 408)); cancel() }
  const timer = setTimeout(() => { interrupt(new ApiError("Request body timed out", 408)); cancel() }, timeoutMs)
  request.signal.addEventListener("abort", aborted, { once: true })
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const next = await Promise.race([reader.read(), interrupted])
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > limit) throw new ApiError("Request body exceeds the size limit", 413)
      chunks.push(next.value)
    }
    return Buffer.concat(chunks, bytes)
  } catch (error) {
    cancel()
    throw error
  } finally {
    clearTimeout(timer)
    request.signal.removeEventListener("abort", aborted)
    reader.releaseLock()
  }
}
