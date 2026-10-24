import { NextResponse } from "next/server"

/** Browser protections for our API; authentication remains each route's responsibility. */
export function requestOriginFailure(request: Request): Response | undefined {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return
  const headers = { "Cache-Control": "no-store" }
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return NextResponse.json({ error: "Cross-site requests are not allowed" }, { status: 403, headers })
  }
  const origin = request.headers.get("origin")
  if (origin !== null) {
    const allowed = new Set([new URL(request.url).origin])
    if (process.env.AUTH_URL) {
      try { allowed.add(new URL(process.env.AUTH_URL).origin) } catch { /* Invalid configuration never adds an origin. */ }
    }
    if (!allowed.has(origin)) return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403, headers })
  }
  if (request.body !== null) {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
    const authForm = new URL(request.url).pathname.startsWith("/api/auth/") && contentType === "application/x-www-form-urlencoded"
    if (contentType !== "application/json" && contentType !== "multipart/form-data" && !authForm) {
      return NextResponse.json({ error: "Unsupported request content type" }, { status: 415, headers })
    }
  }
}
