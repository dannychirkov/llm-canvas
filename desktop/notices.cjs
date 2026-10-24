const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const portable = filename => filename.split(path.sep).join('/')
const noticeName = /^(?:licen[cs]es?|copying|notices?|copyright|third[-_. ]?party[-_. ]?notices?(?:text)?)(?:[._ -].*)?$/i
const readmeName = /^readme(?:\.(?:md|txt|rst))?$/i
const excludedDirectory = name => name === 'node_modules' || name === 'uploads' || name === 'canvases' || name.startsWith('.')

function contained(root, filename) {
  const relative = path.relative(root, filename)
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Notice source escapes its package root')
}

function metadata(directory, runtimePath, role) {
  let value
  try { value = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) }
  catch { throw new Error(`Missing or invalid ${role} package metadata: ${runtimePath}`) }
  if (typeof value.name !== 'string' || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(value.name) || typeof value.version !== 'string' || !/^[0-9][a-z0-9.+_-]*$/i.test(value.version)) {
    throw new Error(`Missing or invalid ${role} package name/version: ${runtimePath}`)
  }
  return value
}

function runtimeMetadata(directory, runtimePath) {
  try { fs.lstatSync(path.join(directory, 'package.json')) }
  catch (error) {
    if (error.code === 'ENOENT') return null
    throw new Error(`Unable to inspect runtime package metadata: ${runtimePath}`)
  }
  return metadata(directory, runtimePath, 'runtime')
}

function verifyTracedFiles(directory, source, runtimePath) {
  const runtimeRoot = fs.realpathSync(directory)
  let count = 0
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const filename = path.join(current, entry.name)
      if (entry.isDirectory()) { visit(filename); continue }
      const relative = path.relative(directory, filename)
      const counterpart = path.join(source, relative)
      try {
        contained(runtimeRoot, fs.realpathSync(filename))
        contained(source, fs.realpathSync(counterpart))
        if (!fs.statSync(filename).isFile() || !fs.statSync(counterpart).isFile() || !fs.readFileSync(filename).equals(fs.readFileSync(counterpart))) throw new Error('Different traced file')
      } catch {
        throw new Error(`Traced package file mismatch: ${runtimePath}/${portable(relative)}`)
      }
      count++
    }
  }
  visit(directory)
  if (!count) throw new Error(`No traced files to prove package version: ${runtimePath}`)
  return count
}

// Discover installed package boundaries only in the actual runtime tree. The
// checkout's node_modules is never enumerated to discover additional packages.
function runtimePackages(server) {
  const packages = []
  function nested(directory, ancestors) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules') modules(path.join(directory, entry.name), ancestors)
      else if (entry.isDirectory() && !entry.name.startsWith('.')) nested(path.join(directory, entry.name), ancestors)
    }
  }
  function packageAt(directory, ancestors) {
    const actual = fs.realpathSync(directory)
    contained(server, actual)
    if (ancestors.has(actual)) throw new Error('Cyclic runtime package link')
    const runtimePath = portable(path.relative(server, directory))
    packages.push({ directory, runtimePath, pkg: runtimeMetadata(directory, runtimePath) })
    nested(directory, new Set([...ancestors, actual]))
  }
  function modules(directory, ancestors) {
    const actual = fs.realpathSync(directory)
    contained(server, actual)
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.bin' || (entry.name.startsWith('.') && entry.name !== '.prisma')) continue
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const candidate = path.join(directory, entry.name)
      if (entry.name.startsWith('@') || entry.name === '.prisma') {
        contained(server, fs.realpathSync(candidate))
        for (const child of fs.readdirSync(candidate, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          if (child.isDirectory() || child.isSymbolicLink()) packageAt(path.join(candidate, child.name), ancestors)
        }
      } else packageAt(candidate, ancestors)
    }
  }
  modules(path.join(server, 'node_modules'), new Set())
  return packages.sort((a, b) => a.runtimePath.localeCompare(b.runtimePath))
}

