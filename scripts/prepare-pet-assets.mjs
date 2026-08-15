// Generate the desktop-pet frame set: per-state PNG frames + a manifest
// consumed by both the renderer (frames.js) and the main process
// (manifest.json — the pet controller schedules only the states that have
// art). Two input modes — see CHARACTER.md for the drop-in art contract:
//
// 1. Drop-in art (assets/pet-source/): one folder per animation, containing
//    either transparent PNGs (consistent canvas per state, feet aligned to the
//    bottom edge) or animated GIFs (EmoteLab exports a vertical strip of
//    uniform frames — sliced with omggif; fps derives from the GIF's frame
//    delays). Several folders can map to ONE canonical state (a "variant
//    pool": the renderer picks a random variant every time the state starts,
//    e.g. several idle dances) — the mapping lives in config.json's `roles`.
//    The whole canvas is scaled by height — frames are NEVER trimmed, so
//    frame-to-frame alignment only holds if each animation's canvases match
//    (the script warns otherwise).
// 2. Fallback: when no source frames exist, the parameterised SVG whale below
//    is generated so the repo always builds and the pet always renders.
//
// Canonical states (the renderer/main contract): idle, walk, eat, sleep,
// working, ciallo. `walk` is special: folders walk-left/ + walk-right/ hold
// explicit left/right-facing frames (no CSS mirror); a single walk/ folder
// reuses its frames for both directions via the CSS mirror. A canonical state
// with no folders is simply omitted from the manifest and the main process
// stops scheduling it — art can grow or shrink without code changes. `idle`
// is the only required state (everything falls back to it). Validation runs
// BEFORE any output is cleaned or written, so a partial drop never wipes the
// committed whale frames; whale frames are never mixed with user art.
import sharp from 'sharp'
import omggif from 'omggif'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const petDir = join(root, 'assets', 'pet')
const sourceDir = join(root, 'assets', 'pet-source')
const configPath = join(sourceDir, 'config.json')

const CANONICAL_STATES = ['ciallo', 'idle', 'walk', 'eat', 'sleep', 'working']
const DEFAULT_ROLES = {
  ciallo: ['ciallo'],
  idle: ['idle'],
  walk: ['walk'],
  eat: ['eat'],
  sleep: ['sleep'],
  working: ['working'],
}
const DEFAULT_CONFIG = {
  frameHeight: 128,
  renderScale: 2,
  fps: { idle: 2, walk: 6, eat: 4, sleep: 1, working: 4 },
}

/**
 * The whale mascot as a parameterised SVG. Each frame tweaks a couple of knobs
 * (vertical bob, tilt, eye open/closed, mouth open/closed) to build the motion
 * the renderer then cycles through.
 */
function whale({ dy = 0, rot = 0, eyeOpen = true, mouthOpen = false }) {
  const eye = eyeOpen
    ? '<circle cx="90" cy="55" r="5.5" fill="#0f172a"/><circle cx="91.6" cy="53.4" r="1.7" fill="#ffffff"/>'
    : '<path d="M84 55 Q90 51 96 55" stroke="#0f172a" stroke-width="2.5" fill="none" stroke-linecap="round"/>'
  const mouth = mouthOpen
    ? '<path d="M84 70 Q92 83 100 70 Z" fill="#0f766e"/>'
    : '<path d="M85 72 Q91 77 97 70" stroke="#0f766e" stroke-width="2.5" fill="none" stroke-linecap="round"/>'
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
    `<g transform="translate(0 ${dy}) rotate(${rot} 74 66)">` +
    '<path d="M30 58 L10 40 Q8 38 12 38 L28 52 Z" fill="#0d9488"/>' +
    '<path d="M30 74 L10 92 Q8 94 12 94 L28 80 Z" fill="#0d9488"/>' +
    '<ellipse cx="74" cy="66" rx="44" ry="31" fill="#14b8a6"/>' +
    '<path d="M42 78 Q74 100 108 76 Q108 86 74 94 Q42 86 42 78 Z" fill="#ccfbf1"/>' +
    '<path d="M66 84 Q63 96 73 100 Q82 92 79 84 Z" fill="#0d9488"/>' +
    eye +
    mouth +
    '<path d="M72 35 Q70 24 63 18" stroke="#2dd4bf" stroke-width="2.8" fill="none" stroke-linecap="round"/>' +
    '<path d="M77 35 Q79 22 86 16" stroke="#2dd4bf" stroke-width="2.8" fill="none" stroke-linecap="round"/>' +
    '<path d="M82 35 Q87 25 96 21" stroke="#2dd4bf" stroke-width="2.8" fill="none" stroke-linecap="round"/>' +
    '</g></svg>'
  )
}

