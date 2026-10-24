const path = require('node:path')
const fs = require('node:fs/promises')
const net = require('node:net')
const { createRequire } = require('node:module')
const { serverRequire } = require('./runtime.cjs')

// A killed main process cannot leave a writable backend running indefinitely.
// The profile lease prevents a successor from starting during this interval.
let lastHeartbeat = Date.now()
let serving = false, stopping = false
function stop() {
  if (stopping) return
  stopping = true
  if (!serving || !process.emit('SIGTERM', 'SIGTERM')) process.exit(0)
  setTimeout(() => process.exit(1), 8000).unref()
}
// Slow synchronous module loading can delay queued IPC heartbeats. Startup is
// bounded by the parent deadline and migrations' own deadline, not this lease.
setInterval(() => { if (serving && Date.now() - lastHeartbeat > 15000) stop() }, 1000).unref()
let initialized = false
process.once('disconnect', stop)
process.on('message', async data => {
  if (data.type === 'heartbeat') { lastHeartbeat = Date.now(); return }
  if (data.type === 'stop') { stop(); return }
  if (data.type !== 'start' || initialized) return
  initialized = true
  try {
    const { server, directory, secret, mode } = data
    process.umask(0o077)
    process.chdir(directory)
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'file:' + path.join(directory, 'prisma', 'dev.db').replaceAll('\\', '/')
    process.env.AUTH_SECRET = secret
    process.env.UPLOADS_DIR = path.join(directory, 'public', 'uploads')
    process.env.NEXT_TELEMETRY_DISABLED = '1'
    process.env.LLM_CANVAS_DESKTOP = '1'
    process.env.FFMPEG_PATH = path.join(server, 'media-tools', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    process.env.FFPROBE_PATH = path.join(server, 'media-tools', 'bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    const requireServer = serverRequire(server)
    if (mode === 'migrate') {
      const requireCli = createRequire(path.join(server, 'prisma-cli', 'package.json'))
      process.env.PRISMA_HIDE_UPDATE_MESSAGE = '1'
      process.env.CHECKPOINT_DISABLE = '1'
      process.env.PRISMA_GENERATE_SKIP_AUTOINSTALL = '1'
      process.argv = [process.execPath, requireCli.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(directory, 'prisma', 'schema.prisma')]
      // Prisma runs only when loaded as the process entrypoint (require.main).
      // The parent IPC channel stays alive after the CLI completes, so
      // verify the migration ledger and native client before exiting ourselves.
      require('node:module').runMain(process.argv[1])
      const expected = (await fs.readdir(path.join(directory, 'prisma', 'migrations'), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)
      const { PrismaClient } = requireServer('@prisma/client')
      const client = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } })
      const deadline = Date.now() + 75000
      while (Date.now() < deadline) {
        try {
          const rows = await client.$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"')
          if (expected.every(name => rows.some(row => row.migration_name === name && row.finished_at && !row.rolled_back_at))) {
            await client.user.findFirst({ select: { id: true, authVersion: true } })
            await client.$disconnect()
            process.exit(0)
          }
        } catch { /* The first migration may not have created the ledger yet. */ }
        await new Promise(resolve => setTimeout(resolve, 150))
      }
      await client.$disconnect()
      process.exit(1)
      return
    }
    // Random loopback port: never listen on LAN and never reuse the web port.
    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer()
      probe.once('error', reject)
      probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)) })
    })
    process.env.AUTH_URL = `http://127.0.0.1:${port}`
    const { config } = JSON.parse(await fs.readFile(path.join(directory, '.next', 'required-server-files.json'), 'utf8'))
    config.experimental = { ...config.experimental, cpus: 2 }
    process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config)
    requireServer('next')
    const { startServer } = requireServer('next/dist/server/lib/start-server')
    await startServer({ dir: directory, isDev: false, config, hostname: '127.0.0.1', port, allowRetry: false })
    lastHeartbeat = Date.now()
    serving = true
    process.send({ type: 'listening', origin: process.env.AUTH_URL })
  } catch { if (process.connected) process.send({ type: 'failed' }); process.exit(1) }
})
