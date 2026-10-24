import { withApiBoundary } from "@/lib/apiBoundary"
import { authenticatedWorkload } from "@/lib/authenticatedWorkload"
import { readBoundedJson } from "@/lib/requestBody"
import { NextRequest, NextResponse } from "next/server"
import { requireUserId, savedProviderKey } from "@/lib/providerCredentials"
import { ApiError, publicError, errorStatus } from "@/lib/apiErrors"

async function handlePOST(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" }
  try {
    const userId = await requireUserId()
    const body = await readBoundedJson(req)
    if (typeof body.provider !== "string") throw new ApiError("Provider is required")
    const apiKey = await savedProviderKey(userId, body.provider)
    return NextResponse.json({ apiKey }, { headers })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: errorStatus(error), headers })
  }
}



async function boundaryPOST(req: NextRequest) {
  return authenticatedWorkload("metadata", () => handlePOST(req))
}

export function POST(req: NextRequest) {
  return withApiBoundary(req, () => boundaryPOST(req))
}
