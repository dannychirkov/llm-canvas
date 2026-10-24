import { withApiBoundary } from "@/lib/apiBoundary"
import { authenticatedWorkload } from "@/lib/authenticatedWorkload"
import { NextRequest, NextResponse } from "next/server"
import { requireUserId } from "@/lib/providerCredentials"
import { validateCustomConnection } from "@/lib/providers/customStore"
import { publicError, errorStatus } from "@/lib/apiErrors"
import { readBoundedJson } from "@/lib/requestBody"

async function handlePOST(req: NextRequest) {
  try {
    const userId = await requireUserId()
    const body = await readBoundedJson(req)
    return NextResponse.json(await validateCustomConnection(userId, body.endpointId, req.signal), { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: errorStatus(error) })
  }
}

async function boundaryPOST(req: NextRequest) {
  return authenticatedWorkload("metadata", () => handlePOST(req))
}

export function POST(req: NextRequest) {
  return withApiBoundary(req, () => boundaryPOST(req))
}
