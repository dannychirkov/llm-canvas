import { ApiError } from "@/lib/apiErrors"
import { readRequestBytes } from "./requestBytes"

export async function readBoundedFormData(request: Request, maxBytes: number): Promise<FormData> {
  const bytes = await readRequestBytes(request, maxBytes, 120_000)
  try { return await new Response(new Uint8Array(bytes), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData() } catch { throw new ApiError("Invalid multipart form data") }
}
