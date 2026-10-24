import { withApiBoundary } from "@/lib/apiBoundary"
import { authenticatedWorkload } from "@/lib/authenticatedWorkload"
import { readBoundedJson } from "@/lib/requestBody"
import { resolveCustomEndpoint } from "@/lib/providers/customStore"
import { customModelContextWindow } from "@/lib/providers/customTypes"
import { NextRequest, NextResponse } from "next/server"
import { requireUserId, savedProviderKey } from "@/lib/providerCredentials"
import { listProviderModels } from "@/lib/providerModels"
import { ApiError, publicError, errorStatus } from "@/lib/apiErrors"

async function modelsFor(provider: string) {
  const userId = await requireUserId()
  return listProviderModels(provider, await savedProviderKey(userId, provider))
}

async function handlePOST(req: NextRequest) {
  try {
    const body = await readBoundedJson(req)
    if (typeof body.provider !== "string" || typeof body.modelName !== "string") throw new ApiError("Provider and model identifiers are required")
    if (body.apiKey !== undefined) throw new ApiError("Send provider and model identifiers only")
    if (body.provider === "custom") {
      const endpoint = await resolveCustomEndpoint(await requireUserId(), body.endpointId)
      return NextResponse.json({ provider: "custom", modelName: body.modelName, contextWindow: customModelContextWindow(endpoint, body.modelName), capabilities: { vision: true, function_calling: false, json_mode: false } })
    }
    const data = await modelsFor(body.provider)
    const model = data.modelsWithCapabilities.find(model => model.id === body.modelName)
    if (!model) throw new ApiError("Model not found", 404)
    return NextResponse.json({ provider: body.provider, modelName: body.modelName, contextWindow: model.contextWindow, capabilities: model.capabilities })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: errorStatus(error) })
  }
}

async function handleGET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    if (url.searchParams.has("apiKey")) throw new ApiError("Keys in URLs are not supported")
    const provider = url.searchParams.get("provider") ?? ""
    if (provider === "custom") {
      const endpoint = await resolveCustomEndpoint(await requireUserId(), url.searchParams.get("endpointId"))
      return NextResponse.json({ provider, models: endpoint.models.map(id => ({ id, contextWindow: customModelContextWindow(endpoint, id) })) })
    }
    const data = await modelsFor(provider)
    return NextResponse.json({ provider, models: data.modelsWithCapabilities })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: errorStatus(error) })
  }
}

async function boundaryPOST(req: NextRequest) {
  return authenticatedWorkload("metadata", () => handlePOST(req))
}

export function GET(req: NextRequest) {
  return authenticatedWorkload("metadata", () => handleGET(req))
}

export function POST(req: NextRequest) {
  return withApiBoundary(req, () => boundaryPOST(req))
}