// One entry per frame. Names are the renderer's contract (see manifest below).
const WHALE_FRAMES = [
  { file: 'idle-0.png', opts: { dy: 0, rot: 0 } },
  { file: 'idle-1.png', opts: { dy: -4, rot: 0 } },
  { file: 'walk-0.png', opts: { dy: 0, rot: -6 } },
  { file: 'walk-1.png', opts: { dy: -3, rot: -3 } },
  { file: 'walk-2.png', opts: { dy: 0, rot: 3 } },
  { file: 'walk-3.png', opts: { dy: -3, rot: 6 } },
  { file: 'eat-0.png', opts: { dy: 0, rot: 0 } },
  { file: 'eat-1.png', opts: { dy: -2, rot: -4, mouthOpen: true } },
  { file: 'sleep-0.png', opts: { dy: 0, eyeOpen: false } },
  { file: 'sleep-1.png', opts: { dy: 2, eyeOpen: false } },
  // The fallback has no art for the working state; reuse the idle pair so the
  // new state is visible even with the placeholder.
  { file: 'working-0.png', opts: { dy: 0, rot: 0 } },
  { file: 'working-1.png', opts: { dy: -4, rot: 0 } },
]

/** Sorted PNG frame names + every GIF inside an animation folder. */
async function listSources(folder) {
  const dir = join(sourceDir, folder)
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return { pngs: [], gifs: [] } // folder missing -> no frames
  }
  const pngs = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.png'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  const gifs = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.gif'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  if (pngs.length > 0 && gifs.length > 0) {
    console.warn(`[pet:prepare] ${folder}/ has both PNGs and GIFs — PNG frames win, the GIFs are ignored`)
    return { pngs, gifs: [] }
  }
  return { pngs, gifs }
}

/** Decode an animated GIF into RGBA frames + per-frame delays (centiseconds). */
function decodeGif(buffer) {
  const reader = new omggif.GifReader(buffer)
  const frames = []
  const delays = []
  for (let i = 0; i < reader.numFrames(); i++) {
    const pixels = Buffer.alloc(reader.width * reader.height * 4)
    reader.decodeAndBlitFrameRGBA(i, pixels)
    frames.push(pixels)
    delays.push(reader.frameInfo(i).delay || 0)
  }
  return { frames, width: reader.width, height: reader.height, delays }
}

/** fps from the GIF's own frame delays (delay unit is centiseconds). */
function fpsFromDelays(delays) {
  const positive = delays.filter((d) => d > 0)
  if (positive.length === 0) return 10
  const avg = positive.reduce((a, b) => a + b, 0) / positive.length
  return Math.round(10000 / avg) / 100
}

