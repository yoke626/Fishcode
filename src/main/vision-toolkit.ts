/**
 * Registers the bundled `@anionex/dsh-vision-toolkit` profile bundle with the
 * local `dsh web` backend — without pnpm. The bundle gives text-only models
 * (the DeepSeek official API is text-only) a `vision-tools` skill and ten
 * `vision_*` tools that delegate image understanding to a separate vision API
 * or to local Python tooling.
 *
 * Two things must be true before the next `dsh web` spawn so the cordis loader
 * can import the bundle:
 *
 *   1. The bundle and its non-peer dependency closure must resolve from the
 *      profile module fallback `$DSH_HOME/profiles/node_modules`. dsh's own
 *      `healProfilesModuleFallback` junctions the app's closure there; we
 *      junction the bundle + its hoisted deps (`saxes` → `xmlchars`) the same
 *      way, as *foreign* entries dsh leaves untouched.
 *   2. The bundle must be registered in the composed tree. Instead of editing
 *      the user's `cordis.patch.yml`, we write a tiny `--patch` overlay and
 *      pass it on every spawn (it is applied after the profile + home layers).
 *
 * Peer dependencies (`@deepseek-ai/*`, `cordis`, `schemastery`, `react`) are
 * already resolved by dsh's healed fallback and are deliberately not linked
 * here.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHome } from '../shared/paths'
import { dshModuleDir, type RuntimeContext } from './runtime'

export const VISION_TOOLKIT_BUNDLE = '@anionex/dsh-vision-toolkit'
export const VISION_TOOLKIT_OVERLAY_FILENAME = 'vision-toolkit.patch.yml'

/** The cordis insert row that mounts the bundle; mirrors the bundle's own `cordis.patch.yml`. */
const INSERT_PATCH = `# FISHCODE: mount the bundled vision-toolkit profile bundle.\n- insert:\n    - id: vision-toolkit\n      name: '${VISION_TOOLKIT_BUNDLE}'\n`

export type LinkStatus = 'created' | 'kept' | 'conflict' | 'missing'

export interface VisionToolkitLink {
  name: string
  status: LinkStatus
}

export interface VisionToolkitResult {
  overlayPath: string
  linked: VisionToolkitLink[]
}

/** Absolute path of the `--patch` overlay FISHCODE writes and passes to dsh. */
export function visionToolkitOverlayPath(): string {
  return join(dshHome(), VISION_TOOLKIT_OVERLAY_FILENAME)
}

function linkType(): 'junction' | 'dir' {
  // dsh itself junctions unconditionally; on non-Windows a directory symlink
  // is the portable equivalent.
  return process.platform === 'win32' ? 'junction' : 'dir'
}

/**
 * Ensure `link` is a symlink to `target`, re-pointing a wrong/dangling link.
 * A real directory is left untouched (reported as a conflict) so we never
 * delete something the user owns.
 */
function ensureLink(link: string, target: string): LinkStatus {
  if (!existsSync(target)) return 'missing'

  let stat
  try {
    stat = lstatSync(link)
  } catch {
    stat = undefined
  }
  if (stat !== undefined) {
    if (!stat.isSymbolicLink()) return 'conflict'
    try {
      if (readlinkSync(link) === target) return 'kept'
    } catch {
      // dangling link — replace below
    }
    unlinkSync(link)
  }
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(target, link, linkType())
  return 'created'
}

/**
 * Collect the bundle's non-peer runtime dependency closure from the bundled
 * dsh `node_modules` (BFS over `dependencies` only). Peer dependencies are
 * resolved by dsh's own fallback and are intentionally excluded.
 */
function collectClosure(moduleDir: string, root: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const queue = [root]
  while (queue.length > 0) {
    const name = queue.shift() as string
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
    let deps: Record<string, string> = {}
    try {
      const pkg = JSON.parse(
        readFileSync(join(moduleDir, ...name.split('/'), 'package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string> }
      deps = pkg.dependencies ?? {}
    } catch {
      continue
    }
    for (const dep of Object.keys(deps)) queue.push(dep)
  }
  return out
}

/**
 * Idempotently prepare the vision-toolkit bundle for the next `dsh web` spawn:
 * junction the bundle + its closure into the profile fallback and (re)write the
 * `--patch` overlay. Safe to run before every backend start.
 */
export function ensureVisionToolkit(ctx: RuntimeContext): VisionToolkitResult {
  const moduleDir = dshModuleDir(ctx)
  const fallback = join(dshHome(), 'profiles', 'node_modules')

  const linked = collectClosure(moduleDir, VISION_TOOLKIT_BUNDLE).map((name) => {
    const link = join(fallback, ...name.split('/'))
    const target = join(moduleDir, ...name.split('/'))
    return { name, status: ensureLink(link, target) }
  })

  const overlayPath = visionToolkitOverlayPath()
  writeFileSync(overlayPath, INSERT_PATCH, 'utf8')
  return { overlayPath, linked }
}
