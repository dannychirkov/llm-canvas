import fs from "fs"
const { readFile } = fs.promises
const { createReadStream } = fs
import { join } from "path"
import { ImageData, VideoAttachment } from "@/types"
import { prisma } from "@/lib/prisma"
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library"
import { resolvePublicPath } from "@/lib/publicPath"
import { ApiError } from "@/lib/apiErrors"

// Interface for Gemini API response when uploading file
interface GeminiUploadResponse {
  file?: { uri?: string }
  name?: string
}

const PUBLIC_DIR = join(process.cwd(), "public")
const GEMINI_FILE_TTL_MS = 1000 * 60 * 60 * 6 // 6 hours
const GEMINI_UPLOAD_TIMEOUT_MS = 1000 * 60 * 10 // 10 minutes for large file uploads
const VIDEO_READ_ERROR = "A connected video could not be loaded. Re-upload the video or remove its connection, then try again."
const VIDEO_FRAME_ERROR = "A connected video frame could not be loaded. Re-extract the video frames or remove the video connection, then try again."
const VIDEO_UPLOAD_ERROR = "A connected video could not be prepared for Gemini. Try again or re-upload the video."

// In-memory lock to prevent concurrent uploads of same file
const activeUploads = new Map<string, Promise<string>>()

// Universal function for reading file with automatic method selection
// Uses streaming for large files (>5MB) for better memory management
async function readFileBuffer(filePath: string, fileSize: number): Promise<Buffer> {
  const STREAMING_THRESHOLD = 5 * 1024 * 1024 // 5MB

  if (fileSize > STREAMING_THRESHOLD) {
    const stream = createReadStream(filePath)
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  } else {
    return await readFile(filePath)
  }
}

export async function convertVideoFramesToImages(videos: VideoAttachment[]): Promise<ImageData[]> {
  const results: ImageData[] = []

  for (const video of videos) {
    if (!Array.isArray(video.frames) || video.frames.length === 0) {
      throw new ApiError("A connected video has no extracted frames. Extract its frames before using this provider.")
    }

    for (const frame of video.frames) {
      try {
        if (!frame?.path || !frame.mimeType?.startsWith("image/")) throw new ApiError(VIDEO_FRAME_ERROR)
        const fullPath = resolvePublicPath(frame.path, video.canvasId)
        const buffer = await readFile(fullPath)
        if (buffer.length === 0) throw new ApiError(VIDEO_FRAME_ERROR)
        const base64 = buffer.toString("base64")

        results.push({
          dataUrl: `data:${frame.mimeType};base64,${base64}`,
          mimeType: frame.mimeType,
          mediaId: video.mediaId,
          timestampMs: frame.timestampMs,
          width: frame.width,
          height: frame.height,
          filePath: frame.path
        })
      } catch (error) {
        throw new ApiError(VIDEO_FRAME_ERROR)
      }
    }
  }

  return results
}

export interface GeminiVideoFileReference {
  mediaId: string
  fileUri: string
  mimeType: string
}

const GEMINI_INLINE_SIZE_LIMIT = 20 * 1024 * 1024 // 20MB in bytes

/**
 * Prepares video parts for Gemini API payload.
 * Files <20MB are passed via inlineData (base64),
 * files >=20MB are uploaded via Files API and passed via fileData.
 */
export async function prepareGeminiVideoParts(
  videos: VideoAttachment[],
  apiKey: string
): Promise<Array<
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { fileUri: string; mimeType: string } }
>> {
  const parts: Array<
    | { inlineData: { mimeType: string; data: string } }
    | { fileData: { fileUri: string; mimeType: string } }
  > = []

  // Separate videos into small and large
  const smallVideos: VideoAttachment[] = []
  const largeVideos: VideoAttachment[] = []

  for (const video of videos) {
    if (video.fileSize < GEMINI_INLINE_SIZE_LIMIT) {
      smallVideos.push(video)
    } else {
      largeVideos.push(video)
    }
  }

  // Process small files via inlineData
  for (const video of smallVideos) {
    try {
      if (!Number.isFinite(video.fileSize) || video.fileSize <= 0) throw new ApiError(VIDEO_READ_ERROR)
      const fullPath = resolvePublicPath(video.filePath, video.canvasId)
      const buffer = await readFileBuffer(fullPath, video.fileSize)
      if (buffer.length !== video.fileSize) throw new ApiError(VIDEO_READ_ERROR)
      const base64 = buffer.toString("base64")

      parts.push({
        inlineData: {
          mimeType: video.mimeType,
          data: base64
        }
      })
    } catch (error) {
      throw new ApiError(VIDEO_READ_ERROR)
    }
  }

  // Process large files via Files API
  if (largeVideos.length > 0) {
    const fileRefs = await ensureGeminiVideoFiles(largeVideos, apiKey)
    for (const ref of fileRefs) {
      parts.push({
        fileData: {
          fileUri: ref.fileUri,
          mimeType: ref.mimeType
        }
      })
    }
  }

  return parts
}

