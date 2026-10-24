import { lstatSync } from "fs"
import { resolve, join, relative, isAbsolute, sep } from "path"
import { ApiError } from "@/lib/apiErrors"

export function assertStorageId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new ApiError("Invalid storage identifier")
  return value
}

export function mediaPathCanvasId(filePath: string): string {
  if (typeof filePath !== "string" || /[\\%\u0000-\u001f\u007f?#]/.test(filePath)) throw new ApiError("Invalid media path")
  const parts = filePath.replace(/^\//, "").split("/")
  const offset = parts[0] === "uploads" ? 1 : 0
  if (parts[offset] !== "canvases" || parts.length < offset + 3 || parts.some(part => !part || part === "." || part === "..")) throw new ApiError("Invalid media path")
  return assertStorageId(parts[offset + 1])
}

export function assertNoSymlinks(fullPath: string): void {
  const root = resolve(process.cwd(), "public")
  const relativePath = relative(root, fullPath)
  if (!isAbsolute(fullPath) || !relativePath || relativePath === ".." || relativePath.startsWith(".." + sep) || isAbsolute(relativePath)) throw new ApiError("Invalid media path")
  const parts = relativePath.split(sep)
  for (let index = 0; index < parts.length; index++) {
    const current = join(root, ...parts.slice(0, index + 1))
    try {
      if (lstatSync(current).isSymbolicLink()) throw new ApiError("Invalid media path")
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") break
      throw error
    }
  }
}

export function resolvePublicPath(filePath: string, canvasId?: string, options: { allowLegacy?: boolean } = {}): string {
  const pathCanvasId = mediaPathCanvasId(filePath)
  if (canvasId && pathCanvasId !== assertStorageId(canvasId)) throw new ApiError("Invalid media path")
  if (options.allowLegacy === false && !filePath.startsWith("/uploads/canvases/")) throw new ApiError("Invalid media path")
  const resolved = resolve(process.cwd(), "public", filePath.replace(/^\//, ""))
  assertNoSymlinks(resolved)
  return resolved
}
