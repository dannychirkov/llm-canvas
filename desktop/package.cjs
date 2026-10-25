const fs = require('node:fs')
const path = require('node:path')
const { build, Platform, Arch } = require('electron-builder')
const { externalLinks } = require('../ops/stage-artifact')
const { createHash } = require('node:crypto')
const { copyRuntimeNotices } = require('./notices.cjs')

function resourceMappings(server) { return [{ from: path.dirname(server), to: '.', filter: ['server/**/*'] }] }
function linuxPackageOptions() {
  return { category: 'Development', executableName: 'llm-canvas', executableArgs: [], artifactName: 'LLM-Canvas-${version}-${arch}.${ext}' }
}
function writeLinuxLauncher(directory) {
  // electron-builder's generated AppRun falls back to --no-sandbox and adds
  // loader paths. Copy our launcher with the payload to replace that template.
  const launcher = path.join(directory, 'AppRun')
  fs.writeFileSync(launcher, '#!/bin/sh\nset -eu\nappdir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)\nexec "$appdir/llm-canvas" "$@"\n', { mode: 0o755 })
  fs.chmodSync(launcher, 0o755)
}
function verifyMediaBuild(directory, platform = process.platform, architecture = process.arch) {
  const root = fs.realpathSync(directory)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
  const pinned = require('../ops/media-sources.json').sources
  if (manifest.platform !== platform || manifest.architecture !== architecture || manifest.license !== 'LGPL-2.1-or-later' || manifest.ffmpegVersion !== pinned.find(source => source.name === 'ffmpeg').version) throw new Error('Media build does not match the target platform/version/license')
  for (const source of pinned) {
    if (!manifest.sources?.some(value => value.name === source.name && value.version === source.version && value.archive?.sha256 === source.archive.sha256)) throw new Error('Media source provenance mismatch')
  }
  if (!Array.isArray(manifest.files) || !manifest.sourceArchive?.path || !manifest.sourceArchive?.sha256) throw new Error('Missing media source distribution inventory')
  const expected = {}
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || entry.path.includes('\\') || entry.path.split('/').some(part => !part || part === '..' || part === '.') || path.isAbsolute(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid media inventory entry')
    if (Object.hasOwn(expected, entry.path)) throw new Error('Duplicate media inventory entry')
    expected[entry.path] = entry.sha256
  }
  const actual = serverInventory(root)
  delete actual['manifest.json']
  if (Object.keys(actual).length !== Object.keys(expected).length || Object.entries(expected).some(([name, sha]) => actual[name] !== sha)) throw new Error('Media build file inventory mismatch')
  if (expected[manifest.sourceArchive.path] !== manifest.sourceArchive.sha256) throw new Error('Media source archive checksum mismatch')
  for (const name of ['ffmpeg', 'ffprobe']) if (!expected['bin/' + name + (platform === 'win32' ? '.exe' : '')]) throw new Error('Missing paired media executable')
  return manifest
}
function serverInventory(root) {
  root = fs.realpathSync(root)
  const files = {}
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name), relative = path.relative(root, filename).split(path.sep).join('/')
      if (entry.isSymbolicLink()) {
        const target = fs.realpathSync(filename)
        if (!target.startsWith(root + path.sep)) throw new Error('Desktop dependency link escapes its bundle: ' + relative)
        files[relative] = 'link:' + path.relative(root, target).split(path.sep).join('/')
      } else if (entry.isDirectory()) visit(filename)
      else files[relative] = createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
    }
  }
  visit(root)
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
}

