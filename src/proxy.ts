import { NextResponse, type NextRequest } from "next/server"
import { posix } from "node:path"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

function privatePath(pathname: string) {
  const path = posix.normalize(decodeURIComponent(pathname))
  return path === "/uploads" || path.startsWith("/uploads/") || path === "/canvases" || path.startsWith("/canvases/")
}

export async function proxy(request: NextRequest) {
  try {
    const { pathname } = request.nextUrl
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return NextResponse.next()
    }
    if (pathname === "/_next/image") {
      const source = request.nextUrl.searchParams.get("url")
      if (source && privatePath(new URL(source, request.url).pathname)) return new NextResponse(null, { status: 404 })
      return NextResponse.next()
    }
    const session = await auth()
    if (pathname === "/login" || pathname === "/register") {
      return session?.user?.id ? NextResponse.redirect(new URL("/dashboard", request.url)) : NextResponse.next()
    }
    if (privatePath(pathname)) {
      if (!session?.user?.id) return new NextResponse(null, { status: 401, headers: { "Cache-Control": "no-store" } })
      const path = posix.normalize(decodeURIComponent(pathname))
      if (path.startsWith("/uploads/avatars/")) {
        const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { image: true } })
        if (user?.image !== path) return new NextResponse(null, { status: 404 })
        const response = NextResponse.next()
        response.headers.set("Cache-Control", "private, no-store")
        return response
      }
      return NextResponse.rewrite(new URL(`/api/media/serve${path}`, request.url))
    }
    if (!session?.user?.id) {
      const count = await prisma.user.count()
      return NextResponse.redirect(new URL(count === 0 ? "/register" : "/login", request.url))
    }
    return NextResponse.next()
  } catch {
    return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}

export const config = {
  matcher: ["/((?!api(?:/|$)|_next/static/|favicon.ico).*)"],
}
