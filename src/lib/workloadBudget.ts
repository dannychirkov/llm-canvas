import { ApiError } from "./apiErrors"

type Lane = "execution" | "transfer" | "write" | "metadata"
const limits = { execution: { global: 6, user: 3 }, transfer: { global: 1, user: 1 }, write: { global: 2, user: 1 }, metadata: { global: 4, user: 2 } } as const

/** Process-wide admission for the supported single-instance deployment. No wait queue. */
interface WorkloadState {
  total: number
  totals: Map<string, number>
  active: Map<Lane, number>
  users: Map<string, number>
}
const newState = (): WorkloadState => ({ total: 0, totals: new Map(), active: new Map(), users: new Map() })
export function createWorkloadBudget(state = newState()) {
  const { totals, active, users } = state
  return (userId: string, lane: Lane): (() => void) => {
    const key = lane + ":" + userId
    if (state.total >= 8 || (totals.get(userId) ?? 0) >= 4 || (active.get(lane) ?? 0) >= limits[lane].global || (users.get(key) ?? 0) >= limits[lane].user) throw new ApiError("The server is busy. Retry this operation shortly.", 429)
    state.total++
    totals.set(userId, (totals.get(userId) ?? 0) + 1)
    active.set(lane, (active.get(lane) ?? 0) + 1)
    users.set(key, (users.get(key) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      state.total--
      const userTotal = totals.get(userId)! - 1
      if (userTotal) totals.set(userId, userTotal)
      else totals.delete(userId)
      active.set(lane, active.get(lane)! - 1)
      const count = users.get(key)! - 1
      if (count) users.set(key, count)
      else users.delete(key)
    }
  }
}
const scope = globalThis as typeof globalThis & { canvasWorkloadState?: WorkloadState }
export const acquireWorkload = createWorkloadBudget(scope.canvasWorkloadState ??= newState())

export async function withWorkload(userId: string, lane: Lane, operation: () => Promise<Response>): Promise<Response> {
  const release = acquireWorkload(userId, lane)
  let streaming = false
  try {
    const response = await operation()
    if (!response.body || !/^(?:text\/event-stream|application\/zip)(?:;|$)/.test(response.headers.get("content-type") ?? "")) return response
    const reader = response.body.getReader()
    let cancelling = false
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read()
          if (cancelling) return
          if (next.done) { controller.close(); reader.releaseLock(); release() }
          else controller.enqueue(next.value)
        } catch (error) {
          if (cancelling) return
          controller.error(error)
          try { await reader.cancel() } finally { reader.releaseLock(); release() }
        }
      },
      async cancel(reason) {
        cancelling = true
        try { await reader.cancel(reason) } finally { reader.releaseLock(); release() }
      }
    })
    const wrapped = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    streaming = true
    return wrapped
  } finally { if (!streaming) release() }
}
