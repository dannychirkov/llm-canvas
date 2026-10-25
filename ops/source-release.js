const fs = require("node:fs")
const path = require("node:path")
const { createHash } = require("node:crypto")
const { gzipSync } = require("node:zlib")
const { execFileSync } = require("node:child_process")

const rootFiles = new Set(["package.json", "package-lock.json", "LICENSE", "README.md", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md", ".env.example", "docker.env.example", "Dockerfile", "docker-compose.yml", "docker-entrypoint.sh", ".dockerignore", ".gitignore", ".nvmrc", "next.config.ts", "tsconfig.json", "postcss.config.mjs", "tailwind.config.ts", "eslint.config.mjs"])
const publicDocs = new Set(["docs/PROVIDER_PROTOCOLS.md", "docs/NODE_COMMUNICATION.md", "docs/TOKENS_AND_CACHING.md", "docs/OPERATIONS.md", "docs/DESKTOP.md", "docs/MEDIA-NOTICES.md", "docs/NATIVE-SOURCE-MATERIALS.md", "docs/RELEASE-VERIFICATION.md"])
const genericOps = new Set(["ops/source-release.js", "ops/stage-artifact.js", "ops/link-externals.js", "ops/Dockerfile.artifact", "ops/frontend-smoke.js", "ops/persistent-fingerprint.js", "ops/check-image-layers.py", "ops/build-media.sh", "ops/media-sources.json", "ops/native-source-materials.py", "ops/native-source-pins.json"])

function publishable(filename) {
  if (/(?:^|\/)(?:\.git|\.secrets|node_modules)(?:\/|$)/.test(filename) || /^public\/(?:uploads|canvases)(?:\/|$)/.test(filename) || /(?:\.db(?:-.*)?|\.sqlite.*|\.key|\.pem|\.bak|\.log)$/.test(filename)) return false
  return rootFiles.has(filename) || publicDocs.has(filename) || genericOps.has(filename) || /^(?:src|types|tests|\.github)\//.test(filename) || /^desktop\/[a-zA-Z-]+\.cjs$/.test(filename) || /^prisma\/(?:schema\.prisma|migrations\/)/.test(filename) || /^public\//.test(filename)
}

function sourceRelease(directory, revision = "HEAD", repository = process.cwd()) {
  const git = args => execFileSync("git", args, { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
  const sourceRevision = git(["rev-parse", "--verify", revision + "^{commit}"]).trim()
  const version = JSON.parse(git(["show", sourceRevision + ":package.json"])).version
  if (typeof version !== "string" || !/^[a-zA-Z0-9.+-]+$/.test(version)) throw new Error("Invalid release version")
  const entries = git(["ls-tree", "-r", "-z", sourceRevision]).split("\0").filter(Boolean).map(entry => {
    const match = /^(\d+) blob ([a-f0-9]+)\t(.+)$/.exec(entry)
    if (!match) throw new Error("Unsupported source entry")
    return { mode: match[1], object: match[2], filename: match[3] }
  })
  const selected = entries.filter(entry => publishable(entry.filename))
  const selectedNames = new Set(selected.map(entry => entry.filename))
  if (entries.some(entry => /^(?:src|types)\//.test(entry.filename) && !selectedNames.has(entry.filename))) throw new Error("Publication filter excluded application code")
  for (const entry of selected) {
    if (entry.mode !== "100644" && entry.mode !== "100755") throw new Error("Release source must not contain links")
    const content = execFileSync("git", ["cat-file", "blob", entry.object], { cwd: repository, maxBuffer: 64 * 1024 * 1024 })
    if (!content.includes(0) && /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bghp_[a-zA-Z0-9]{36}\b|\bsk-[a-zA-Z0-9_-]{40,})/.test(content.toString("utf8"))) throw new Error("Potential credential in release source; review before publication")
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const archiveName = `llm-canvas-${version}-source.tar.gz`
  const tar = execFileSync("git", ["--literal-pathspecs", "archive", "--format=tar", `--prefix=llm-canvas-${version}/`, sourceRevision, "--", ...selected.map(entry => entry.filename)], { cwd: repository, maxBuffer: 64 * 1024 * 1024 })
  const members = new Set(execFileSync("tar", ["-tf", "-"], { input: tar, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim().split("\n").filter(name => !name.endsWith("/")))
  if (members.size !== selected.length || selected.some(entry => !members.has(`llm-canvas-${version}/` + entry.filename))) throw new Error("Archive members differ from the verified source manifest")
  const archive = gzipSync(tar)
  fs.writeFileSync(path.join(directory, archiveName), archive, { mode: 0o600, flag: "wx" })
  const manifest = { version, sourceRevision, archive: archiveName, sha256: createHash("sha256").update(archive).digest("hex"), files: selected.length, excludedFiles: entries.length - selected.length, containsGitHistory: false, privateRuntimePathsIncluded: false }
  fs.writeFileSync(path.join(directory, "source-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600, flag: "wx" })
  return manifest
}

module.exports = { sourceRelease, publishable }
if (require.main === module) {
  try {
    if (!process.argv[2]) throw new Error("Pass a fresh output directory")
    process.stdout.write(JSON.stringify(sourceRelease(path.resolve(process.argv[2]), process.argv[3] ?? "HEAD")) + "\n")
  } catch (failure) { process.stderr.write("Source release failed: " + failure.message + "\n"); process.exitCode = 1 }
}