export async function ensureGeminiVideoFiles(
  videos: VideoAttachment[],
  apiKey: string
): Promise<GeminiVideoFileReference[]> {
  const uniqueVideos = new Map<string, VideoAttachment>()
  videos.forEach(video => {
    if (typeof video.mediaId !== "string" || !video.mediaId.trim()) throw new ApiError(VIDEO_READ_ERROR)
    if (!uniqueVideos.has(video.mediaId)) {
      uniqueVideos.set(video.mediaId, video)
    }
  })

  const results: GeminiVideoFileReference[] = []

  for (const video of uniqueVideos.values()) {
    try {
      const fileUri = await ensureSingleGeminiVideo(video.mediaId, apiKey)
      results.push({
        mediaId: video.mediaId,
        fileUri,
        mimeType: video.mimeType
      })
    } catch (error) {
      throw new ApiError(VIDEO_UPLOAD_ERROR, 502)
    }
  }

  return results
}

async function ensureSingleGeminiVideo(mediaId: string, apiKey: string): Promise<string> {
  // Check if upload of this file is already in progress
  const existingUpload = activeUploads.get(mediaId)
  if (existingUpload) {
    return existingUpload
  }

  // Create pending Promise synchronously with local references to resolve/reject
  // This is critical to prevent race condition: Promise must be in Map
  // BEFORE starting async work
  let resolvePromise!: (value: string) => void
  let rejectPromise!: (error: unknown) => void

  const pendingPromise = new Promise<string>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  // Immediately save Promise to Map synchronously, before upload starts
  activeUploads.set(mediaId, pendingPromise)

    // Start async upload logic in separate function
    // Use same Promise object for resolve/reject and cleanup
    ; (async () => {
      try {
        // Get media information from DB
        let media
        try {
          media = await prisma.media.findUnique({
            where: { id: mediaId }
          })
        } catch (error) {
          if (error instanceof PrismaClientKnownRequestError) {
            console.error({ event: "provider_request_failed" })
            throw new Error("Video metadata could not be loaded")
          }
          throw error
        }

        if (!media) {
          throw new Error(`Media ${mediaId} not found`)
        }

        // Check cache: both fields must exist and be valid
        if (media.geminiFileUri && media.geminiUploadedAt) {
          const cachedUri = media.geminiFileUri.trim()
          if (cachedUri.length > 0) {
            const age = Date.now() - media.geminiUploadedAt.getTime()
            if (age < GEMINI_FILE_TTL_MS && age >= 0) {
              // URI validity is checked when used via API errors
              resolvePromise(cachedUri)
              return
            }
          }
        }

        // Check file size before reading
        if (!Number.isFinite(media.fileSize) || media.fileSize <= 0) {
          throw new Error(`Invalid file size for media ${mediaId}: ${media.fileSize}`)
        }

        const fullPath = resolvePublicPath(media.filePath, media.canvasId)
        const buffer = await readFileBuffer(fullPath, media.fileSize)

        // Check that read file size matches expected
        if (buffer.length !== media.fileSize) {
          throw new Error("Video file size does not match its stored metadata")
        }

        const formData = new FormData()
        formData.append("metadata", JSON.stringify({
          file: {
            display_name: media.filename,
            mime_type: media.mimeType
          }
        }))
        // Convert Buffer to Uint8Array for Blob API compatibility
        formData.append("file", new Blob([new Uint8Array(buffer)], { type: media.mimeType }), media.filename)

        const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?upload_type=multipart&key=${apiKey}`

        // Create AbortController for timeout
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), GEMINI_UPLOAD_TIMEOUT_MS)

        let response
        try {
          response = await fetch(uploadUrl, {
            method: "POST",
            body: formData,
            signal: controller.signal
          })
        } catch (error) {
          clearTimeout(timeoutId)
          if (error instanceof Error && error.name === "AbortError") {
            throw new Error(`Gemini upload timeout after ${GEMINI_UPLOAD_TIMEOUT_MS}ms for media ${mediaId}`)
          }
          throw error
        } finally {
          clearTimeout(timeoutId)
        }

        if (!response.ok) {
          throw new Error("Gemini video upload failed")
        }

        let json: GeminiUploadResponse
        try {
          json = await response.json() as GeminiUploadResponse
        } catch (error) {
          throw new Error("Gemini video upload returned invalid JSON")
        }

        // Improved response parsing with validation
        let fileUri: string | undefined

        // Check both possible response formats
        if (json?.file?.uri && typeof json.file.uri === "string") {
          fileUri = json.file.uri.trim()
        } else if (json?.name && typeof json.name === "string") {
          fileUri = json.name.trim()
        }

        if (!fileUri || fileUri.length === 0) {
          throw new Error("Gemini video upload returned no file URI")
        }

        // Update DB with error handling
        try {
          await prisma.media.update({
            where: { id: mediaId },
            data: {
              geminiFileUri: fileUri,
              geminiUploadedAt: new Date()
            }
          })
        } catch (error) {
          // If DB update failed but file was already uploaded to Gemini,
          // log warning but return successful URI
          if (error instanceof PrismaClientKnownRequestError) {
            if (error.code === "P2025") {
              console.error({ event: "provider_request_failed" })
            } else {
              console.error({ event: "provider_request_failed" })
            }
          } else {
            console.error({ event: "provider_request_failed" })
          }
          // Return URI, as upload to Gemini was successful
        }

        resolvePromise(fileUri)
      } catch (error) {
        rejectPromise(error)
      } finally {
        // Remove upload record after completion (successful or unsuccessful)
        // Use exact comparison by reference to same Promise object
        const currentPromise = activeUploads.get(mediaId)
        if (currentPromise === pendingPromise) {
          // Delete only if this is still our Promise (wasn't overwritten)
          activeUploads.delete(mediaId)
        }
      }
    })()

  return pendingPromise
}

