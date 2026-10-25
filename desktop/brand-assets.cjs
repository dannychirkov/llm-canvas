// Regenerate with: node desktop/brand-assets.cjs [output-root]
// The original favicon is the artwork source. Larger sizes are bitmap resizes,
// not redrawn artwork. Sharp is already provided by Next.js.
const fs = require('node:fs/promises')
const path = require('node:path')
const sharp = require('sharp')

const root = path.resolve(__dirname, '..')

function decodeLargestFrame(ico) {
  if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new Error('Expected an ICO artwork source')
  const frames = Array.from({ length: ico.readUInt16LE(4) }, (_, index) => {
    const offset = 6 + index * 16
    return { width: ico[offset] || 256, height: ico[offset + 1] || 256, start: ico.readUInt32LE(offset + 12), length: ico.readUInt32LE(offset + 8) }
  })
  const frame = frames.reduce((largest, current) => current.width > largest.width ? current : largest)
  const dib = ico.subarray(frame.start, frame.start + frame.length)
  const { width, height } = frame
  // The canonical favicon contains uncompressed 32-bit, bottom-up DIB frames.
  if (dib.readUInt32LE(0) !== 40 || dib.readInt32LE(4) !== width || dib.readInt32LE(8) !== height * 2 || dib.readUInt16LE(12) !== 1 || dib.readUInt16LE(14) !== 32 || dib.readUInt32LE(16) !== 0) throw new Error('Unsupported favicon DIB format')
  const maskStride = Math.ceil(width / 32) * 4
  const maskStart = 40 + width * height * 4
  if (dib.length !== maskStart + maskStride * height) throw new Error('Invalid favicon DIB length')
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = 40 + ((height - 1 - y) * width + x) * 4
      const target = (y * width + x) * 4
      rgba[target] = dib[source + 2]
      rgba[target + 1] = dib[source + 1]
      rgba[target + 2] = dib[source]
      const masked = dib[maskStart + (height - 1 - y) * maskStride + (x >> 3)] & (0x80 >> (x % 8))
      rgba[target + 3] = masked ? 0 : dib[source + 3]
    }
  }
  return { rgba, width, height }
}

function appendPngFrame(original, png) {
  const count = original.readUInt16LE(4)
  const header = Buffer.from(original.subarray(0, 6))
  header.writeUInt16LE(count + 1, 4)
  const entries = Buffer.from(original.subarray(6, 6 + count * 16))
  for (let index = 0; index < count; index++) entries.writeUInt32LE(entries.readUInt32LE(index * 16 + 12) + 16, index * 16 + 12)
  const entry = Buffer.alloc(16)
  // Zero width/height in an ICO directory denotes 256 pixels.
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(original.length + 16, 12)
  return Buffer.concat([header, entries, entry, original.subarray(6 + count * 16), png])
}

async function generateBrandAssets(outputRoot = root) {
  const original = await fs.readFile(path.join(root, 'src/app/favicon.ico'))
  const { rgba, width, height } = decodeLargestFrame(original)
  const pngs = new Map()
  for (const size of [128, 180, 256, 512, 1024]) {
    pngs.set(size, await sharp(rgba, { raw: { width, height, channels: 4 } }).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer())
  }
  const chunks = [[128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']].map(([size, type]) => {
    const png = pngs.get(size)
    const header = Buffer.alloc(8)
    header.write(type, 0, 4, 'ascii')
    header.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([header, png])
  })
  const icnsHeader = Buffer.alloc(8)
  icnsHeader.write('icns')
  icnsHeader.writeUInt32BE(8 + chunks.reduce((size, chunk) => size + chunk.length, 0), 4)
  const assets = {
    'public/brand/icon.png': pngs.get(512),
    'public/brand/apple-touch-icon.png': pngs.get(180),
    'desktop/assets/icon.png': pngs.get(512),
    'desktop/assets/icon.ico': appendPngFrame(original, pngs.get(256)),
    'desktop/assets/icon.icns': Buffer.concat([icnsHeader, ...chunks]),
  }
  for (const [name, content] of Object.entries(assets)) {
    const filename = path.join(outputRoot, name)
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await fs.writeFile(filename, content)
  }
}

module.exports = { generateBrandAssets }
if (require.main === module) {
  generateBrandAssets(process.argv[2] ? path.resolve(process.argv[2]) : root).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1 })
}
