const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { getFileMatchers, copyFiles } = require('app-builder-lib/out/fileMatcher')
const { resourceMappings, serverInventory, copyPrismaPackages, writeLinuxLauncher, linuxPackageOptions } = require('../desktop/package.cjs')

test('actual installer resource copier preserves root native dependencies and hidden Prisma client', async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'desktop-package-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const stage = path.join(root, 'stage'), server = path.join(stage, 'server'), resources = path.join(root, 'resources')
  for (const name of ['node_modules/.prisma/client/engine.node', 'node_modules/@prisma/client/index.js', 'node_modules/jsdom/index.js', 'prisma-cli/node_modules/prisma/build/index.js', '.next/server/app/page.js', 'public/logo.svg']) {
    const filename = path.join(server, name)
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await fs.writeFile(filename, 'fixture:' + name)
  }
  await fs.mkdir(path.join(stage, 'app'))
  await fs.writeFile(path.join(stage, 'app', 'not-a-server-file'), 'exclude')
  const expected = serverInventory(server)
  const matchers = getFileMatchers({ extraResources: resourceMappings(server) }, 'extraResources', resources, { defaultSrc: stage, globalOutDir: resources, macroExpander: value => value, customBuildOptions: {} })
  await copyFiles(matchers)
  assert.deepEqual(serverInventory(path.join(resources, 'server')), expected)
  await assert.rejects(fs.access(path.join(resources, 'app')))
})

test('bundled CLI loads distinct dependency versions after relocation without any stage links', async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'desktop-cli-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  const definitions = [
    ['prisma', { name: 'prisma', version: '1.0.0', dependencies: { left: '*', right: '*' } }, 'module.exports=[require("left"),require("right")]'],
    ['left', { name: 'left', version: '1.0.0', dependencies: { shared: '*' } }, 'module.exports=require("shared")'],
    ['right', { name: 'right', version: '1.0.0', dependencies: { shared: '*' } }, 'module.exports=require("shared")'],
    ['shared', { name: 'shared', version: '1.0.0' }, 'module.exports="one"'],
    ['right/node_modules/shared', { name: 'shared', version: '2.0.0' }, 'module.exports="two"'],
  ]
  for (const [relative, pkg, code] of definitions) {
    const directory = path.join(source, 'node_modules', relative)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify(pkg))
    await fs.writeFile(path.join(directory, 'index.js'), code)
  }
  const staged = path.join(root, 'staged')
  copyPrismaPackages(source, staged)
  const installed = path.join(root, 'installed')
  await fs.rename(staged, installed)
  await fs.rm(source, { recursive: true })
  assert.deepEqual(require(path.join(installed, 'prisma-cli/node_modules/prisma')), ['one', 'two'])
  assert.equal(Object.values(serverInventory(installed)).some(value => value.startsWith('link:')), false)
})

test('Linux launcher preserves paths and arguments without silently disabling sandboxing or adding loader paths', { skip: process.platform !== 'linux' }, async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'desktop-launcher-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const directory = path.join(root, 'application with spaces')
  await fs.mkdir(directory)
  await fs.writeFile(path.join(directory, 'llm-canvas'), '#!/bin/sh\nprintf "%s\\n" "$@"\nprintf "loader:%s\\n" "${LD_LIBRARY_PATH-unset}"\n', { mode: 0o755 })
  writeLinuxLauncher(directory)
  const { execFileSync } = require('node:child_process')
  const env = { ...process.env }
  delete env.LD_LIBRARY_PATH
  const output = execFileSync(path.join(directory, 'AppRun'), ['--test=value with spaces'], { cwd: root, env, encoding: 'utf8' })
  assert.equal(output, '--test=value with spaces\nloader:unset\n')
})

test('actual AppImage desktop entry omits the packager default --no-sandbox argument', async () => {
  const AppImageTarget = require('app-builder-lib/out/targets/appimage/AppImageTarget').default
  const packager = { platformSpecificBuildOptions: linuxPackageOptions(), config: {}, appInfo: { buildVersion: 'test' } }
  const target = new AppImageTarget('AppImage', packager, { computeDesktopEntry(_options, exec) { return exec } }, os.tmpdir())
  assert.equal(await target.desktopEntry.value, 'AppRun %U')
})
