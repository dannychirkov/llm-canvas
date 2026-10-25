const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')

const validationFiles = new Set(['.github/workflows/desktop.yml', 'desktop/acceptance.cjs', 'desktop/smoke.cjs', 'desktop/wire-smoke.cjs', 'desktop/reuse.cjs', 'README.md', 'CHANGELOG.md', 'docs/DESKTOP.md'])
const guarded = filename => !validationFiles.has(filename) && !filename.startsWith('tests/')
function reuseRun(message) {
  const match = String(message || '').match(/(?:^|\s)\[reuse:(\d{1,16})\](?=\s|$)/)
  if (!match && String(message || '').includes('[reuse:')) throw new Error('Invalid native artifact reuse request')
  return match?.[1] || ''
}
function equivalentInputs(current, original) {
  const select = tree => Object.fromEntries(Object.entries(tree).filter(([name]) => guarded(name)).sort(([a], [b]) => a.localeCompare(b)))
  assert.deepEqual(select(current), select(original), 'Application or packaging inputs changed; rebuild native artifacts')
}
async function request() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const id = reuseRun(event.head_commit?.message)
  let revision = process.env.GITHUB_SHA
  if (id) {
    const repository = process.env.GITHUB_REPOSITORY
    assert.match(repository, /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)
    assert.ok(process.env.GITHUB_TOKEN)
    async function api(suffix) {
      const response = await fetch(`https://api.github.com/repos/${repository}/${suffix}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(30000) })
      assert.equal(response.status, 200, 'Unable to verify original native run')
      return response.json()
    }
    const originalRun = await api('actions/runs/' + id)
    assert.equal(originalRun.event, 'push')
    assert.equal(originalRun.head_repository?.full_name, repository)
    assert.equal(originalRun.head_branch, 'feat/desktop-release-validation-rc4')
    assert.equal(originalRun.name, 'Native desktop acceptance')
    assert.match(originalRun.head_sha, /^[a-f0-9]{40}$/)
    revision = originalRun.head_sha
    const tree = await api(`git/trees/${revision}?recursive=1`)
    assert.equal(tree.truncated, false, 'Original source tree is incomplete')
    const original = Object.fromEntries(tree.tree.filter(entry => entry.type === 'blob').map(entry => [entry.path, entry.mode + ':' + entry.sha]))
    const entries = execFileSync('git', ['ls-tree', '-r', '-z', 'HEAD'], { encoding: 'utf8' }).split('\0').filter(Boolean)
    const current = Object.fromEntries(entries.map(entry => {
      const match = /^(\d+) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(entry)
      assert.ok(match, 'Unsupported current source entry')
      return [match[3], match[1] + ':' + match[2]]
    }))
    equivalentInputs(current, original)
  }
  assert.match(revision, /^[a-f0-9]{40}$/)
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `reuse_run=${id}\nsource_revision=${revision}\n`)
  fs.appendFileSync(process.env.GITHUB_ENV, `DESKTOP_SOURCE_REVISION=${revision}\nDESKTOP_REUSE_RUN=${id}\n`)
  process.stdout.write(JSON.stringify({ reusedFromRun: id || null, artifactSourceRevision: revision, sourceInputsUnchanged: true }) + '\n')
}
async function verifyDownload() {
  const report = JSON.parse(fs.readFileSync(path.join(process.env.RUNNER_TEMP, 'desktop-original-diagnostics', 'acceptance', 'report.json'), 'utf8'))
  assert.equal(report.platform, process.platform)
  assert.equal(report.architecture, process.arch)
  const name = report.artifact?.name
  assert.ok(typeof name === 'string' && path.basename(name) === name && /^LLM-Canvas-0\.1\.0-rc\.4-[a-zA-Z0-9_-]+\.(?:exe|AppImage)$/.test(name))
  assert.match(report.artifact.sha256, /^[a-f0-9]{64}$/)
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(path.join(process.env.RUNNER_TEMP, 'desktop-dist', name))) hash.update(chunk)
  assert.equal(hash.digest('hex'), report.artifact.sha256, 'Reused installer differs from original acceptance receipt')
  process.stdout.write(JSON.stringify({ originalInstallerChecksumVerified: true, artifact: name, artifactSourceRevision: process.env.DESKTOP_SOURCE_REVISION }) + '\n')
}
module.exports = { reuseRun, equivalentInputs }
if (require.main === module) {
  const action = process.argv[2] === 'verify-download' ? verifyDownload : request
  action().catch(() => { process.stderr.write('Native artifact reuse verification failed; rebuild or inspect the guarded inputs.\n'); process.exitCode = 1 })
}
