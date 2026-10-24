import { withApiBoundary } from "@/lib/apiBoundary"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

async function boundaryPATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: canvasId } = await params

    // Verify the canvas belongs to the user
    const canvas = await prisma.canvas.findFirst({
      where: {
        id: canvasId,
        userId: session.user.id
      }
    })

    if (!canvas) {
      return NextResponse.json({ error: "Canvas not found" }, { status: 404 })
    }

    // Toggle the pin status
    const updatedCanvas = await prisma.canvas.update({
      where: {
        id: canvasId
      },
      data: {
        isPinned: !canvas.isPinned
      },
      select: {
        id: true,
        title: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        isPublic: true,
        isPinned: true,
        nodeCount: true,
        largestContextTokens: true
      }
    })

    return NextResponse.json(updatedCanvas)
  } catch (error) {
    console.error("Error toggling canvas pin:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withApiBoundary(request, () => boundaryPATCH(request, { params }))
}
