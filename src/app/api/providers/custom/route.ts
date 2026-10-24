import { withApiBoundary } from "@/lib/apiBoundary"
import { authenticatedWorkload } from "@/lib/authenticatedWorkload"
import { NextRequest, NextResponse } from "next/server"
import { requireUserId } from "@/lib/providerCredentials"
import { saveCustomEndpoint, deleteCustomEndpoint } from "@/lib/providers/customStore"
import { publicError, errorStatus } from "@/lib/apiErrors"
import { readBoundedJson } from "@/lib/requestBody"

async function handlePOST(req: NextRequest) {
  try {
    const userId = await requireUserId()
    const endpoint = await saveCustomEndpoint(userId, await readBoundedJson(req, 2 * 1024 * 1024))
    return NextResponse.json(endpoint, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: errorStatus(error) })
  }
}

async function handleDELETE(req: NextRequest) {
  try {
    const userId = await requireUserId()
    await deleteCustomEndpoint(userId, (await readBoundedJson(req)).id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: errorStatus(error) })
  }
}

async function boundaryPOST(req: NextRequest) {
  return authenticatedWorkload("write", () => handlePOST(req))
}

async function boundaryDELETE(req: NextRequest) {
  return authenticatedWorkload("write", () => handleDELETE(req))
}

export function POST(req: NextRequest) {
  return withApiBoundary(req, () => boundaryPOST(req))
}

export function DELETE(req: NextRequest) {
  return withApiBoundary(req, () => boundaryDELETE(req))
}
