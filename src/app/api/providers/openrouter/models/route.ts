import { withApiBoundary } from "@/lib/apiBoundary"
import { authenticatedWorkload } from "@/lib/authenticatedWorkload"
import { readBoundedJson } from "@/lib/requestBody"
import { NextRequest, NextResponse } from "next/server"
import { requireUserId, savedProviderKey } from "@/lib/providerCredentials"
import { listProviderModels } from "@/lib/providerModels"
import { publicError, errorStatus } from "@/lib/apiErrors"

async function handlePOST(req: NextRequest) {
  try {
    const userId = await requireUserId()
    const body = await readBoundedJson(req)
    const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey : await savedProviderKey(userId, "openrouter")
    return NextResponse.json(await listProviderModels("openrouter", apiKey), { headers: { "Cache-Control": "no-store" } })
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
