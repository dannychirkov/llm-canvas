import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

const SEARCH_FIELDS = ["promptText", "responseText", "textContent", "noteContent", "notes", "value", "summaryText", "title", "caption", "filename", "error"] as const
const FIELD_LIMIT = 262144

export async function searchableCanvasNodes(canvasId: string, userId: string) {
  const columns = SEARCH_FIELDS.map(field => Prisma.sql`substr(json_extract(node.value, ${"$.data." + field}), 1, ${FIELD_LIMIT}) AS ${Prisma.raw('"' + field + '"')}`)
  const rows = await prisma.$queryRaw<Array<{ id: string; type: string; truncated: number } & Record<string, unknown>>>(Prisma.sql`
    SELECT json_extract(node.value, '$.id') AS id, json_extract(node.value, '$.type') AS type,
    ${Prisma.join(columns)},
    (${Prisma.join(SEARCH_FIELDS.map(field => Prisma.sql`length(json_extract(node.value, ${"$.data." + field})) > ${FIELD_LIMIT}`), " OR ")}) AS truncated
    FROM canvases AS canvas, json_each(CASE WHEN json_valid(canvas.content) THEN canvas.content ELSE '{"nodes":[]}' END, '$.nodes') AS node
    WHERE canvas.id = ${canvasId} AND canvas.userId = ${userId} LIMIT 1001
  `)
  let budget = 2 * 1024 * 1024
  let searchTruncated = rows.length > 1000
  const nodes = []
  for (const row of rows.slice(0, 1000)) {
    if (budget <= 0) { searchTruncated = true; break }
    const data: Record<string, string> = {}
    for (const field of SEARCH_FIELDS) {
      if (typeof row[field] !== "string") continue
      const text = row[field] as string
      const value = text.slice(0, Math.max(0, budget))
      budget -= value.length
      if (value.length < text.length || row.truncated) searchTruncated = true
      data[field] = value
    }
    if (typeof row.id === "string") nodes.push({ id: row.id, type: row.type, data })
  }
  return { nodes, searchTruncated }
}
