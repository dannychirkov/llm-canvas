import { withApiBoundary } from "@/lib/apiBoundary"
import { handlers } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { AuthRequestError, enforceAuthRate, readAuthBody } from "@/lib/authHardening"

export const GET = handlers.GET

async function boundaryPOST(request: NextRequest) {
  try {
    if (request.nextUrl.pathname.endsWith("/callback/credentials")) enforceAuthRate("login-request")
    const body = await readAuthBody(request)
    return await handlers.POST(new NextRequest(request.url, { method: "POST", headers: request.headers, body }))
  } catch (error) {
    if (error instanceof AuthRequestError) return NextResponse.json({ error: error.message }, { status: error.statusCode, headers: error.statusCode === 429 ? { "Retry-After": "60" } : undefined })
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 })
  }
}

export function POST(request: NextRequest) {
  return withApiBoundary(request, () => boundaryPOST(request))
}
