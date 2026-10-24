import { spawn } from "child_process"
import fs from "fs"
const { mkdir, readdir, stat, access } = fs.promises
const { constants } = fs
import { join, dirname } from "path"
import { imageSizeFromFile } from "image-size/fromFile"

export interface VideoMetadata {
  durationMs: number
  width: number
  height: number
  frameRate?: number
  codecName?: string
}

export interface VideoFrameInfo {
  path: string
  width: number
  height: number
  timestampMs: number
  mimeType: string
  fileSize: number
}

export interface GenerateFramesOptions {
  inputPath: string
  outputDir: string
  durationMs: number
  maxDimension?: number
  frameIntervalSeconds?: number // Allow override
}

export interface GenerateThumbnailOptions {
  inputPath: string
  outputPath: string
  maxDimension?: number
}

const DEFAULT_MAX_DIMENSION = 1024
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

const SCALE_FILTER = "scale='if(gte(iw,ih),%d,-2)':'if(gte(ih,iw),%d,-2)'"

function ensureFfmpegPath(label: "ffmpeg" | "ffprobe"): string {
  const envPath = label === "ffmpeg" ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH
  if (envPath) {
    return envPath
  }

  const executable = label + (process.platform === "win32" ? ".exe" : "")
  // Development fallback for existing installations; packaged desktop/server
  // distributions explicitly set their controlled tool paths before startup.
  return label === "ffmpeg"
    ? join(process.cwd(), "node_modules", "ffmpeg-static", executable)
    : join(process.cwd(), "node_modules", "ffprobe-static", "bin", process.platform, process.arch, executable)
}

async function runCommand(
  binaryPath: string,
  args: string[],
  timeoutMs: number = COMMAND_TIMEOUT_MS
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""

    const timeout = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new Error(`Command exceeded timeout ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on("data", (data) => {
      stdout += data.toString()
    })

    child.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    child.on("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    child.on("close", (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`Command exited with code ${code}: ${stderr || stdout}`))
      }
    })
  })
}

async function checkFileExists(filePath: string): Promise<void> {
  try {
    await access(filePath, constants.F_OK)
  } catch {
    throw new Error(`File not found: ${filePath}`)
  }
}

export async function extractVideoMetadata(inputPath: string): Promise<VideoMetadata> {
  await checkFileExists(inputPath)

  const ffprobePath = ensureFfmpegPath("ffprobe")
  const args = [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_entries",
    "format=duration:stream=codec_type,width,height,avg_frame_rate,codec_name",
    inputPath,
  ]

  try {
    const { stdout } = await runCommand(ffprobePath, args)
    const parsed = JSON.parse(stdout)
    const videoStream =
      parsed?.streams?.find((stream: any) => stream.codec_type === "video") ??
      parsed?.streams?.[0] ??
      null

    const durationSec = parsed?.format?.duration ? parseFloat(parsed.format.duration) : 0
    let frameRate: number | undefined

    if (videoStream?.avg_frame_rate && videoStream.avg_frame_rate.includes("/")) {
      const [num, den] = videoStream.avg_frame_rate.split("/").map((val: string) => parseFloat(val))
      if (!isNaN(num) && !isNaN(den) && den !== 0) {
        frameRate = num / den
      }
    }

    return {
      durationMs: Math.max(0, Math.round(durationSec * 1000)),
      width: videoStream?.width ?? 0,
      height: videoStream?.height ?? 0,
      frameRate,
      codecName: videoStream?.codec_name,
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse ffprobe output: ${error.message}`)
    }
    throw error
  }
}

export function getFrameIntervalSeconds(durationMs: number): number {
  const durationSec = durationMs / 1000
  if (durationSec <= 0) return 1
  if (durationSec < 10) return 1
  if (durationSec <= 60) return 2
  return 5
}

function buildScaleFilter(maxDimension: number): string {
  return SCALE_FILTER.replace(/%d/g, String(maxDimension))
}

export async function generateVideoThumbnail(options: GenerateThumbnailOptions): Promise<void> {
  await checkFileExists(options.inputPath)

  const ffmpeg = ensureFfmpegPath("ffmpeg")
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION
  await mkdir(dirname(options.outputPath), { recursive: true })

  const args = [
    "-y",
    "-i",
    options.inputPath,
    "-vframes",
    "1",
    "-vf",
    `${buildScaleFilter(maxDimension)},format=yuvj420p`,
    options.outputPath,
  ]

  await runCommand(ffmpeg, args)
}

export async function generateVideoFrames(options: GenerateFramesOptions): Promise<VideoFrameInfo[]> {
  await checkFileExists(options.inputPath)

  const ffmpeg = ensureFfmpegPath("ffmpeg")
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION
  await mkdir(options.outputDir, { recursive: true })

  // Use provided interval or calculate automatically
  const intervalSeconds = options.frameIntervalSeconds ?? getFrameIntervalSeconds(options.durationMs)
  const fpsExpression = (1 / intervalSeconds).toFixed(3)
  const outputPattern = join(options.outputDir, "frame_%05d.jpg")

  // Use yuvj420p - correct pixel format for JPEG encoding
  // This ensures correct pixel format conversion before encoding
  const vf = `fps=${fpsExpression},${buildScaleFilter(maxDimension)},format=yuvj420p`

  const args = ["-y", "-i", options.inputPath, "-vf", vf, outputPattern]
  await runCommand(ffmpeg, args)

  const files = (await readdir(options.outputDir))
    .filter((file) => file.startsWith("frame_") && file.endsWith(".jpg"))
    .sort()

  if (files.length === 0) {
    throw new Error(`Failed to create frames from video. Check that file is a valid video.`)
  }

  const frames: VideoFrameInfo[] = []
  const intervalMs = intervalSeconds * 1000

  for (let index = 0; index < files.length; index++) {
    const fileName = files[index]
    const absolutePath = join(options.outputDir, fileName)

    let width = 0
    let height = 0

    try {
      const buffer = await imageSizeFromFile(absolutePath)
      width = buffer?.width ?? 0
      height = buffer?.height ?? 0
    } catch (error) {
      console.warn(`Failed to determine dimensions for ${absolutePath}:`, error)
    }

    const stats = await stat(absolutePath)

    frames.push({
      path: absolutePath,
      width,
      height,
      timestampMs: Math.min(options.durationMs, Math.round(index * intervalMs)),
      mimeType: "image/jpeg",
      fileSize: stats.size,
    })
  }

  return frames
}