function packageNotices(source) {
  const notices = []
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!excludedDirectory(entry.name)) visit(filename)
      } else if (noticeName.test(entry.name)) retain(filename, 'notice')
    }
  }
  function retain(filename, kind) {
    contained(source, fs.realpathSync(filename))
    if (!fs.statSync(filename).isFile()) throw new Error('Notice source must be a regular file')
    notices.push({ sourcePath: portable(path.relative(source, filename)), kind, bytes: fs.readFileSync(filename) })
  }
  visit(source)
  if (!notices.length) {
    for (const filename of fs.readdirSync(source).filter(name => readmeName.test(name)).sort()) retain(path.join(source, filename), 'readme')
  }
  return notices
}

function productionPackages(checkoutRoot) {
  let lock
  try { lock = JSON.parse(fs.readFileSync(path.join(checkoutRoot, 'package-lock.json'), 'utf8')) }
  catch { throw new Error('Missing or invalid package-lock.json for production notices') }
  if (!lock.packages || typeof lock.packages !== 'object' || Array.isArray(lock.packages)) throw new Error('Missing package-lock.packages for production notices')
  const entries = Object.entries(lock.packages).filter(([key, entry]) => key.startsWith('node_modules/') && entry && !entry.dev)
  const tailwind = 'node_modules/tailwindcss'
  if (fs.existsSync(path.join(checkoutRoot, tailwind)) && !entries.some(([key]) => key === tailwind)) entries.push([tailwind, lock.packages[tailwind]])
  return entries.sort(([a], [b]) => a.localeCompare(b)).flatMap(([sourcePath, entry]) => {
    if (sourcePath.includes('\\') || sourcePath.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) throw new Error('Invalid production package lock path')
    const installedPath = path.join(checkoutRoot, ...sourcePath.split('/'))
    // Uninstalled optional platform packages are not part of this collection.
    if (!fs.existsSync(installedPath)) return []
    const source = fs.realpathSync(installedPath)
    contained(checkoutRoot, source)
    const pkg = metadata(source, sourcePath, 'installed production')
    if (!entry || typeof entry.version !== 'string' || !/^[0-9][a-z0-9.+_-]*$/i.test(entry.version) || pkg.version !== entry.version) throw new Error(`Installed production package/lock version mismatch: ${sourcePath}`)
    return [{ source, sourcePath: portable(path.relative(checkoutRoot, source)), pkg, collectionScope: sourcePath === tailwind ? 'generated-css' : 'declared-production' }]
  })
}

function libvipsReview(pkg, files) {
  if (!pkg.name.startsWith('@img/sharp-libvips-') || files.some(file => file.kind === 'notice')) return undefined
  const review = { fullLicenseTexts: 'not-retained', readmeIsFullLicenseText: false }
  if (pkg.version === '1.3.4') {
    // Checked against the exact upstream package release, not a moving branch.
    // Both COPYING URLs returned HTTP 404. The tagged THIRD-PARTY-NOTICES.md
    // is a license/link table, not an aggregate of the bundled license texts.
    review.aggregateCopying = 'unavailable-at-checked-upstream-locations'
    review.checkedPackageVersion = '1.3.4'
    review.checkedUrls = [
      'https://raw.githubusercontent.com/lovell/sharp-libvips/v1.3.4/COPYING',
      'https://github.com/lovell/sharp-libvips/releases/download/v1.3.4/COPYING',
    ]
    review.upstreamNoticeTable = 'https://raw.githubusercontent.com/lovell/sharp-libvips/v1.3.4/THIRD-PARTY-NOTICES.md'
  } else review.aggregateCopying = 'not-investigated-for-this-version'
  return review
}

