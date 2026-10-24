import { redirect } from 'next/navigation'
import { getCurrentUserCount } from '@/lib/inviteUtils'
import { Prisma } from '@prisma/client'

// Tell Next.js that this page should render dynamically
// and should not be pre-rendered during build
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Determines if error is a database connection error or timeout
 */
function isDatabaseConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  // Check Node.js error codes for connections
  if ('code' in error) {
    const code = error.code as string
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
      return true
    }
  }

  // Check Prisma error codes for connections
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const prismaConnectionErrorCodes = [
      'P1001', // Can't reach database server
      'P1002', // Connection timeout
      'P1003', // Database does not exist (can also be for connection)
      'P1008', // Operations timed out
      'P1017', // Server has closed the connection
    ]
    if (prismaConnectionErrorCodes.includes(error.code)) {
      return true
    }
  }

  // Check error messages for connections
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (
      message.includes('connection') ||
      message.includes('timeout') ||
      message.includes('connect econnrefused') ||
      message.includes('network') ||
      message.includes('unable to connect')
    ) {
      return true
    }
  }

  return false
}

/**
 * Determines if error is a missing table/schema error
 */
function isSchemaInitializationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  // Check Prisma error codes for missing tables
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2021 = Table does not exist
    if (error.code === 'P2021') {
      return true
    }
  }

  // Check error messages for missing tables
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (
      message.includes('no such table') ||
      (message.includes('relation') && message.includes('does not exist')) ||
      (message.includes('table') && message.includes('not found')) ||
      (message.includes('sqlite') && message.includes('no such table'))
    ) {
      return true
    }
  }

  // Check Prisma error metadata
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.meta) {
    const meta = error.meta as Record<string, unknown>
    if (meta.table || meta.target) {
      // If there's table information in metadata, this might be a schema error
      const message = String(meta.message || '').toLowerCase()
      if (message.includes('does not exist') || message.includes('not found')) {
        return true
      }
    }
  }

  return false
}

/**
 * Creates error for throwing with 503 status information
 */
class DatabaseUnavailableError extends Error {
  constructor(message: string, public readonly originalError: unknown) {
    super(message)
    this.name = 'DatabaseUnavailableError'
  }
}

export default async function Home() {
  // Check if this is first installation
  let userCount: number | null = null
  let isFirstInstallation = false
  
  try {
    userCount = await getCurrentUserCount()
    // If there are no users, this is first installation
    if (userCount === 0) {
      isFirstInstallation = true
    }
  } catch (error) {
    // Log error details for debugging (safe - only on server)
    // Don't log full error object to avoid leaking sensitive data
    const errorInfo = {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCode: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
      prismaCode: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined,
    }
    console.error('Error checking user count:', errorInfo)

    // Check if this is a database connection error
    if (isDatabaseConnectionError(error)) {
      console.error('Database connection error detected - service unavailable:', errorInfo)
      // Throw error so middleware/error handler can return 503
      // In Next.js App Router, errors from server components are handled by error boundary
      // To set HTTP status 503, can use special mechanism
      // or handle error in error.tsx
      throw new DatabaseUnavailableError(
        'Database service is temporarily unavailable',
        error
      )
    }

    // Check if this is a schema initialization error (missing tables)
    if (isSchemaInitializationError(error)) {
      console.info('Schema initialization error detected - treating as first installation:', errorInfo)
      isFirstInstallation = true
    } else {
      // For all other unexpected errors, throw further
      console.error('Unexpected error during user count check:', errorInfo)
      throw error
    }
  }
  
  // redirect() should be outside try-catch so Next.js can handle the exception
  // If this is first installation, redirect to registration
  if (isFirstInstallation) {
    redirect('/register')
  }
  
  redirect('/dashboard')
}
