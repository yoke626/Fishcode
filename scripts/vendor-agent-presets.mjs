/**
 * FISHCODE vendored agent presets.
 *
 * dsh discovers SHIPPED agent presets from the directory beside its own
 * config — `<@deepseek-ai/dsh>/config/agent-presets/` — and that directory
 * lives inside the bundled dependency tree (`dsh-bundle/node_modules/...`),
 * which `npm ci` re-extracts pristine and which is NOT versioned (gitignored).
 * The presets FISHCODE ships as system presets therefore must be versioned
 * elsewhere and copied into place after install, exactly the way
 * `patch-vision-vendor.mjs` patches the vision toolkit. (The dsh launcher
 * hardcodes `agentPresets.roots` to that one shipped directory plus the
 * per-user `~/.dsh/.agent-presets/` root, so an extra `--patch` overlay
 * cannot add a preset root — the only way to ship a system preset is to drop
 * its directory here.)
 *
 * Source of truth: `vendor/agent-presets/<id>/` — one directory per preset,
 * holding the preset's composition (`agent.cordis.yml`), its display
 * metadata (`preset.yml`), and any relative plugin modules it imports
 * (`.mjs`). The whole directory is copied verbatim: a preset IS its
 * directory, and upstream ships `router-bootstrap.mjs` as a legacy alias
 * beside the `-v1` the composition actually names, so both stay.
 *
 * Currently vendored:
 *   - router-standard  (dsh-router-standard, MIT, © 2026 yjh051108)
 *     Task-aware reasoning-mode routing: one-sentence persona + shell/editor
 *     first-turn surface, full Standard tools after the first durable tool
 *     call. Self-contained (no injector dependency). See THIRD_PARTY_NOTICES.md.
 *
 * Usage: node scripts/vendor-agent-presets.mjs
 *
 * Idempotent (overwrites). Re-run after `npm ci` in dsh-bundle — npm
 * re-extracts the pristine @deepseek-ai/dsh tarball, wiping anything a
 * previous run copied in.
 */

import { cp, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = join(repoRoot, 'vendor', 'agent-presets')
const targetRoot = join(
  repoRoot,
  'dsh-bundle',
  'node_modules',
  '@deepseek-ai',
  'dsh',
  'config',
  'agent-presets',
)

async function main() {
  if (!existsSync(targetRoot)) {
    console.log(
      `[vendor-agent-presets] shipped preset root not present at ${targetRoot}; skipping (run after dsh-bundle npm ci)`,
    )
    return
  }

  const entries = await readdir(sourceRoot, { withFileTypes: true })
  const presets = entries.filter((entry) => entry.isDirectory())

  if (presets.length === 0) {
    console.log('[vendor-agent-presets] no presets under vendor/agent-presets; nothing to do')
    return
  }

  for (const preset of presets) {
    const source = join(sourceRoot, preset.name)
    const target = join(targetRoot, preset.name)
    await cp(source, target, { recursive: true, force: true })
    console.log(`[vendor-agent-presets] vendored ${preset.name} -> ${target}`)
  }
}

main().catch((error) => {
  console.error(`[vendor-agent-presets] failed: ${error.message}`)
  process.exitCode = 1
})
