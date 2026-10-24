import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { searchableCanvasNodes } from "@/lib/searchPayload"

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const url = new URL(request.url)
    const cursor = url.searchParams.get("cursor")
    const limit = Number(url.searchParams.get("limit") ?? 10)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || (cursor && !/^[a-zA-Z0-9_-]{1,200}$/.test(cursor))) return NextResponse.json({ error: "Invalid search page" }, { status: 400 })
    const canvases = await prisma.canvas.findMany({
      where: {
        userId: session.user.id,
        ...(cursor ? { id: { gt: cursor } } : {})
      },
      select: { id: true, title: true, description: true, createdAt: true, updatedAt: true, isPinned: true },
      orderBy: { id: "asc" }, take: limit + 1
    })

    // Transform the data to include both Canvas.content JSON and Node table data
    const enrichedCanvases = []
    for (const canvas of canvases.slice(0, limit)) enrichedCanvases.push({ ...canvas, ...await searchableCanvasNodes(canvas.id, session.user.id) })
    return NextResponse.json(enrichedCanvases, { headers: { "Cache-Control": "no-store", ...(canvases.length > limit ? { "X-Next-Cursor": canvases[limit - 1].id } : {}) } })
  } catch (error) {
    console.error("Error fetching search data:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
