import { prisma } from "@/lib/prisma"
import { ApiError } from "@/lib/apiErrors"

export function allowedProviderOrigin(baseUrl: string, configured = process.env.LLM_ALLOWED_PROVIDER_ORIGINS ?? ""): boolean {
  const origin = new URL(baseUrl).origin
  return configured.split(",").map(value => value.trim()).filter(Boolean).some(value => {
    try {
      const url = new URL(value)
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash && url.origin === origin
    } catch { return false }
  })
}

export async function requireProviderEgress(userId: string, baseUrl: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isOwner: true } })
  if (!user) throw new ApiError("Unauthorized", 401)
  if (!user.isOwner && !allowedProviderOrigin(baseUrl)) throw new ApiError("This endpoint origin is not allowed by the installation owner", 403)
}
