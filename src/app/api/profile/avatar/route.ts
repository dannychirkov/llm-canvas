import { withApiBoundary } from "@/lib/apiBoundary"
import { authenticatedWorkload } from "@/lib/authenticatedWorkload"
import { ApiError } from "@/lib/apiErrors"
import { readBoundedFormData } from "@/lib/boundedFormData"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import fs from "fs"
const { writeFile, mkdir, unlink } = fs.promises
import { join, relative } from "path"
import { validateFileType } from "@/lib/fileValidation"

export const dynamic = 'force-dynamic'

const PUBLIC_DIR = join(process.cwd(), "public")
const AVATARS_DIR = join(PUBLIC_DIR, "uploads", "avatars")
const MAX_AVATAR_SIZE = 5 * 1024 * 1024 // 5MB

function toPublicPath(fullPath: string) {
  const rel = relative(PUBLIC_DIR, fullPath).replace(/\\/g, "/")
  return `/${rel}`
}

async function handlePOST(request: NextRequest) {
  let savedFilePath: string | null = null

  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const formData = await readBoundedFormData(request, MAX_AVATAR_SIZE + 64 * 1024)
    const file = formData.get('avatar')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: "File must be an image" }, { status: 400 })
    }

    // Validate file size
    if (file.size > MAX_AVATAR_SIZE) {
      return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 })
    }

    // Read file buffer for validation
    const buffer = await file.arrayBuffer()
    const fileBuffer = Buffer.from(buffer)

    // Validate real file type
    const validationResult = await validateFileType(fileBuffer, file.type, file.name)

    if (!validationResult.isValid) {
      return NextResponse.json({
        error: validationResult.error || "Invalid file type"
      }, { status: 400 })
    }

    // Ensure avatars directory exists
    await mkdir(AVATARS_DIR, { recursive: true })

    // Map MIME types to file extensions
    const mimeToExt: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp'
    }

    // Get extension from validated MIME type
    const detectedMime = validationResult.detectedMimeType
    let ext: string

    if (!detectedMime) {
      // Fallback to safe default if detection failed (shouldn't happen after validation)
      console.warn("MIME type detection failed, using default extension")
      ext = 'jpg'
    } else if (mimeToExt[detectedMime]) {
      ext = mimeToExt[detectedMime]
    } else {
      // Log and reject unsupported MIME types
      console.error(`Unsupported MIME type detected: ${detectedMime}`)
      return NextResponse.json({
        error: `Unsupported file format: ${detectedMime}`
      }, { status: 400 })
    }

    // Delete old avatar if exists
    const oldAvatarPath = join(AVATARS_DIR, `${session.user.id}.jpg`)
    const oldAvatarPathJpeg = join(AVATARS_DIR, `${session.user.id}.jpeg`)
    const oldAvatarPathPng = join(AVATARS_DIR, `${session.user.id}.png`)
    const oldAvatarPathGif = join(AVATARS_DIR, `${session.user.id}.gif`)
    const oldAvatarPathWebp = join(AVATARS_DIR, `${session.user.id}.webp`)

    for (const oldPath of [oldAvatarPath, oldAvatarPathJpeg, oldAvatarPathPng, oldAvatarPathGif, oldAvatarPathWebp]) {
      await unlink(oldPath).catch(() => {})
    }

    // Save new avatar
    const fileName = `${session.user.id}.${ext}`
    savedFilePath = join(AVATARS_DIR, fileName)
    await writeFile(savedFilePath, fileBuffer)

    // Update user in database
    const publicPath = toPublicPath(savedFilePath)
    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: { image: publicPath }
    })

    return NextResponse.json({
      success: true,
      image: publicPath
    })

  } catch (error) {
    // Clean up on error
    if (savedFilePath) {
      try {
        await unlink(savedFilePath)
      } catch (err) {
        console.error("Failed to clean up file:", err)
      }
    }

    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error({ event: "avatar_upload_failed" })
    // Return generic error message to client (don't expose internal details)
    return NextResponse.json({
      error: "Internal server error"
    }, { status: 500 })
  }
}

async function boundaryDELETE(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Delete avatar file
    const avatarPath = join(AVATARS_DIR, `${session.user.id}.jpg`)
    const avatarPathJpeg = join(AVATARS_DIR, `${session.user.id}.jpeg`)
    const avatarPathPng = join(AVATARS_DIR, `${session.user.id}.png`)
    const avatarPathGif = join(AVATARS_DIR, `${session.user.id}.gif`)
    const avatarPathWebp = join(AVATARS_DIR, `${session.user.id}.webp`)

    for (const path of [avatarPath, avatarPathJpeg, avatarPathPng, avatarPathGif, avatarPathWebp]) {
      await unlink(path).catch(() => {})
    }

    // Update user in database
    await prisma.user.update({
      where: { id: session.user.id },
      data: { image: null }
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    // Log full error for server-side diagnostics
    console.error("Error deleting avatar:", error)
    // Return generic error message to client (don't expose internal details)
    return NextResponse.json({
      error: "Internal server error"
    }, { status: 500 })
  }
}


async function boundaryPOST(request: NextRequest) {
  return authenticatedWorkload("transfer", () => handlePOST(request))
}

export function DELETE(request: NextRequest) {
  return withApiBoundary(request, () => boundaryDELETE(request))
}

export function POST(request: NextRequest) {
  return withApiBoundary(request, () => boundaryPOST(request))
}
