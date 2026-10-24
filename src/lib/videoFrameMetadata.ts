export function videoFrameList<T>(metadata: T[] | { frames?: T[] } | null | undefined): T[] {
  if (Array.isArray(metadata)) return metadata
  return metadata && Array.isArray(metadata.frames) ? metadata.frames : []
}
