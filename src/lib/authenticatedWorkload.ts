import { auth } from "@/lib/auth"
import { ApiError } from "./apiErrors"
import { withWorkload } from "./workloadBudget"

export async function authenticatedWorkload(lane: Parameters<typeof withWorkload>[1], operation: () => Promise<Response>): Promise<Response> {
  try {
    const session = await auth()
    if (!session?.user?.id) throw new ApiError("Unauthorized", 401)
    return await withWorkload(session.user.id, lane, operation)
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500
    return Response.json({ error: error instanceof ApiError ? error.message : "Operation failed" }, { status, headers: status === 429 ? { "Retry-After": "1" } : undefined })
  }
}
