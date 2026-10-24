'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Build-time constant for environment check
const IS_DEV = process.env.NODE_ENV === 'development'

interface ErrorProps {
  error: Error & { digest?: string; originalError?: unknown }
  reset: () => void
}

/**
 * Checks if error is a database unavailable error
 */
function isDatabaseUnavailableError(error: Error): boolean {
  return (
    error.name === 'DatabaseUnavailableError' ||
    error.message.includes('Database service is temporarily unavailable') ||
    error.message.includes('temporarily unavailable')
  )
}

/**
 * Sends error to server logger for monitoring
 * Does not block rendering, executes asynchronously
 */
async function logErrorToServer(error: Error, isDatabaseError: boolean): Promise<void> {
  try {
    // Create safe error object for sending (without sensitive data)
    const errorData = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      digest: 'digest' in error ? error.digest : undefined,
      isDatabaseError,
      timestamp: new Date().toISOString(),
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : undefined,
      url: typeof window !== 'undefined' 
        ? `${window.location.origin}${window.location.pathname}` 
        : undefined,
    }

    // In development log to console with full details
    if (IS_DEV) {
      console.error('Error boundary caught error (full details):', {
        ...errorData,
        originalError: 'originalError' in error ? error.originalError : undefined,
      })
    }

    // In production send to server endpoint for logging
    // Can integrate with Sentry, PostHog, or other monitoring service
    if (!IS_DEV) {
      // Send to server API endpoint for logging
      // If endpoint doesn't exist, error will be ignored
      fetch('/api/error-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(errorData),
      }).catch(() => {
        // Ignore log sending errors to avoid error loops
      })

      // Also log to console for server logs (if available)
      console.error('Error boundary caught error:', {
        errorName: error.name,
        isDatabaseError,
        digest: errorData.digest,
      })
    }
  } catch (logError) {
    // Ignore logging errors to avoid error loops
    if (IS_DEV) {
      console.warn('Failed to log error to server:', logError)
    }
  }
}

function AppError({ error, reset }: ErrorProps) {
  const router = useRouter()
  const isDatabaseError = isDatabaseUnavailableError(error)

  useEffect(() => {
    // Send full error to server logger before rendering
    logErrorToServer(error, isDatabaseError)
  }, [error, isDatabaseError])

  // For DB errors show special message
  if (isDatabaseError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <div className="max-w-md w-full space-y-4 text-center">
          <h1 className="text-2xl font-bold text-red-600">Service Unavailable</h1>
          <p className="text-gray-600">
            The database service is temporarily unavailable. Please try again later.
          </p>
          <div className="mt-4 space-x-4">
            <button
              onClick={reset}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Try Again
            </button>
            <button
              onClick={() => router.refresh()}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              Refresh Page
            </button>
          </div>
        </div>
      </div>
    )
  }

  // For other errors show generic message
  // NEVER show error.message, error.stack or other details to user
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="max-w-md w-full space-y-4 text-center">
        <h1 className="text-2xl font-bold text-red-600">Something went wrong</h1>
        <p className="text-gray-600">
          An unexpected error occurred. Please try again later.
        </p>
        <div className="mt-4 space-x-4">
          <button
            onClick={reset}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Try Again
          </button>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Go Home
          </button>
        </div>
      </div>
    </div>
  )
}

export default AppError

