import { withApiBoundary } from "@/lib/apiBoundary"
import { readBoundedJson } from "@/lib/requestBody"
import { ApiError } from "@/lib/apiErrors"
import { authenticatedWorkload } from "@/lib/authenticatedWorkload"
import { customEndpoints, safeCustomEndpoint } from "@/lib/providers/customTypes"
import type { CredentialProviderId } from "@/lib/providers/registry"
import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { encryptString, decryptString } from "@/lib/crypto"

type ProviderKey = CredentialProviderId

interface ProviderSettings {
  enc?: string // base64(iv+ciphertext) of API key
  activeModels: string[]
  lastVerifiedAt?: string | null
}

interface SettingsShape {
  openai: ProviderSettings
  gemini: ProviderSettings
  openrouter: ProviderSettings
}

function emptySettings(): SettingsShape {
  return {
    openai: { activeModels: [], lastVerifiedAt: null },
    gemini: { activeModels: [], lastVerifiedAt: null },
    openrouter: { activeModels: [], lastVerifiedAt: null },
  }
}

export async function GET(_req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const settings = await prisma.userSettings.findUnique({
      where: { userId: session.user.id },
    })

    const providers = { ...emptySettings(), ...((settings?.providers as SettingsShape | undefined) || {}) }

    // Never return decrypted keys; only flags about presence
    const safe = {
      custom: customEndpoints(settings?.providers).map(safeCustomEndpoint),
      openai: { hasKey: Boolean(providers.openai.enc), activeModels: providers.openai.activeModels, lastVerifiedAt: providers.openai.lastVerifiedAt ?? null },
      gemini: { hasKey: Boolean(providers.gemini.enc), activeModels: providers.gemini.activeModels, lastVerifiedAt: providers.gemini.lastVerifiedAt ?? null },
      openrouter: { hasKey: Boolean(providers.openrouter.enc), activeModels: providers.openrouter.activeModels, lastVerifiedAt: providers.openrouter.lastVerifiedAt ?? null },
    }

    return NextResponse.json(safe)
  } catch (error) {
    console.error({ event: "provider_request_failed" })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

async function handlePUT(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await readBoundedJson(req, 1024 * 1024)
    type Incoming = { apiKey?: string | null; activeModels?: string[] }
    const incoming: Partial<Record<ProviderKey, Incoming>> = {}
    const single = body.provider !== undefined || body.apiKey !== undefined || body.activeModels !== undefined
    if (single && !["openai", "gemini", "openrouter"].includes(String(body.provider))) throw new ApiError("Invalid provider")
    for (const provider of ["openai", "gemini", "openrouter"] as const) {
      const value = single ? body.provider === provider ? { apiKey: body.apiKey, activeModels: body.activeModels } : undefined : body[provider]
      if (value === undefined) continue
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("Invalid provider settings")
      const data = value as Record<string, unknown>
      if (data.apiKey !== undefined && data.apiKey !== null && (typeof data.apiKey !== "string" || data.apiKey.length > 16384)) throw new ApiError("Invalid provider key")
      if (data.activeModels !== undefined && (!Array.isArray(data.activeModels) || data.activeModels.length > 1000 || data.activeModels.some(model => typeof model !== "string" || !model.trim() || model.length > 256))) throw new ApiError("Invalid model selection")
      incoming[provider] = data as Incoming
    }

    const userId = session.user.id
    return await prisma.$transaction(async transaction => {
    const current = await transaction.userSettings.findUnique({ where: { userId } })
    const providers: SettingsShape = { ...emptySettings(), ...((current?.providers as SettingsShape | undefined) || {}) }

    async function updateProvider(p: ProviderKey, data: { apiKey?: string | null; activeModels?: string[] } | undefined) {
      if (!data) return
      if (data.apiKey !== undefined) {
        if (data.apiKey === null || data.apiKey === "") {
          providers[p].enc = undefined
        } else {
          providers[p].enc = await encryptString(data.apiKey)
        }
      }
      if (data.activeModels) providers[p].activeModels = data.activeModels
      providers[p].lastVerifiedAt = providers[p].lastVerifiedAt || null
    }

    await updateProvider("openai", incoming.openai)
    await updateProvider("gemini", incoming.gemini)
    await updateProvider("openrouter", incoming.openrouter)

    const persistedProviders = JSON.parse(JSON.stringify(providers)) as Prisma.InputJsonValue
    await transaction.userSettings.upsert({
      where: { userId },
      update: { providers: persistedProviders },
      create: { userId, providers: persistedProviders },
    })

    return NextResponse.json({ ok: true })
    })
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error({ event: "provider_request_failed" })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}



async function boundaryPUT(req: NextRequest) {
  return authenticatedWorkload("write", () => handlePUT(req))
}

export function PUT(req: NextRequest) {
  return withApiBoundary(req, () => boundaryPUT(req))
}
