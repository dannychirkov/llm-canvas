/**
 * Custom error class for registration with explicit HTTP status code
 */
export class RegistrationError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message)
    this.name = 'RegistrationError'
    // Preserve correct stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RegistrationError)
    }
  }
}