// Synchronous, offline staging helper. Call after tracing/copying runtime deps.
// Requires a fresh output directory; never changes node_modules or runtime code.
function copyRuntimeNotices(checkoutRoot, server) {
  checkoutRoot = fs.realpathSync(checkoutRoot)
  server = fs.realpathSync(server)
  const output = path.join(server, 'THIRD-PARTY-NOTICES')
  if (fs.existsSync(output)) throw new Error('Use a fresh THIRD-PARTY-NOTICES directory')
  const plan = runtimePackages(server).map(({ directory, runtimePath, pkg }) => {
    const exact = path.join(checkoutRoot, ...runtimePath.split('/'))
    const canonical = pkg ? path.join(checkoutRoot, 'node_modules', ...pkg.name.split('/')) : null
    // A present but conflicting package is an error, never hidden by fallback.
    // Without runtime metadata, only the exact installed path can prove origin.
    const selected = fs.existsSync(exact) ? exact : canonical
    if (!selected || !fs.existsSync(selected)) throw new Error(`Missing installed package: ${runtimePath}`)
    const source = fs.realpathSync(selected)
    contained(checkoutRoot, source)
    const installed = metadata(source, runtimePath, 'installed')
    let versionProof = 'package-metadata-match', tracedFileCount
    if (pkg) {
      if (installed.name !== pkg.name || installed.version !== pkg.version) throw new Error(`Installed package name/version mismatch: ${runtimePath}`)
    } else {
      tracedFileCount = verifyTracedFiles(directory, source, runtimePath)
      versionProof = 'traced-files-match-installed'
      pkg = installed
    }
    const files = packageNotices(source)
    const safeDirectory = pkg.name.replace(/[^a-z0-9._-]/gi, '_').slice(0, 60) + '-' + pkg.version.slice(0, 30) + '-' + hash(runtimePath).slice(0, 16)
    return { pkg, runtimePath, source, sourcePath: portable(path.relative(checkoutRoot, source)), files, safeDirectory, declaredLicense: installed.license ?? null, versionProof, tracedFileCount, collectionScope: 'runtime-traced' }
  })
  const selectedSources = new Set(plan.map(item => item.source))
  for (const { source, sourcePath, pkg, collectionScope } of productionPackages(checkoutRoot)) {
    if (selectedSources.has(source)) continue
    selectedSources.add(source)
    plan.push({
      pkg, sourcePath, runtimePath: null, collectionScope,
      files: packageNotices(source), declaredLicense: pkg.license ?? null, versionProof: 'package-lock-version-match',
      safeDirectory: pkg.name.replace(/[^a-z0-9._-]/gi, '_').slice(0, 60) + '-' + pkg.version.slice(0, 30) + '-' + hash('declared:' + sourcePath).slice(0, 16),
    })
  }
  const inventory = {
    schemaVersion: 1,
    scope: 'Runtime-traced packages plus the installed declared production tree from package-lock.packages (may include unused packages), and installed Tailwind CSS for generated CSS. Client-only entries have runtimePath null. All package-supplied notice filenames are retained, including vendored/unused subpackages. Runtime identity uses exact metadata, or all traced file bytes at the same installed path when metadata is absent; declared production versions must match the lockfile. Nested node_modules are recorded separately. README is retained only when no notice files are supplied; retention is not a claim of complete license texts.',
    packages: [],
  }
  // Identity/source preflight completes before publishing any output.
  fs.mkdirSync(output)
  try {
    for (const { pkg, runtimePath, sourcePath, collectionScope, files, safeDirectory, declaredLicense, versionProof, tracedFileCount } of plan) {
      const retainedFiles = files.map(file => {
        const relative = safeDirectory + '/' + file.sourcePath
        const destination = path.join(output, ...relative.split('/'))
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        fs.writeFileSync(destination, file.bytes, { flag: 'wx' })
        return { path: relative, sourcePath: file.sourcePath, kind: file.kind, sha256: hash(file.bytes) }
      })
      const libvips = libvipsReview(pkg, files)
      inventory.packages.push({
        name: pkg.name, version: pkg.version, runtimePath, sourcePath, collectionScope, declaredLicense, versionProof,
        ...(tracedFileCount === undefined ? {} : { tracedFileCount }),
        noticeStatus: files.some(file => file.kind === 'notice') ? 'package-notices-retained' : files.length ? 'readme-only' : 'no-notices-supplied',
        retainedFiles, ...(libvips ? { libvips } : {}),
      })
    }
    fs.writeFileSync(path.join(output, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n', { flag: 'wx' })
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true })
    throw error
  }
  return inventory
}

module.exports = { copyRuntimeNotices }
