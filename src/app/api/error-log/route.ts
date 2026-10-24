import { withApiBoundary } from "@/lib/apiBoundary"
import { NextRequest, NextResponse } from 'next/server'
import { AuthRequestError, readAuthJson } from '@/lib/authHardening'

/**
 * Interface for error data sent from the client
 */
interface ErrorLogPayload {
  name?: string
  message?: string
  stack?: string
  digest?: string
  isDatabaseError?: boolean
  timestamp?: string
  userAgent?: string
  url?: string
}

/**
 * API security configuration
 */
const SECURITY_CONFIG = {
  // Matches readAuthJson's actual streamed byte budget, not just Content-Length.
  MAX_PAYLOAD_SIZE: 8 * 1024,
  // Rate limiting: maximum requests per time window
  RATE_LIMIT_MAX_REQUESTS: 10,
  RATE_LIMIT_WINDOW_MS: 60 * 1000, // 1 minute
  // Optional API key for trusted clients
  API_KEY_HEADER: 'X-API-Key',
  API_SECRET: process.env.ERROR_LOG_API_SECRET,
} as const

/**
 * Simple in-memory rate limiter with sliding window
 * In production, Redis should be used for distributed systems
 */
class RateLimiter {
  private requests: Map<string, number[]> = new Map()
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor(
    private maxRequests: number,
    private windowMs: number
  ) {
    // Clean up old entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 5 * 60 * 1000)
  }

  /**
   * Checks if a request is allowed for the given key
   * @returns true if request is allowed, false if limit exceeded
   */
  check(key: string): boolean {
    const now = Date.now()
    const requests = this.requests.get(key) || []

    // Remove requests older than the time window
    const validRequests = requests.filter(timestamp => now - timestamp < this.windowMs)

    // Check limit
    if (validRequests.length >= this.maxRequests) {
      return false
    }

    // Add current request
    validRequests.push(now)
    this.requests.set(key, validRequests)

    return true
  }

  /**
   * Cleans up old entries
   */
  private cleanup(): void {
    const now = Date.now()
    for (const [key, requests] of this.requests.entries()) {
      const validRequests = requests.filter(timestamp => now - timestamp < this.windowMs)
      if (validRequests.length === 0) {
        this.requests.delete(key)
      } else {
        this.requests.set(key, validRequests)
      }
    }
  }

  /**
   * Stops cleanup (for testing)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }
}

// Global rate limiter instance
const rateLimiter = new RateLimiter(
  SECURITY_CONFIG.RATE_LIMIT_MAX_REQUESTS,
  SECURITY_CONFIG.RATE_LIMIT_WINDOW_MS
)

/**
 * Validates the request origin/referer
 * @returns true if origin is allowed, false otherwise
 */
function validateOrigin(req: NextRequest): boolean {
  const appUrl = process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL

  // If NEXT_PUBLIC_APP_URL is not configured
  if (!appUrl) {
    // In production, strict check requires it to be set
    if (process.env.NODE_ENV === 'production') {
      return false
    }
    // In development, allow all
    return true
  }

  const allowedOrigins = [appUrl]

  const origin = req.headers.get('origin')
  const referer = req.headers.get('referer')

  // Check origin
  if (origin) {
    try {
      const originUrl = new URL(origin)
      const originHost = originUrl.origin
      if (allowedOrigins.some(allowed => {
        try {
          const allowedUrl = new URL(allowed)
          return allowedUrl.origin === originHost
        } catch {
          return allowed === originHost || allowed === origin
        }
      })) {
        return true
      }
    } catch {
      // Invalid origin URL
    }
  }

  // Check referer
  if (referer) {
    try {
      const refererUrl = new URL(referer)
      const refererOrigin = refererUrl.origin
      if (allowedOrigins.some(allowed => {
        try {
          const allowedUrl = new URL(allowed)
          return allowedUrl.origin === refererOrigin
        } catch {
          return allowed === refererOrigin || allowed === referer
        }
      })) {
        return true
      }
    } catch {
      // Invalid referer URL
    }
  }

  return false
}

/**
 * Checks payload size before parsing
 * @returns size in bytes or null if header is missing/invalid
 */
function getPayloadSize(req: NextRequest): number | null {
  const contentLength = req.headers.get('content-length')
  if (!contentLength) {
    return null
  }

  const size = parseInt(contentLength, 10)
  if (isNaN(size) || size < 0) {
    return null
  }

  return size
}

/**
 * Validates API key if configured
 * @returns true if key is valid or not required, false if required but invalid
 */
function validateApiKey(req: NextRequest): boolean {
  // If API key is not configured, skip validation
  if (!SECURITY_CONFIG.API_SECRET) {
    return true
  }

  // Check X-API-Key header
  const apiKey = req.headers.get(SECURITY_CONFIG.API_KEY_HEADER)
  if (apiKey && apiKey === SECURITY_CONFIG.API_SECRET) {
    return true
  }

  // Check Authorization header (Bearer token)
  const authHeader = req.headers.get('authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    if (token === SECURITY_CONFIG.API_SECRET) {
      return true
    }
  }

  return false
}

/**
 * Validates and normalizes error payload
 */
function safeLogUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch { return "[invalid URL]" }
}

