import AdmZip from "adm-zip"
import { inflateRawSync } from "zlib"
import { ApiError } from "@/lib/apiErrors"

export const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
export const MAX_ARCHIVE_INFLATED_BYTES = 512 * 1024 * 1024
export const MAX_ARCHIVE_ENTRY_BYTES = 128 * 1024 * 1024
export const MAX_ARCHIVE_ENTRIES = 4096

const crcTable = Array.from({ length: 256 }, (_, byte) => {
  let checksum = byte
  for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0)
  return checksum >>> 0
})

function crc32(buffer: Buffer): number {
  let checksum = 0xffffffff
  for (const byte of buffer) checksum = (checksum >>> 8) ^ crcTable[(checksum ^ byte) & 255]
  return (checksum ^ 0xffffffff) >>> 0
}

export function readBoundedArchive(buffer: Buffer): Map<string, Buffer> {
  if (buffer.length > MAX_ARCHIVE_BYTES) throw new ApiError("Archive is too large", 413)
  let endOffset = -1
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { endOffset = offset; break }
  }
  if (endOffset < 0) throw new ApiError("Invalid ZIP archive")
  const count = buffer.readUInt16LE(endOffset + 10)
  const centralSize = buffer.readUInt32LE(endOffset + 12)
  const centralOffset = buffer.readUInt32LE(endOffset + 16)
  if (buffer.readUInt16LE(endOffset + 4) || buffer.readUInt16LE(endOffset + 6) || buffer.readUInt16LE(endOffset + 8) !== count || count > MAX_ARCHIVE_ENTRIES || centralOffset + centralSize !== endOffset) throw new ApiError("Unsupported or oversized ZIP archive")
  let offset = centralOffset
  let declaredTotal = 0
  for (let index = 0; index < count; index++) {
    if (offset + 46 > endOffset || buffer.readUInt32LE(offset) !== 0x02014b50) throw new ApiError("Invalid ZIP directory")
    const inflatedSize = buffer.readUInt32LE(offset + 24)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const flags = buffer.readUInt16LE(offset + 8)
    const method = buffer.readUInt16LE(offset + 10)
    const extraLength = buffer.readUInt16LE(offset + 30)
    declaredTotal += inflatedSize
    if ((flags & 1) || ![0, 8].includes(method) || inflatedSize > MAX_ARCHIVE_ENTRY_BYTES || declaredTotal > MAX_ARCHIVE_INFLATED_BYTES || inflatedSize > Math.max(1024 * 1024, compressedSize * 200)) throw new ApiError("Archive expansion limit exceeded", 413)
    let extraOffset = offset + 46 + buffer.readUInt16LE(offset + 28)
    const extraEnd = extraOffset + extraLength
    if (extraEnd > endOffset) throw new ApiError("Invalid ZIP metadata")
    while (extraOffset < extraEnd) {
      if (extraOffset + 4 > extraEnd || buffer.readUInt16LE(extraOffset) === 1) throw new ApiError("ZIP64 archives are not supported")
      extraOffset += 4 + buffer.readUInt16LE(extraOffset + 2)
    }
    if (extraOffset !== extraEnd) throw new ApiError("Invalid ZIP metadata")
    offset += 46 + buffer.readUInt16LE(offset + 28) + extraLength + buffer.readUInt16LE(offset + 32)
  }
  if (offset !== endOffset) throw new ApiError("Invalid ZIP directory")
  const zip = new AdmZip(buffer)
  const entries = zip.getEntries()
  if (entries.length !== count) throw new ApiError("Invalid ZIP entry count")
  const files = new Map<string, Buffer>()
  let total = 0
  for (const entry of entries) {
    const name = entry.entryName
    const parts = name.replace(/\/$/, "").split("/")
    if (/^[\/\\]/.test(name) || /[\\%\u0000-\u001f\u007f]/.test(name) || parts.some(part => !part || part === "." || part === "..") || files.has(name)) throw new ApiError("Unsafe or duplicate archive path")
    if (entry.isDirectory) continue
    const compressed = entry.getCompressedData()
    let data: Buffer
    try {
      data = entry.header.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.min(entry.header.size, MAX_ARCHIVE_INFLATED_BYTES - total) + 1 })
    } catch { throw new ApiError("Invalid or oversized ZIP entry") }
    total += data.length
    if (data.length !== entry.header.size || total > MAX_ARCHIVE_INFLATED_BYTES || crc32(data) !== entry.header.crc) throw new ApiError("Invalid ZIP entry data")
    files.set(name, data)
  }
  return files
}
