/**
 * Resolves the three things the shell needs from its bundled runtime, with the
 * dev and packaged layouts unified behind a single RuntimeContext:
 *   - the standalone Node binary
 *   - the `@deepseek-ai/dsh` entry (read from its package.json `bin` field)
 *   - the bundled-skills directory
 */

import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface RuntimeContext {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
}

export function runtimeContext(): RuntimeContext {
  return {
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  }
}

/** Bundled skills root, exposed to the backend via `DSH_BUNDLED_SKILL_DIR`. */
export function bundledSkillsDir(ctx: RuntimeContext): string {
  if (ctx.isPackaged) return join(ctx.resourcesPath, 'skills')
  return join(ctx.appPath, 'out', 'skills')
}

/** The standalone Node binary (dev falls back to the system node / `DSH_NODE`). */
export function nodeRuntimePath(ctx: RuntimeContext): string {
  if (ctx.isPackaged) {
    return join(ctx.resourcesPath, 'node-runtime', process.platform === 'win32' ? 'node.exe' : 'node')
  }
  return process.env.DSH_NODE ?? 'node'
}

/** Root of the bundled dsh dependency tree. */
export function dshModuleDir(ctx: RuntimeContext): string {
  if (ctx.isPackaged) return join(ctx.resourcesPath, 'dsh', 'node_modules')
  return join(ctx.appPath, 'dsh-bundle', 'node_modules')
}

/**
 * The `@deepseek-ai/dsh` CLI entry, resolved from its package.json `bin`
 * field so we never hardcode the deep `lib/bin.js` path.
 */
export function dshBinPath(ctx: RuntimeContext): string {
  const pkgPath = join(dshModuleDir(ctx), '@deepseek-ai', 'dsh', 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    bin?: string | Record<string, string>
  }
  const bin = pkg.bin
  const relative = typeof bin === 'string' ? bin : (bin?.dsh ?? 'lib/bin.js')
  return join(dshModuleDir(ctx), '@deepseek-ai', 'dsh', relative)
}
