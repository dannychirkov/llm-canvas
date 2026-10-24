const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const crypto = require('node:crypto')
const syncFs = require('node:fs')

function linkExternalPackages(next, modules, aliases) {
  if (!Array.isArray(aliases) || aliases.length > 2) throw new Error('Invalid desktop package aliases')
  for (const entry of aliases) {
    if (!entry || !['jsdom', '@prisma/client'].includes(entry.package) || !new RegExp('^' + entry.package + '-[a-f0-9]{16}$').test(entry.alias)) throw new Error('Invalid desktop package alias')
    const alias = path.join(next, 'node_modules', entry.alias)
    const target = path.join(modules, entry.package)
    syncFs.mkdirSync(path.dirname(alias), { recursive: true })
    syncFs.symlinkSync(process.platform === 'win32' ? target : path.relative(path.dirname(alias), target), alias, process.platform === 'win32' ? 'junction' : 'dir')
  }
}

// The main process owns the Electron single-instance lock before touching this
// lease. A successor must also wait for its predecessor's backend to exit.
async function claimProfile(profile) {
  await fs.mkdir(profile, { recursive: true, mode: 0o700 })
  const filename = path.join(profile, 'runtime.json')
  try {
    const entry = await fs.lstat(filename)
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw new Error('Invalid desktop lease')
    const previous = JSON.parse(await fs.readFile(filename, 'utf8'))
    if (!previous || !Number.isSafeInteger(previous.mainPid) || previous.mainPid <= 0 || typeof previous.nonce !== 'string' || !/^[a-f0-9-]{36}$/i.test(previous.nonce)) throw new Error('Invalid desktop lease')
    for (const pid of [previous.mainPid, previous.childPid]) {
      if (pid === undefined) continue
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid desktop lease')
      try { process.kill(pid, 0); throw new Error('The previous local server is still running. Please retry shortly.') }
      catch (error) { if (error.code !== 'ESRCH') throw error }
    }
    await fs.unlink(filename)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const state = { mainPid: process.pid, nonce: crypto.randomUUID() }
  await fs.writeFile(filename, JSON.stringify(state), { flag: 'wx', mode: 0o600 })
  return {
    async child(pid) {
      state.childPid = pid
      const temporary = filename + '.' + state.nonce
      await fs.writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 })
      await fs.rename(temporary, filename)
    },
    async release() {
      try {
        const current = JSON.parse(await fs.readFile(filename, 'utf8'))
        if (current.nonce === state.nonce) await fs.unlink(filename)
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    },
  }
}

async function prepareRuntime(profile, server) {
  const data = path.join(profile, 'data')
  await fs.mkdir(path.join(data, 'public', 'uploads'), { recursive: true, mode: 0o700 })
  await fs.mkdir(path.join(data, 'prisma'), { recursive: true, mode: 0o700 })
  // Only build artifacts are replaced. DB/media remain in a stable location.
  const next = path.join(data, '.next')
  await fs.rm(next, { recursive: true, force: true })
  const sourceNext = path.join(server, '.next')
  await fs.cp(sourceNext, next, { recursive: true, filter: filename => path.relative(sourceNext, filename).split(path.sep)[0] !== 'node_modules' })
  const modules = path.join(data, 'node_modules')
  try {
    const entry = await fs.lstat(modules)
    if (!entry.isSymbolicLink()) throw new Error('Unexpected desktop module directory')
    await fs.unlink(modules)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  await fs.symlink(path.join(server, 'node_modules'), modules, process.platform === 'win32' ? 'junction' : 'dir')
  linkExternalPackages(next, modules, JSON.parse(await fs.readFile(path.join(server, 'external-packages.json'), 'utf8')))
  await fs.cp(path.join(server, 'public'), path.join(data, 'public'), { recursive: true })
  await fs.copyFile(path.join(server, 'prisma', 'schema.prisma'), path.join(data, 'prisma', 'schema.prisma'))
  await fs.cp(path.join(server, 'prisma', 'migrations'), path.join(data, 'prisma', 'migrations'), { recursive: true })
  return data
}

function serverRequire(server) { return createRequire(path.join(server, 'package.json')) }

module.exports = { claimProfile, prepareRuntime, serverRequire, linkExternalPackages }
