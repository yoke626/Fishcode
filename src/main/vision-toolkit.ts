/**
 * Registers FISHCODE's bundled dsh plugins with the local `dsh web` backend —
 * without pnpm or the `dsh plugin` CLI.
 *
 * Each bundled plugin must be true before the next `dsh web` spawn so the
 * cordis loader can import it:
 *
 *   1. The package and its non-peer dependency closure must resolve from the
 *      profile module fallback `$DSH_HOME/profiles/node_modules`. dsh's own
 *      `healProfilesModuleFallback` junctions the app's closure there; we
 *      junction the bundled plugin + its hoisted deps the same way, as
 *      *foreign* entries dsh leaves untouched.
 *   2. The plugin must be registered in the composed tree. Instead of editing
 *      the user's `cordis.patch.yml`, we write one `--patch` overlay per
 *      bundled plugin and pass them all on every spawn. The overlay content is
 *      copied verbatim from each package's own `cordis.patch.yml`, so any
 *      plugin-specific mount row / guard expression is preserved.
 *
 * Peer dependencies (`@deepseek-ai/*`, `cordis`, `react`, etc.) are already
 * resolved by dsh's healed fallback and are deliberately not linked here.
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

export type LinkStatus = 'created' | 'kept' | 'conflict' | 'missing'

export interface PluginLink {
  name: string
  status: LinkStatus
}

export interface BundledPluginResult {
  id: string
  packageName: string
  overlayPath: string
  linked: PluginLink[]
}

export interface BundledPluginSpec {
  id: string
  packageName: string
  /** Overlay file name under `$DSH_HOME`. Kept stable and unique per plugin. */
  overlayFilename: string
}

/**
 * The plugins FISHCODE ships out of the box. The overlay row is read from each
 * package's own `cordis.patch.yml`, so adding a new bundled plugin is just a
 * new entry here + a dependency in `dsh-bundle/package.json`.
 */
export const BUNDLED_PLUGINS: readonly BundledPluginSpec[] = [
  {
    id: 'vision-toolkit',
    packageName: VISION_TOOLKIT_BUNDLE,
    overlayFilename: VISION_TOOLKIT_OVERLAY_FILENAME,
  },
  {
    id: 'genui',
    packageName: '@omdsh-dev/dsh-genui',
    overlayFilename: 'dsh-genui.patch.yml',
  },
  {
    id: 'better-sidebar',
    packageName: 'dsh-better-sidebar',
    overlayFilename: 'dsh-better-sidebar.patch.yml',
  },
  {
    id: 'pet',
    packageName: '@linxin666/dsh-pet',
    overlayFilename: 'dsh-pet.patch.yml',
  },
  {
    id: 'ui-skin-center',
    packageName: '@linxin666/dsh-client-ui-skin-center',
    overlayFilename: 'dsh-skin-center.patch.yml',
  },
  {
    id: 'dsh-market',
    packageName: 'dshmarket',
    overlayFilename: 'dshmarket.patch.yml',
  },
]

/** Absolute path of the `--patch` overlay FISHCODE writes for one plugin. */
export function bundledPluginOverlayPath(packageName: string): string {
  const spec = BUNDLED_PLUGINS.find((entry) => entry.packageName === packageName)
  if (!spec) throw new Error(`unknown bundled plugin: ${packageName}`)
  return join(dshHome(), spec.overlayFilename)
}

/** Back-compat alias for callers that only care about the vision toolkit. */
export function visionToolkitOverlayPath(): string {
  return bundledPluginOverlayPath(VISION_TOOLKIT_BUNDLE)
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
 * Collect the package's non-peer runtime dependency closure from the bundled
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
 * Link one bundled plugin + its closure into the profile fallback and write
 * its `--patch` overlay. Returns the overlay path and per-link status.
 */
function ensureBundledPlugin(ctx: RuntimeContext, spec: BundledPluginSpec): BundledPluginResult {
  const moduleDir = dshModuleDir(ctx)
  const fallback = join(dshHome(), 'profiles', 'node_modules')
  const packageRoot = join(moduleDir, ...spec.packageName.split('/'))
  const patchSource = join(packageRoot, 'cordis.patch.yml')

  if (!existsSync(patchSource)) {
    throw new Error(`bundled plugin ${spec.packageName} has no cordis.patch.yml at ${patchSource}`)
  }

  const linked = collectClosure(moduleDir, spec.packageName).map((name) => {
    const link = join(fallback, ...name.split('/'))
    const target = join(moduleDir, ...name.split('/'))
    return { name, status: ensureLink(link, target) }
  })

  const overlayPath = join(dshHome(), spec.overlayFilename)
  writeFileSync(overlayPath, readFileSync(patchSource, 'utf8'), 'utf8')
  return { id: spec.id, packageName: spec.packageName, overlayPath, linked }
}

/**
 * Idempotently prepare every bundled plugin for the next `dsh web` spawn:
 * junction the packages + their closures into the profile fallback and write
 * one `--patch` overlay per plugin. Safe to run before every backend start.
 */
export function ensureBundledPlugins(ctx: RuntimeContext): BundledPluginResult[] {
  return BUNDLED_PLUGINS.map((spec) => ensureBundledPlugin(ctx, spec))
}

/**
 * Legacy single-plugin entry used by older callers. Kept so the vision-toolkit
 * registration path stays available if a future build needs it in isolation.
 */
export function ensureVisionToolkit(ctx: RuntimeContext): { overlayPath: string; linked: PluginLink[] } {
  const result = ensureBundledPlugin(ctx, BUNDLED_PLUGINS[0])
  return { overlayPath: result.overlayPath, linked: result.linked }
}
