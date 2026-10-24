export class ApiError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

export function publicError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "Provider request timed out or was cancelled"
  }
  return "Provider request failed"
}

export function errorStatus(error: unknown): number {
  return error instanceof ApiError ? error.status : 502
}

export function providerError(status: number): string {
  if (status === 401 || status === 403) return "Provider rejected the credentials"
  if (status === 429) return "Provider rate limit exceeded"
  if (status === 404) return "Provider model or endpoint was not found"
  return "Provider request failed"
}
