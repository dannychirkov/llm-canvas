import { NextResponse } from 'next/server'
import { access, open, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

let pending: Promise<boolean> | undefined
let cached: { healthy: boolean; until: number } | undefined

async function writableDirectory(directory: string) {
  const filename = join(directory, `.readiness-${randomUUID()}`)
  const file = await open(filename, 'wx', 0o600)
  try {
    await file.writeFile('ready')
    await file.sync()
  } finally {
    try {
      await file.close()
    } finally {
      await unlink(filename)
    }
  }
}

async function readiness(): Promise<boolean> {
  try {
    const url = process.env.DATABASE_URL || 'file:./dev.db'
    if (!url.startsWith('file:')) return false
    const filename = decodeURIComponent(url.slice(5).split('?')[0])
    const database = isAbsolute(filename) ? filename : join(process.cwd(), 'prisma', filename)
    await access(database, constants.R_OK | constants.W_OK)
    await prisma.user.findFirst({ select: { id: true, authVersion: true } })
    await writableDirectory(dirname(database))
    await writableDirectory(process.env.UPLOADS_DIR || join(process.cwd(), 'public', 'uploads'))
    return true
  } catch {
    return false
  }
}

export async function GET() {
  let healthy = cached && cached.until > Date.now() ? cached.healthy : false
  if (!cached || cached.until <= Date.now()) {
    pending ??= readiness().then(result => {
      cached = { healthy: result, until: Date.now() + (result ? 5000 : 1000) }
      return result
    }).finally(() => { pending = undefined })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      healthy = await Promise.race([pending, new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 2000) })])
    } finally {
      clearTimeout(timer)
    }
  }
  return NextResponse.json({ status: healthy ? 'healthy' : 'unhealthy', timestamp: new Date().toISOString(), service: 'llm-canvas' }, {
    status: healthy ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}
