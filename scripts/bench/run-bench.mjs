/**
 * Run the agent-preset A/B bench against the repository's dsh bundle.
 *
 * Copies the bench profile files into $DSH_HOME/profiles/bench (the loader
 * resolves @deepseek-ai/* plugins from the hoisted profile node_modules, which
 * on this machine junction to the installed FISHCODE resources — same dsh
 * version as the bundle), then boots the repo's own dsh CLI per preset.
 *
 * Usage:
 *   node scripts/bench/run-bench.mjs                      # assemble-only, standard + router-standard
 *   node scripts/bench/run-bench.mjs --live --task "..."  # plus one real task per preset
 *   node scripts/bench/run-bench.mjs --preset router-standard --live --task "..."
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const benchDir = join(repoRoot, 'scripts', 'bench')
const dshBin = join(repoRoot, 'dsh-bundle', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const profileDir = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', 'bench')

// ── argument parsing ───────────────────────────────────────────────────────
const presets = []
let live = false
let task = ''
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (arg === '--live') live = true
  else if (arg === '--task') task = argv[++i] ?? ''
  else if (arg === '--preset') presets.push(argv[++i] ?? '')
  else if (arg === '--help') {
    console.log('usage: run-bench.mjs [--live] [--task "<task>"] [--preset <id>]...')
    process.exit(0)
  } else {
    console.error(`unknown argument: ${arg}`)
    process.exit(1)
  }
}

// ── install the profile (idempotent copy) ──────────────────────────────────
mkdirSync(profileDir, { recursive: true })
for (const file of ['package.json', 'pnpm-workspace.yaml', 'cordis.yml', 'cordis.patch.yml', 'bench-runner.mjs']) {
  const source = join(benchDir, file)
  const target = join(profileDir, file)
  writeFileSync(target, readSource(source))
  console.log(`[run-bench] installed ${file} -> ${target}`)
}

function readSource(path) {
  return readFileSync(path, 'utf8')
}

const chosen = presets.length > 0 ? presets : ['standard', 'router-standard']
const results = []
for (const preset of chosen) {
  console.log(`\n=== preset: ${preset} ${live ? '(live)' : '(assemble-only)'} ===`)
  const env = {
    ...process.env,
    BENCH_PRESET: preset,
    BENCH_TASK: task,
    BENCH_LIVE: live ? '1' : '0',
  }
  const runArgs = live && task ? [dshBin, '--profile', 'bench', task] : [dshBin, '--profile', 'bench']
  const child = spawnSync(process.execPath, runArgs, {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    timeout: live ? 300_000 : 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stdout = child.stdout ?? ''
  const stderr = child.stderr ?? ''
  if (child.status !== 0) {
    console.error(stderr.split('\n').slice(0, 8).join('\n'))
    console.error(`[run-bench] preset ${preset} exited ${child.status}; ${stdout.length} stdout bytes`)
  }
  const m = stdout.match(/===BENCH===\n([\s\S]*?)\n===BENCHEND===/)
  if (m) {
    const parsed = JSON.parse(m[1])
    results.push(parsed)
    console.log(JSON.stringify(parsed, null, 2))
  } else {
    console.error(`[run-bench] no bench payload in stdout for ${preset}; stdout head:`)
    console.error(stdout.slice(0, 1200))
  }
}

if (results.length === 2) {
  console.log('\n=== SUMMARY ===')
  const [a, b] = results
  const fmt = (v) => v ?? 'n/a'
  console.log('preset               sectionChars  toolSchemaChars  totalChars  toolCount  tools')
  for (const r of [a, b]) {
    const ft = r.firstTurn
    console.log(
      `${String(r.preset).padEnd(20)} ${String(fmt(ft.sectionChars)).padStart(11)} ${String(fmt(ft.toolSchemaChars)).padStart(15)} ${String(fmt(ft.totalChars)).padStart(10)} ${String(fmt(ft.toolCount)).padStart(9)}  ${(ft.tools ?? []).join(', ')}`,
    )
  }
  if (live && a.live && b.live) {
    console.log('\npreset               toolCalls  assistantTurns  outputChars  promptTok  cachedTok  elapsedMs')
    for (const r of [a, b]) {
      const l = r.live
      console.log(
        `${String(r.preset).padEnd(20)} ${String(l.toolCalls).padStart(9)} ${String(l.assistantTurns).padStart(14)} ${String(l.outputChars).padStart(11)} ${String(l.usage?.promptTokens ?? 'n/a').padStart(9)} ${String(l.usage?.cachedTokens ?? 'n/a').padStart(9)} ${String(r.elapsedMs).padStart(9)}`,
      )
    }
  }
}
