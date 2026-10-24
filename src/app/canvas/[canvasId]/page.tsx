import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import CanvasPageWrapper from "@/components/CanvasPageWrapper"
import { trackCanvasOpened } from "@/lib/analytics"
import { compactCanvasDocument } from "@/lib/debugPayload"

interface CanvasPageProps {
  params: Promise<{
    canvasId: string
  }>
}

export default async function CanvasPage({ params }: CanvasPageProps) {
  const session = await auth()
  
  if (!session?.user?.id) {
    notFound()
  }

  const { canvasId } = await params
  const canvas = await prisma.canvas.findFirst({
    where: {
      id: canvasId,
      userId: session.user.id
    }
  })

  if (!canvas) {
    notFound()
  }

  // Track canvas opening
  trackCanvasOpened({
    canvas_id: canvas.id,
    canvas_title: canvas.title,
    canvas_type: 'default'
  })

  // Parse canvas content if it exists
  let canvasData = null
  if (canvas.content) {
    try {
      canvasData = compactCanvasDocument(JSON.parse(canvas.content))
    } catch (error) {
      console.error("Error parsing canvas content:", error)
    }
  }

  return (
    <CanvasPageWrapper 
      canvasId={canvas.id}
      canvasTitle={canvas.title}
      initialUpdatedAt={canvas.updatedAt.toISOString()}
      initialData={canvasData}
    />
  )
}