async function loadConfig() {
  let raw
  try {
    raw = JSON.parse(await readFile(configPath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    console.error(`[pet:prepare] ${configPath} is not valid JSON: ${error.message}`)
    process.exit(1)
  }
  return raw
}

/**
 * Canonical state -> list of animation folders. From config.json's `roles`
 * (validated; unknown canonical keys fail loudly), or the legacy default
 * mapping when config.json has no roles.
 */
function resolveRoles(config, folders) {
  const raw = config.roles ?? DEFAULT_ROLES
  const roles = {}
  for (const [state, value] of Object.entries(raw)) {
    if (!CANONICAL_STATES.includes(state)) {
      console.error(`[pet:prepare] config.json roles has unknown state "${state}" (canonical: ${CANONICAL_STATES.join(', ')})`)
      process.exit(1)
    }
    const list = Array.isArray(value) ? value : [value]
    if (list.some((name) => typeof name !== 'string')) {
      console.error(`[pet:prepare] config.json roles.${state} must be a folder name or a list of folder names`)
      process.exit(1)
    }
    roles[state] = list
  }

  // Unmatched folders are almost always a typo in config.json — fail loudly
  // instead of silently dropping the artist's work.
  const used = new Set(Object.values(roles).flat())
  const unmatched = folders.filter((folder) => !used.has(folder))
  if (unmatched.length > 0) {
    console.error(
      `[pet:prepare] folders not assigned to any role in config.json: ${unmatched.join(', ')}.\n` +
        'Add them to config.json roles (or delete them) so their art is not silently dropped.',
    )
    process.exit(1)
  }
  return roles
}

/** Walk is special: explicit pair vs shared folder + CSS mirror. */
function resolveWalk(roles, byFolder) {
  const walkFolders = roles.walk ?? []
  const hasLeft = walkFolders.includes('walk-left') && hasFrames(byFolder['walk-left'])
  const hasRight = walkFolders.includes('walk-right') && hasFrames(byFolder['walk-right'])
  if (hasLeft && hasRight) return { mirrorWalkLeft: false, walkStates: ['walk-left', 'walk-right'] }
  if (hasLeft || hasRight) {
    console.warn('[pet:prepare] walk role needs BOTH walk-left/ and walk-right/ — walking disabled')
    return { mirrorWalkLeft: true, walkStates: [] }
  }
  if (walkFolders.includes('walk') && hasFrames(byFolder.walk)) return { mirrorWalkLeft: true, walkStates: ['walk'] }
  if (walkFolders.length > 0) console.warn('[pet:prepare] walk role has no frames — walking disabled')
  return { mirrorWalkLeft: true, walkStates: [] }
}

function hasFrames(source) {
  return source !== null && (source.pngs.length > 0 || source.gifs.length > 0)
}

async function checkPngCanvasConsistency(states) {
  for (const [state, source] of Object.entries(states)) {
    if (source.pngs.length < 2) continue
    const first = join(sourceDir, state, source.pngs[0])
    const base = await sharp(first).metadata()
    for (const file of source.pngs.slice(1)) {
      const meta = await sharp(join(sourceDir, state, file)).metadata()
      if (meta.width !== base.width || meta.height !== base.height) {
        console.warn(
          `[pet:prepare] frames in ${state}/ have inconsistent canvas sizes ` +
            `(${base.width}x${base.height} vs ${meta.width}x${meta.height}) — ` +
            'frame alignment within the state will drift. Use one canvas size per state.',
        )
        break
      }
    }
  }
}

async function writeUserArt(config, byFolder, folders) {
  const roles = resolveRoles(config, folders)
  const { mirrorWalkLeft, walkStates } = resolveWalk(roles, byFolder)

  // Which folders feed which canonical state (walk handled above).
  const assignments = []
  for (const state of CANONICAL_STATES) {
    if (state === 'walk') continue
    for (const folder of roles[state] ?? []) {
      if (hasFrames(byFolder[folder])) assignments.push({ state, folder, source: byFolder[folder] })
      else console.warn(`[pet:prepare] ${folder}/ has no frames — ignored for state ${state}`)
    }
  }
  for (const state of walkStates) assignments.push({ state, folder: state, source: byFolder[state] })

  if (!assignments.some((a) => a.state === 'idle')) {
    console.error('[pet:prepare] the idle state has no art — idle is required (every state falls back to it).')
    process.exit(1)
  }
  const stateNames = [...new Set(assignments.map((a) => a.state))]

  // Pre-decode all GIF sources once; each GIF becomes one variant.
  const gifCache = new Map()
  for (const { folder, source } of assignments) {
    for (const file of source.gifs) {
      const path = join(sourceDir, folder, file)
      gifCache.set(path, decodeGif(await readFile(path)))
    }
  }
  await checkPngCanvasConsistency(Object.fromEntries(assignments.map((a) => [a.folder, a.source])))

  const frameHeight = config.frameHeight ?? DEFAULT_CONFIG.frameHeight
  // The render scale is capped by the smallest source frame so the pipeline
  // never upscales art the artist drew too small.
  const sourceHeights = []
  for (const { folder, source } of assignments) {
    if (source.gifs.length > 0) for (const f of source.gifs) sourceHeights.push(gifCache.get(join(sourceDir, folder, f)).height)
    else for (const f of source.pngs) sourceHeights.push((await sharp(join(sourceDir, folder, f)).metadata()).height)
  }
  const smallest = Math.min(...sourceHeights)
  const renderScale = Math.max(
    1,
    Math.min(config.renderScale ?? DEFAULT_CONFIG.renderScale, Math.floor(smallest / frameHeight)),
  )
  if (smallest < frameHeight) {
    console.warn(`[pet:prepare] source art is smaller than frameHeight ${frameHeight} — it will be upscaled`)
  }

  const manifest = { frameSize: frameHeight, renderScale, mirrorWalkLeft, states: {} }
  const targetHeight = frameHeight * renderScale
  // Frame names carry a per-state variant index — a folder may hold several
  // GIFs (or two folders may share a name pattern), so <state>-<folder>-<i>
  // alone would collide.
  const variantCounts = new Map()
  let wrote = 0

  await cleanOutput()
  for (const { state, folder, source } of assignments) {
    const variants = []
    if (source.gifs.length > 0) {
      for (const file of source.gifs) {
        const { frames: rawFrames, width, height, delays } = gifCache.get(join(sourceDir, folder, file))
        const fps = config.fps?.[state] ?? fpsFromDelays(delays)
        const vIdx = variantCounts.get(state) ?? 0
        variantCounts.set(state, vIdx + 1)
        const frames = []
        for (let i = 0; i < rawFrames.length; i++) {
          const name = `${state}-${folder}-${vIdx}-${i}.png`
          await sharp(rawFrames[i], { raw: { width, height, channels: 4 } })
            .ensureAlpha()
            .resize({ height: targetHeight, kernel: 'lanczos3' })
            .png()
            .toFile(join(petDir, name))
          frames.push(name)
          wrote++
        }
        variants.push({ fps, frames })
      }
    } else {
      const fps = config.fps?.[state] ?? DEFAULT_CONFIG.fps[state] ?? 2
      const vIdx = variantCounts.get(state) ?? 0
      variantCounts.set(state, vIdx + 1)
      const frames = []
      for (let i = 0; i < source.pngs.length; i++) {
        const name = `${state}-${folder}-${vIdx}-${i}.png`
        await sharp(join(sourceDir, folder, source.pngs[i]))
          .ensureAlpha()
          .resize({ height: targetHeight, kernel: 'lanczos3' })
          .png()
          .toFile(join(petDir, name))
        frames.push(name)
        wrote++
      }
      variants.push({ fps, frames })
    }
    manifest.states[state] = manifest.states[state] ?? { variants: [] }
    manifest.states[state].variants.push(...variants)
  }
  await writeManifest(manifest)
  console.log(
    `[pet:prepare] wrote ${wrote} frames for ${stateNames.join(', ')} (frameHeight ${frameHeight}, renderScale ${renderScale}, mirror ${mirrorWalkLeft})`,
  )
}

async function writeWhaleFallback() {
  const manifest = {
    frameSize: 128,
    mirrorWalkLeft: true,
    states: {
      idle: { variants: [{ fps: 2, frames: ['idle-0.png', 'idle-1.png'] }] },
      walk: { variants: [{ fps: 6, frames: ['walk-0.png', 'walk-1.png', 'walk-2.png', 'walk-3.png'] }] },
      eat: { variants: [{ fps: 4, frames: ['eat-0.png', 'eat-1.png'] }] },
      sleep: { variants: [{ fps: 1, frames: ['sleep-0.png', 'sleep-1.png'] }] },
      working: { variants: [{ fps: 4, frames: ['working-0.png', 'working-1.png'] }] },
    },
  }
  await cleanOutput()
  for (const { file, opts } of WHALE_FRAMES) {
    await sharp(Buffer.from(whale(opts))).resize(128, 128).png().toFile(join(petDir, file))
  }
  await writeManifest(manifest)
  console.log(`[pet:prepare] no pet-source/ frames found — wrote ${WHALE_FRAMES.length} placeholder whale frames + manifest`)
}

/** frames.js for the renderer + manifest.json for the main process. */
async function writeManifest(manifest) {
  const json = JSON.stringify(manifest, null, 2)
  await writeFile(join(petDir, 'frames.js'), `window.__PET_FRAMES = ${json};\n`)
  await writeFile(join(petDir, 'manifest.json'), `${json}\n`)
}

async function cleanOutput() {
  // Generated artifacts only: stale frames from a previous run must not linger.
  // Called strictly AFTER validation so a partial drop never wipes committed art.
  await rm(petDir, { recursive: true, force: true })
  await mkdir(petDir, { recursive: true })
}

const config = await loadConfig()
const fpsConfig = config.fps ?? {}
for (const key of Object.keys(fpsConfig)) {
  if (!(key in DEFAULT_CONFIG.fps)) console.warn(`[pet:prepare] unknown fps key in config.json: ${key}`)
}

const byFolder = {}
let folders = []
try {
  folders = (await readdir(sourceDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && e.name !== 'config.json')
    .map((e) => e.name)
} catch {
  folders = []
}
for (const folder of folders) byFolder[folder] = await listSources(folder)
const hasAnySourceFrames = Object.values(byFolder).some((source) => hasFrames(source))

if (hasAnySourceFrames) {
  await writeUserArt(config, byFolder, folders)
} else {
  if (folders.length > 0) {
    console.warn('[pet:prepare] pet-source/ has folders but none contain PNG/GIF frames — using the whale fallback')
  }
  await writeWhaleFallback()
}
