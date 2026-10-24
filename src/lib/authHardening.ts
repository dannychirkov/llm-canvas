import { createHmac, randomBytes } from "node:crypto"

export class AuthRequestError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message)
  }
}

export function createAuthLimiter(maxEntries = 2048, now = Date.now) {
  const buckets = new Map<string, { count: number; expires: number }>()
  const salt = randomBytes(32)
  return (scope: string, identity: string, limit: number, windowMs: number) => {
    const timestamp = now()
    const key = createHmac("sha256", salt).update(scope).update("\0").update(identity).digest("hex")
    let bucket = buckets.get(key)
    if (bucket && bucket.expires <= timestamp) {
      buckets.delete(key)
      bucket = undefined
    }
    if (!bucket) {
      if (buckets.size >= maxEntries) {
        for (const [entry, value] of buckets) {
          if (value.expires <= timestamp) buckets.delete(entry)
        }
      }
      if (buckets.size >= maxEntries) throw new AuthRequestError("Too many requests. Try again later.", 429)
      bucket = { count: 0, expires: timestamp + windowMs }
      buckets.set(key, bucket)
    }
    if (bucket.count >= limit) throw new AuthRequestError("Too many requests. Try again later.", 429)
    bucket.count += 1
  }
}

const authState = globalThis as typeof globalThis & {
  authBudget?: { limit: ReturnType<typeof createAuthLimiter>; active: number }
}
const budget = authState.authBudget ??= { limit: createAuthLimiter(), active: 0 }

export function enforceAuthRate(action: "login" | "login-request" | "register" | "password" | "profile", identity?: string) {
  if (identity === undefined) {
    budget.limit(action, "global", action === "register" ? 12 : 60, 60_000)
  } else {
    budget.limit(action, identity.trim().toLowerCase(), action === "register" ? 5 : 10, 15 * 60_000)
  }
}

export function validPasswordInput(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 72
}

export async function withPasswordWork<Result>(work: () => Promise<Result>): Promise<Result> {
  budget.limit("password-work", "global", 60, 60_000)
  if (budget.active >= 2) throw new AuthRequestError("Authentication is busy. Try again later.", 429)
  budget.active += 1
  try {
    return await work()
  } finally {
    budget.active -= 1
  }
}

export async function readAuthBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length")) > 8192) throw new AuthRequestError("Request body is too large", 413)
  if (!request.body) throw new AuthRequestError("Request body is required")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new AuthRequestError("Request body timed out", 408))
      void reader.cancel().catch(() => {})
    }, 3000)
  })
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout])
      if (done) break
      size += value.byteLength
      if (size > 8192) {
        void reader.cancel().catch(() => {})
        throw new AuthRequestError("Request body is too large", 413)
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString("utf8")
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}

export async function readAuthJson(request: Request): Promise<Record<string, unknown>> {
  const body = await readAuthBody(request)
  try {
    const value: unknown = JSON.parse(body)
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch {
    throw new AuthRequestError("Invalid request body")
  }
}
