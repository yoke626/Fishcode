// Download the official standalone Node.js runtime for the current
// platform/arch, verify its SHA-256 against SHASUMS256.txt, and extract the
// node binary into node-runtime/ so the packaged app can spawn the dsh backend
// without a system Node. Version is pinned to the same major as dev so the
// dsh-bundle native deps' ABI matches.
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rm, rename, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const execFileAsync = promisify(execFile)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const VERSION = process.env.FISHCODE_NODE_VERSION ?? 'v24.19.0'
const BASE_URL = `https://nodejs.org/dist/${VERSION}`
const MAX_RETRIES = 3

function target() {
  const platform = process.platform
  const arch = process.arch
  if (platform === 'win32') {
    return {
      fileName: `node-${VERSION}-win-${arch}.zip`,
      innerDir: `node-${VERSION}-win-${arch}`,
      binRel: 'node.exe',
    }
  }
  if (platform === 'darwin') {
    return {
      fileName: `node-${VERSION}-darwin-${arch}.tar.gz`,
      innerDir: `node-${VERSION}-darwin-${arch}`,
      binRel: 'bin/node',
    }
  }
  if (platform === 'linux') {
    return {
      fileName: `node-${VERSION}-linux-${arch}.tar.xz`,
      innerDir: `node-${VERSION}-linux-${arch}`,
      binRel: 'bin/node',
    }
  }
  throw new Error(`unsupported platform: ${platform}`)
}

async function download(url, dest) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
      return
    } catch (error) {
      if (attempt === MAX_RETRIES) throw error
      console.warn(`[fetch-runtime] retry ${attempt} for ${url}: ${error.message}`)
    }
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function extract(archivePath, extractDir) {
  if (process.platform === 'win32') {
    // The .zip archive cannot be opened by GNU tar, which Git for Windows puts
    // on PATH ahead of the system bsdtar (that mix-up is what used to fail
    // this step on the windows runner). PowerShell's Expand-Archive always
    // resolves to a zip-capable extractor, so use it directly instead.
    const ps = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`
    await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps])
    return
  }
  await execFileAsync('tar', ['-xf', archivePath, '-C', extractDir])
}

const t = target()
const workDir = join(tmpdir(), 'fishcode-runtime')
await mkdir(workDir, { recursive: true })

const archivePath = join(workDir, t.fileName)
console.log(`[fetch-runtime] downloading ${BASE_URL}/${t.fileName}`)
await download(`${BASE_URL}/${t.fileName}`, archivePath)

console.log(`[fetch-runtime] verifying sha256`)
const sumsText = await download(`${BASE_URL}/SHASUMS256.txt`, join(workDir, 'SHASUMS256.txt')).then(() =>
  readFile(join(workDir, 'SHASUMS256.txt'), 'utf8'),
)
const expected = sumsText
  .split('\n')
  .map((line) => line.trim().split(/\s+/))
  .find((parts) => parts.length === 2 && parts[1] === t.fileName)?.[0]
if (!expected) throw new Error(`no SHASUMS256 entry for ${t.fileName}`)
const actual = sha256(await readFile(archivePath))
if (actual !== expected) {
  throw new Error(`sha256 mismatch for ${t.fileName}: expected ${expected}, got ${actual}`)
}
console.log(`[fetch-runtime] sha256 ok`)

console.log(`[fetch-runtime] extracting ${t.fileName}`)
const extractDir = join(workDir, 'extract')
await rm(extractDir, { recursive: true, force: true })
await mkdir(extractDir, { recursive: true })
try {
  await extract(archivePath, extractDir)
} catch (error) {
  console.error(`[fetch-runtime] extraction failed: ${error.message}`)
  throw error
}

const outDir = join(root, 'node-runtime')
await mkdir(outDir, { recursive: true })
const outBin = join(outDir, t.binRel.split('/').pop())
await rename(join(extractDir, t.innerDir, t.binRel), outBin)
await rm(archivePath, { force: true })
console.log(`[fetch-runtime] wrote ${outBin}`)