function copyPrismaPackages(root, server) {
  const cli = path.join(server, 'prisma-cli')
  fs.mkdirSync(cli, { recursive: true })
  fs.writeFileSync(path.join(cli, 'package.json'), '{"private":true}')
  const roots = new Map(), copied = new Map()
  function copy(name, from, destination, ancestors = new Set()) {
    let ancestor = from, source
    while (true) {
      const candidate = path.join(ancestor, 'node_modules', name)
      if (fs.existsSync(path.join(candidate, 'package.json'))) { source = candidate; break }
      const parent = path.dirname(ancestor)
      if (parent === ancestor) throw new Error('Missing bundled dependency: ' + name)
      ancestor = parent
    }
    source = fs.realpathSync(source)
    // Hoist compatible packages to keep Windows installation paths short.
    // Only conflicting source resolutions need a requester-local dependency.
    const rootSource = roots.get(name)
    const target = path.join(rootSource && rootSource !== source ? destination : cli, 'node_modules', name)
    if (!rootSource) roots.set(name, source)
    if (copied.has(target)) {
      if (copied.get(target) !== source) throw new Error('Conflicting bundled CLI dependency: ' + name)
      return
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    if (ancestors.has(source)) throw new Error('Cyclic bundled CLI dependency: ' + name)
    copied.set(target, source)
    const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json')))
    fs.cpSync(source, target, { recursive: true, filter: filename => !path.relative(source, filename).split(path.sep).includes('node_modules') })
    const nextAncestors = new Set([...ancestors, source])
    for (const dependency of Object.keys(pkg.dependencies || {})) copy(dependency, source, target, nextAncestors)
  }
  copy('prisma', root, cli)
}

async function stageDesktop(directory, root = path.resolve(__dirname, '..')) {
  const requiredNode = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim()
  if (process.versions.electron || process.versions.node !== requiredNode) throw new Error('Build desktop packages with standard Node.js ' + requiredNode)
  if (fs.existsSync(directory)) throw new Error('Use a fresh desktop staging directory')
  const buildRoot = path.join(root, '.next')
  const standalone = path.join(buildRoot, 'standalone')
  const id = fs.readFileSync(path.join(buildRoot, 'BUILD_ID'), 'utf8')
  if (id !== fs.readFileSync(path.join(standalone, '.next', 'BUILD_ID'), 'utf8')) throw new Error('Incoherent standalone build')
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))
  const config = JSON.parse(fs.readFileSync(path.join(standalone, '.next', 'required-server-files.json'))).config
  if (config.env.NEXT_PUBLIC_APP_VERSION !== pkg.version) throw new Error('Rebuild Next.js after changing the version')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const app = path.join(directory, 'app'), server = path.join(directory, 'server')
  fs.mkdirSync(app)
  fs.mkdirSync(server)
  fs.mkdirSync(path.join(server, 'bootstrap'))
  for (const name of ['backend.cjs', 'runtime.cjs']) fs.copyFileSync(path.join(root, 'desktop', name), path.join(server, 'bootstrap', name))
  fs.cpSync(path.join(root, 'desktop'), path.join(app, 'desktop'), { recursive: true })
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(app, 'LICENSE'))
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: pkg.name, productName: 'LLM Canvas', version: pkg.version, description: pkg.description, author: pkg.author, license: pkg.license, main: 'desktop/main.cjs', dependencies: {} }, null, 2))
  const aliases = externalLinks(standalone)
  const tracedNext = path.join(standalone, '.next')
  fs.cpSync(tracedNext, path.join(server, '.next'), { recursive: true, filter: filename => path.relative(tracedNext, filename).split(path.sep)[0] !== 'node_modules' })
  fs.cpSync(path.join(standalone, 'node_modules'), path.join(server, 'node_modules'), { recursive: true, dereference: true })
  fs.writeFileSync(path.join(server, 'external-packages.json'), JSON.stringify(aliases))
  fs.cpSync(path.join(buildRoot, 'static'), path.join(server, '.next', 'static'), { recursive: true })
  fs.cpSync(path.join(root, 'public'), path.join(server, 'public'), { recursive: true, filter: filename => !['uploads', 'canvases'].includes(path.relative(path.join(root, 'public'), filename).split(path.sep)[0]) })
  fs.mkdirSync(path.join(server, 'prisma'))
  fs.copyFileSync(path.join(root, 'prisma', 'schema.prisma'), path.join(server, 'prisma', 'schema.prisma'))
  fs.cpSync(path.join(root, 'prisma', 'migrations'), path.join(server, 'prisma', 'migrations'), { recursive: true })
  fs.copyFileSync(path.join(root, 'package.json'), path.join(server, 'package.json'))
  // Use standard Node for server/native media code. Electron's Linux runtime
  // leaks GLib symbols and can conflict with Sharp/libvips.
  fs.mkdirSync(path.join(server, 'runtime'))
  fs.copyFileSync(process.execPath, path.join(server, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'))
  const licenseUrl = `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`
  const licenseResponse = await fetch(licenseUrl, { signal: AbortSignal.timeout(30000) })
  if (!licenseResponse.ok) throw new Error('Unable to bundle Node.js license notices')
  const nodeLicense = await licenseResponse.text()
  if (!nodeLicense.includes('Node.js is licensed for use') || nodeLicense.length < 50000) throw new Error('Unexpected Node.js license notices')
  fs.writeFileSync(path.join(server, 'runtime', 'NODE-LICENSE.txt'), nodeLicense)
  copyPrismaPackages(root, server)
  const mediaRoot = process.env.LLM_CANVAS_MEDIA_BUILD
  if (!mediaRoot) throw new Error('Build the paired media tools first and set LLM_CANVAS_MEDIA_BUILD')
  verifyMediaBuild(mediaRoot)
  fs.cpSync(mediaRoot, path.join(server, 'media-tools'), { recursive: true, dereference: true })
  // Never redistribute the superseded static packages, even if a stale trace
  // still includes them. Their versions/architectures/source provenance differ.
  for (const name of ['ffmpeg-static', 'ffprobe-static']) fs.rmSync(path.join(server, 'node_modules', name), { recursive: true, force: true })
  copyRuntimeNotices(root, server)
  // Assert native modules/engines are available before making an installer.
  for (const name of ['@prisma/client', 'sharp']) require.resolve(name, { paths: [server] })
  for (const name of ['ffmpeg', 'ffprobe']) if (!fs.statSync(path.join(server, 'media-tools', 'bin', name + (process.platform === 'win32' ? '.exe' : ''))).isFile()) throw new Error('Missing paired media tool: ' + name)
  require.resolve('prisma/build/index.js', { paths: [path.join(server, 'prisma-cli')] })
  function inspect(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name)
      if (entry.isSymbolicLink()) {
        const resolved = fs.realpathSync(filename)
        if (!resolved.startsWith(server + path.sep)) throw new Error('Desktop dependency link escapes its bundle')
      } else if (entry.isDirectory()) inspect(filename)
      else if (/^(?:\.env(?:\..*)?|docker\.env.*|\.auth\.secret.*)$/.test(entry.name) || /\.(?:db|key|pem)(?:-.*)?$/.test(entry.name)) throw new Error('Private runtime file in desktop bundle')
    }
  }
  inspect(server)
  fs.writeFileSync(path.join(directory, 'desktop-manifest.json'), JSON.stringify({ version: pkg.version, buildId: id, platform: process.platform, architecture: process.arch, node: process.versions.node, privateRuntimePathsIncluded: false }, null, 2))
  return { app, server, version: pkg.version }
}

