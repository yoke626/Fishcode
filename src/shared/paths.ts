/**
 * Pure path helpers that do not import electron, so both the main process and
 * any plain-node script can share them.
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'

/** Resolve the harness home (`$DSH_HOME` or the `~/.dsh` default). */
export function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** Return the first path in `candidates` that exists on disk, or undefined. */
export function firstExisting(candidates: string[]): string | undefined {
  return candidates.find((p) => existsSync(p))
}
