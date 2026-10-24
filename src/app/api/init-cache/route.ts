import { withApiBoundary } from "@/lib/apiBoundary"
import { authenticatedWorkload } from "@/lib/authenticatedWorkload"
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { invalidateUserCache } from '@/lib/cacheUtils'

async function handlePOST() {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Invalidate cache for all user canvases
    await invalidateUserCache(session.user.id)

    return NextResponse.json({
      success: true,
      message: 'Cache initialized for all user canvases'
    })
  } catch (error) {
    console.error('Error initializing cache:', error)
    return NextResponse.json(
      {
        success: false,
        message: 'Error initializing cache',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

async function boundaryPOST() {
  return authenticatedWorkload("metadata", () => handlePOST())
}

export function POST(request: Request) {
  return withApiBoundary(request, () => boundaryPOST())
}