async function packageDesktop(directory, output, unpacked = false, selectedTargets) {
  if (!['linux', 'win32', 'darwin'].includes(process.platform)) throw new Error('Unsupported desktop platform')
  const staged = await stageDesktop(directory)
  return packageStaged(staged, output, unpacked, undefined, selectedTargets)
}
async function packageStaged(staged, output, unpacked = false, prepackaged, selectedTargets) {
  const inventoryFile = path.join(path.dirname(staged.app), 'server-inventory.json')
  const expected = prepackaged ? JSON.parse(fs.readFileSync(inventoryFile)) : serverInventory(staged.server)
  if (!prepackaged) fs.writeFileSync(inventoryFile, JSON.stringify(expected))
  function verifyServer(root) {
    const actual = serverInventory(root)
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Packaged server differs from the verified staging inventory')
  }
  if (prepackaged) verifyServer(path.join(prepackaged, process.platform === 'darwin' ? 'Contents/Resources' : 'resources', 'server'))
  const platform = process.platform === 'win32' ? Platform.WINDOWS : process.platform === 'darwin' ? Platform.MAC : Platform.LINUX
  const targets = process.platform === 'win32' ? ['nsis'] : process.platform === 'darwin' ? ['dmg'] : ['AppImage', 'tar.gz']
  if (selectedTargets && (!selectedTargets.length || selectedTargets.some(target => !targets.includes(target)))) throw new Error('Unsupported native package target')
  const architecture = process.arch === 'arm64' ? Arch.arm64 : Arch.x64
  return build({ projectDir: staged.app, prepackaged, targets: platform.createTarget(unpacked ? ['dir'] : selectedTargets || targets, architecture), publish: 'never', config: {
    appId: 'io.github.dannychirkov.llm-canvas', productName: 'LLM Canvas', electronVersion: require('electron/package.json').version,
    directories: { app: staged.app, output },
    files: ['desktop/main.cjs', 'desktop/backend.cjs', 'desktop/profile.cjs', 'desktop/runtime.cjs', 'desktop/window-policy.cjs', 'desktop/updates.cjs', 'desktop/assets/icon.png', 'desktop/assets/icon.ico', 'LICENSE', 'package.json'],
    extraResources: resourceMappings(staged.server),
    afterPack: async context => {
      verifyServer(path.join(context.packager.getResourcesDir(context.appOutDir), 'server'))
      if (process.platform === 'linux') writeLinuxLauncher(context.appOutDir)
    },
    asar: true, npmRebuild: false,
    linux: { ...linuxPackageOptions(), icon: path.resolve(staged.app, 'desktop/assets/icon.png') },
    win: { icon: path.resolve(staged.app, 'desktop/assets/icon.ico'), artifactName: 'LLM-Canvas-${version}-${arch}-Setup.${ext}' },
    nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false },
    mac: { icon: path.resolve(staged.app, 'desktop/assets/icon.icns'), category: 'public.app-category.developer-tools', identity: null, artifactName: 'LLM-Canvas-${version}-${arch}.${ext}' },
  } })
}
module.exports = { stageDesktop, copyPrismaPackages, packageStaged, resourceMappings, serverInventory, verifyMediaBuild, writeLinuxLauncher, linuxPackageOptions }
if (require.main === module) {
  const [directory, output, mode] = process.argv.slice(2)
  if (!directory || !output) throw new Error('Pass fresh staging and output directories')
  if (mode && !['--dir', '--appimage'].includes(mode)) throw new Error('Supported modes: --dir or --appimage')
  packageDesktop(path.resolve(directory), path.resolve(output), mode === '--dir', mode === '--appimage' ? ['AppImage'] : undefined).then(files => process.stdout.write(JSON.stringify(files) + '\n')).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1 })
}
