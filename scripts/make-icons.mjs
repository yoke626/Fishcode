// Generate the application icons: assets/icon.png + tray.png, build/icon.png,
// and a multi-size build/icon.ico (Windows). The ICO packs PNG frames directly
// (the Vista+ format), so no extra encoder is needed.
//
// Two input modes (see CHARACTER.md):
// 1. Drop-in art: assets/icon-source.png (square, character on a transparent
//    background) is auto-trimmed, placed on the teal rounded-rect app tile, and
//    also rendered character-only into the 32px tray icon.
// 2. Fallback: without icon-source.png the parameterised "whale" SVG below is
//    used — an original re-interpretation (DeepSeek's mascot is a whale) in
//    FISHCODE's teal palette. This file is the single replacement point for
//    app icons.
import sharp from 'sharp'
import { mkdir, writeFile, access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const whale =
  '<path d="M30 58 L10 40 Q8 38 12 38 L28 52 Z" fill="#0d9488"/>' +
  '<path d="M30 74 L10 92 Q8 94 12 94 L28 80 Z" fill="#0d9488"/>' +
  '<ellipse cx="74" cy="66" rx="44" ry="31" fill="#14b8a6"/>' +
  '<path d="M42 78 Q74 100 108 76 Q108 86 74 94 Q42 86 42 78 Z" fill="#ccfbf1"/>' +
  '<path d="M66 84 Q63 96 73 100 Q82 92 79 84 Z" fill="#0d9488"/>' +
  '<circle cx="90" cy="55" r="5.5" fill="#0f172a"/>' +
  '<circle cx="91.6" cy="53.4" r="1.7" fill="#ffffff"/>' +
  '<path d="M85 72 Q91 77 97 70" stroke="#0f766e" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
  '<path d="M72 35 Q70 24 63 18" stroke="#2dd4bf" stroke-width="2.8" fill="none" stroke-linecap="round"/>' +
  '<path d="M77 35 Q79 22 86 16" stroke="#2dd4bf" stroke-width="2.8" fill="none" stroke-linecap="round"/>' +
  '<path d="M82 35 Q87 25 96 21" stroke="#2dd4bf" stroke-width="2.8" fill="none" stroke-linecap="round"/>'

const appSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">' +
  '<rect width="256" height="256" rx="56" fill="#ccfbf1"/>' +
  '<g transform="translate(32,32) scale(1.5)">' + whale + '</g>' +
  '</svg>'

function png(svg, size) {
  return sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()
}

/** Pack PNG frames into a single .ico (header + directory + PNG blobs). */
function buildIco(frames) {
  const count = frames.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  const directory = Buffer.alloc(count * 16)
  let offset = 6 + directory.length
  const blobs = []
  frames.forEach(({ size, buffer }, i) => {
    const base = i * 16
    // 0 in the width/height byte means 256.
    directory.writeUInt8(size >= 256 ? 0 : size, base)
    directory.writeUInt8(size >= 256 ? 0 : size, base + 1)
    directory.writeUInt8(0, base + 2) // palette
    directory.writeUInt8(0, base + 3) // reserved
    directory.writeUInt16LE(1, base + 4) // color planes
    directory.writeUInt16LE(32, base + 6) // bits per pixel
    directory.writeUInt32LE(buffer.length, base + 8) // bytes in resource
    directory.writeUInt32LE(offset, base + 12) // offset to PNG data
    offset += buffer.length
    blobs.push(buffer)
  })
  return Buffer.concat([header, directory, ...blobs])
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const sourcePath = join(root, 'assets', 'icon-source.png')
const hasSource = await exists(sourcePath)

await mkdir(join(root, 'build'), { recursive: true })
await mkdir(join(root, 'assets'), { recursive: true })

if (hasSource) {
  // The character fills ~76% of the 512 tile's height (bottom margin ~8%),
  // horizontally centered, on the same teal rounded-rect as the fallback.
  const trimmed = await sharp(sourcePath).ensureAlpha().trim()
  const { width: w, height: h } = await trimmed.metadata()
  if (!w || !h) {
    console.warn('[make-icons] assets/icon-source.png is fully transparent — using the whale fallback')
    await writeWhaleIcons()
  } else {
    const maxArt = Math.round(512 * 0.76)
    const scale = Math.min(maxArt / h, maxArt / w)
    const charW = Math.max(1, Math.round(w * scale))
    const charH = Math.max(1, Math.round(h * scale))
    const charBuf = await trimmed.resize({ width: charW, height: charH }).png().toBuffer()

    const bgSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
      '<rect width="512" height="512" rx="112" fill="#ccfbf1"/>' +
      '</svg>'
    const appIcon512 = await sharp(Buffer.from(bgSvg))
      .composite([{ input: charBuf, left: Math.round((512 - charW) / 2), top: 512 - Math.round(512 * 0.08) - charH }])
      .png()
      .toBuffer()

    const frames = []
    for (const size of icoSizes) {
      frames.push({ size, buffer: await sharp(appIcon512).resize(size, size).png().toBuffer() })
    }
    await writeFile(join(root, 'build', 'icon.ico'), buildIco(frames))
    await writeFile(join(root, 'build', 'icon.png'), appIcon512)
    await writeFile(join(root, 'assets', 'icon.png'), await sharp(appIcon512).resize(256, 256).png().toBuffer())

    // Tray: the character alone (~28px art) centered on a transparent 32x32.
    const trayScale = Math.min(28 / h, 28 / w)
    const trayChar = await trimmed
      .resize({ width: Math.max(1, Math.round(w * trayScale)), height: Math.max(1, Math.round(h * trayScale)) })
      .png()
      .toBuffer()
    const trayMeta = await sharp(trayChar).metadata()
    const trayBuf = await sharp({
      create: { width: 32, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: trayChar,
          left: Math.round((32 - trayMeta.width) / 2),
          top: Math.round((32 - trayMeta.height) / 2),
        },
      ])
      .png()
      .toBuffer()
    await writeFile(join(root, 'assets', 'tray.png'), trayBuf)
    console.log('[make-icons] wrote build/icon.ico, build/icon.png, assets/icon.png, assets/tray.png (from assets/icon-source.png)')
  }
} else {
  console.log('[make-icons] no assets/icon-source.png — using the placeholder whale')
  await writeWhaleIcons()
}

async function writeWhaleIcons() {
  const frames = []
  for (const size of icoSizes) {
    frames.push({ size, buffer: await png(appSvg, size) })
  }
  await writeFile(join(root, 'build', 'icon.ico'), buildIco(frames))
  await writeFile(join(root, 'build', 'icon.png'), await png(appSvg, 512))
  await writeFile(join(root, 'assets', 'icon.png'), await png(appSvg, 256))
  await writeFile(join(root, 'assets', 'tray.png'), await png(appSvg, 16))
  console.log('[make-icons] wrote build/icon.ico, build/icon.png, assets/icon.png, assets/tray.png (whale)')
}

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}
