import { readRequestBytes } from "./requestBytes"
import { ApiError } from "./apiErrors"

export async function readBoundedJson(request: Request, limit = 64 * 1024, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  const bytes = await readRequestBytes(request, limit, timeoutMs)
  let body: unknown
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) } catch { throw new ApiError("Invalid request JSON") }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError("Request body must be an object")
  return body as Record<string, unknown>
}
