const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { verifyMediaBuild } = require('../desktop/package.cjs')

test('media staging rejects changed bytes, wrong native targets and missing corresponding source inventory', async t => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'media-inventory-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, 'bin'))
  const files = []
  for (const name of ['bin/ffmpeg', 'bin/ffprobe', 'media-sources.tar.xz']) {
    const contents = Buffer.from('fixture bytes:' + name)
    await fs.writeFile(path.join(root, name), contents)
    files.push({ path: name, sha256: createHash('sha256').update(contents).digest('hex') })
  }
  const manifest = { platform: 'linux', architecture: 'x64', ffmpegVersion: '9.0.2', license: 'LGPL-2.1-or-later', sources: require('../ops/media-sources.json').sources, files, sourceArchive: files[2] }
  const save = value => fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(value))
  await save(manifest)
  assert.equal(verifyMediaBuild(root, 'linux', 'x64').ffmpegVersion, '9.0.2')
  assert.throws(() => verifyMediaBuild(root, 'darwin', 'arm64'), /target platform/)
  await save({ ...manifest, sourceArchive: null })
  assert.throws(() => verifyMediaBuild(root, 'linux', 'x64'), /source distribution/)
  await save({ ...manifest, files: [...files, { path: '../outside', sha256: files[0].sha256 }] })
  assert.throws(() => verifyMediaBuild(root, 'linux', 'x64'), /Invalid media/)
  await save(manifest)
  await fs.appendFile(path.join(root, 'bin/ffprobe'), 'tampered')
  assert.throws(() => verifyMediaBuild(root, 'linux', 'x64'), /file inventory mismatch/)
})