function safeLogText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return
  return value.slice(0, limit)
    .replace(/https?:\/\/[^\s)]+/gi, safeLogUrl)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,})/g, "[redacted]")
    .replace(/((?:["']?)(?:api[_-]?key|access[_-]?token|authorization|password|secret)(?:["']?)\s*[:=]\s*)(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^\s,;&]+)/gi, "$1[redacted]")
    .slice(0, limit)
}

function validateErrorPayload(data: unknown): ErrorLogPayload | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const payload = data as Record<string, unknown>

  // Minimal validation: must have at least name or message
  if ((typeof payload.name !== "string" || !payload.name) && (typeof payload.message !== "string" || !payload.message)) {
    return null
  }

  return {
    name: safeLogText(payload.name, 128),
    message: safeLogText(payload.message, 1024),
    stack: safeLogText(payload.stack, 2048),
    digest: safeLogText(payload.digest, 128),
    isDatabaseError: typeof payload.isDatabaseError === 'boolean' ? payload.isDatabaseError : false,
    timestamp: new Date().toISOString(),
    userAgent: safeLogText(payload.userAgent, 256),
    url: typeof payload.url === 'string' ? safeLogText(safeLogUrl(payload.url), 256) : undefined,
  }
}

/**
 * Logs error to the selected logger
 * Does not throw exceptions to avoid disrupting request processing
 */
async function logError(payload: ErrorLogPayload): Promise<void> {
  try {
    // Log to console with structured data
    // In production this can be redirected to external services (Sentry, PostHog, CloudWatch, etc.)
    console.error('[Client Error]', {
      name: payload.name || 'Unknown',
      message: payload.message || 'No message',
      stack: payload.stack,
      digest: payload.digest,
      isDatabaseError: payload.isDatabaseError,
      timestamp: payload.timestamp,
      userAgent: payload.userAgent,
      url: payload.url,
      environment: process.env.NODE_ENV,
    })

    // TODO: Integration with external monitoring services
    // Example for Sentry:
    // if (process.env.SENTRY_DSN) {
    //   Sentry.captureException(new Error(payload.message), {
    //     tags: { source: 'client-error', isDatabaseError: payload.isDatabaseError },
    //     extra: payload,
    //   })
    // }

    // Example for PostHog Node.js SDK:
    // if (process.env.POSTHOG_API_KEY) {
    //   posthog.capture({
    //     distinctId: 'anonymous',
    //     event: 'client_error',
    //     properties: payload,
    //   })
    // }
  } catch (logError) {
    // Ignore logging errors to avoid creating error loops
    // In development we can log a warning
    if (process.env.NODE_ENV === 'development') {
      console.warn('[Error Logger] Failed to log error:', logError)
    }
  }
}

/**
 * POST /api/error-log
 * 
 * Accepts errors from the client and logs them on the server.
 * 
 * Requirements:
 * - Idempotent (repeated requests with the same data are safe)
 * - Does not throw exceptions on logging errors
 * - Responds quickly to avoid blocking the client
 * - Validates and handles invalid JSON gracefully
 * 
 * Security:
 * - Origin/referer check to prevent CSRF
 * - Payload size limitation
 * - Global rate limiting, independent of untrusted forwarded headers
 * - Optional API key validation
 */
async function boundaryPOST(req: NextRequest) {
  if (process.env.ENABLE_CLIENT_ERROR_LOGS !== "true") return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } })
  try {
    // ========== SECURITY 1: Origin/referer check ==========
    if (!validateOrigin(req)) {
      return NextResponse.json(
        { error: 'Forbidden: origin not allowed' },
        { status: 403 }
      )
    }

    // ========== SECURITY 2: Payload size check ==========
    const payloadSize = getPayloadSize(req)
    if (payloadSize !== null && payloadSize > SECURITY_CONFIG.MAX_PAYLOAD_SIZE) {
      return NextResponse.json(
        { error: 'Payload too large' },
        { status: 413 }
      )
    }

    // ========== SECURITY 3: Rate limiting ==========
    if (!rateLimiter.check("global")) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { "Retry-After": "60" } }
      )
    }

    // ========== SECURITY 4: API key check (optional) ==========
    if (!validateApiKey(req)) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid API key' },
        { status: 401 }
      )
    }

    // ========== All checks passed, parse JSON ==========
    // Attempt to read request body
    let body: unknown
    try {
      body = await readAuthJson(req)
    } catch (parseError) {
      if (parseError instanceof AuthRequestError) return NextResponse.json({ error: parseError.message }, { status: parseError.statusCode })
      // If JSON is invalid or missing, return 400
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      )
    }

    // Validate payload
    const errorPayload = validateErrorPayload(body)
    if (!errorPayload) {
      return NextResponse.json(
        { error: 'Invalid error payload: missing required fields' },
        { status: 400 }
      )
    }

    // Log error asynchronously (don't wait for completion)
    // This ensures a fast response to the client
    logError(errorPayload).catch(() => {
      // Ignore logging errors
    })

    // Return success response immediately
    // Client should not wait for logging to complete
    return NextResponse.json(
      { success: true },
      { status: 200 }
    )
  } catch (error) {
    // Handle any unexpected errors
    // Log but don't expose details to the client
    if (process.env.NODE_ENV === 'development') {
      console.error('[Error Log API] Unexpected error:', error)
    }

    // Return generic error response
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Explicitly reject other HTTP methods
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 }
  )
}

async function boundaryPUT() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 }
  )
}

async function boundaryDELETE() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 }
  )
}


export function POST(req: NextRequest) {
  return withApiBoundary(req, () => boundaryPOST(req))
}

export function PUT(request: Request) {
  return withApiBoundary(request, () => boundaryPUT())
}

export function DELETE(request: Request) {
  return withApiBoundary(request, () => boundaryDELETE())
}
