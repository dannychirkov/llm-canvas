import { withApiBoundary } from "@/lib/apiBoundary"
import { authenticatedWorkload } from "@/lib/authenticatedWorkload"
import { readBoundedJson } from "@/lib/requestBody"
import { NextRequest, NextResponse } from "next/server"
import { requireUserId, savedProviderKey } from "@/lib/providerCredentials"
import { listProviderModels } from "@/lib/providerModels"
import { publicError, errorStatus } from "@/lib/apiErrors"

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const userId = await requireUserId()
    const { provider } = await params
    const body = await readBoundedJson(req)
    const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey : await savedProviderKey(userId, provider)
    await listProviderModels(provider, apiKey)
    return NextResponse.json({ valid: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json({ valid: false, error: publicError(error) }, { status: errorStatus(error) })
  }
}

async function boundaryPOST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  return authenticatedWorkload("metadata", () => handlePOST(req, { params }))
}

export function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  return withApiBoundary(req, () => boundaryPOST(req, { params }))
}
