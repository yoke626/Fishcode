/**
 * bench-runner: A/B harness for agent presets on one model.
 *
 * Rides over @deepseek-ai/dsh-headless: creates one fresh Agent per run,
 * mounts the preset named by BENCH_PRESET (or "standard"), then
 *
 *   1. Measures the FIRST-TURN system-prompt surface deterministically by
 *      invoking the exact assembly the first model request would run — no
 *      API cost, so it is reproducible and safe to diff. This is the core
 *      cost signal: how many prompt section chars and how wide a tool
 *      catalog the model sees on the path-committing first request.
 *   2. Optionally (BENCH_LIVE=1) sends BENCH_TASK and records the full turn
 *      economy: tool calls, assistant turns, output length, wall time, and
 *      whatever usage the session events carry.
 *
 * First-turn capture: the handler below is registered on the HOST context at
 * boot, i.e. BEFORE the preset's own `system-prompt/assemble` handler is
 * registered when the preset mounts in agent setup. Cordis `waterfall` runs
 * the chain in registration order and the outermost listener's return is the
 * final assembly, so `await next()` here resolves to the preset-trimmed
 * final surface (the router-standard preset trims to persona + shell/editor
 * on the first request, then opens the full catalog after the first tool
 * call).
 *
 * The assembled result is the same one the model request consumes, so the
 * measured section chars / tool list are exactly what drives prompt tokens.
 */

import { randomUUID } from 'node:crypto'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

/** Stable Cordis plugin name. */
export const name = 'bench-runner'

/** Core services are read via ctx.get() so no inject order is needed. */
export const inject = []

export function apply(ctx, config) {
  const exit = ctx.get('appExit')
  if (exit === void 0) throw new Error('bench-runner: the launcher must provide ctx.appExit')
  const io = { stdout: process.stdout, stderr: process.stderr, exit }
  run(ctx, config, io).catch((error) => {
    io.stderr.write(`dsh: ${error instanceof Error ? error.stack : String(error)}\n`)
    io.exit(1)
  })
}

async function run(ctx, config, io) {
  const t0 = Date.now()
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  const systemPrompt = ctx.get('systemPrompt')
  const agentPresets = ctx.get('agentPresets')
  const missing = []
  if (!agents) missing.push('agents')
  if (!defaultModel) missing.push('agentDefaultModel')
  if (!sessions) missing.push('sessions')
  if (!systemPrompt) missing.push('systemPrompt')
  if (!agentPresets) missing.push('agentPresets')
  if (missing.length > 0) {
    io.stderr.write(`bench-runner: missing core services: ${missing.join(', ')}\n`)
    io.exit(1)
    return
  }

  const presetId = config.preset || null
  const task = String(config.task ?? '')
  const live = process.env.BENCH_LIVE === '1'
  const selection = defaultModel.currentSelection()

  // ── first-turn surface capture (see header note for why this order) ─────
  const firstTurn = { sections: null, tools: null, toolSchemas: null }
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const final = await next()
    if (firstTurn.sections !== null || context.agent === undefined) return final
    firstTurn.sections = (final.sections ?? []).map((s) => ({
      name: s.name,
      chars: String(s.text ?? '').length,
    }))
    const tools = final.tools ?? []
    firstTurn.tools = tools.map((t) => t.name)
    // The assembled `tools` are the schemas the request serializes into the
    // API `tools` field — every one of those characters is prompt-token cost.
    // Serializing them here gives a deterministic, zero-cost total-payload
    // proxy (section text + tool schemas) for the path-committing first turn.
    firstTurn.toolSchemas = JSON.stringify(tools)
    return final
  })
  ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
    const probe = await next()
    if (assembly !== probe) {
      const names = (probe.sections ?? []).map((s) => s.name)
      const hasRouter = (probe.tools ?? []).some((t) => t.name === 'dev_router_status')
      io.stderr.write(`[bench] probe: sections=${names.length} routerActive=${hasRouter} hasPersona=${names.includes('router-persona')}\n`)
    }
    return probe
  })

  let agentCtxRef = null
  let mounted = null
  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: async (agentCtx) => {
      agentCtxRef = agentCtx
      installModelSelection(agentCtx, { current: selection, assembled: void 0 })
      if (presetId) mounted = await agentPresets.mount(agentCtx, presetId)
    },
  })
  await agent.whenIdle()

  // diagnostics
  const roster = await agentPresets.list()
  io.stderr.write(
    `[bench] roster=${roster.map((p) => p.id).join(',')} mounted=${mounted ? `${mounted.id}@${mounted.dir ?? ''}` : 'none'}\n`,
  )
  io.stderr.write(`[bench] agentCtx scope=${agentCtxRef ? 'set' : 'null'} pluginCount=${agentCtxRef ? Object.keys(agentCtxRef.registry ?? {}).length : '?'}\n`)

  // Deterministic measurement: trigger the same assembly the first model
  // request would, then read its final surface. No model call, no cost.
  // assembleContextFor() (dsh-agent/lib/index.js:384) always builds the scope
  // from the AGENT OBJECT — `{ agent, scope: agent }` — and the scope is the
  // carrier key scopeTarget() filters the waterfall on. Passing agentCtx here
  // (a different key) would silently exclude every agent-scoped handler,
  // i.e. the preset's trim would never run.
  await systemPrompt.assemble({ scope: agent, agent })

  const result = {
    preset: presetId ?? 'none',
    model: selection.model,
    elapsedMs: Date.now() - t0,
    firstTurn: {
      sectionCount: firstTurn.sections?.length ?? null,
      sectionChars: firstTurn.sections?.reduce((a, s) => a + s.chars, 0) ?? null,
      toolCount: firstTurn.tools?.length ?? null,
      toolSchemaChars: firstTurn.toolSchemas?.length ?? null,
      totalChars:
        (firstTurn.sections?.reduce((a, s) => a + s.chars, 0) ?? 0) +
        (firstTurn.toolSchemas?.length ?? 0),
      tools: firstTurn.tools ?? null,
    },
  }

  if (live && task) {
    const firstSeq = agent.session.seq
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: task }],
        source: { kind: 'user' },
      }),
    )
    await agent.whenIdle()
    await sessions.flush(agent.session)

    const events = agent.session.events.filter((e) => e.seq >= firstSeq)
    const toolNames = []
    let assistantTurns = 0
    let outputChars = 0
    let lastReason = null
    const usage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0, cacheMissTokens: 0 }
    for (const event of events) {
      if (event.type === 'tool/call') {
        toolNames.push(event.data?.name ?? event.data?.tool?.name ?? '?')
      } else if (event.type === 'assistant/message') {
        const text = (event.data?.message?.content ?? [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('')
        if (text) {
          outputChars += text.length
          assistantTurns++
        }
        // DeepSeek reports usage snake_case (prompt_tokens …) plus separate
        // cache-hit/miss counters; the assistant/message event carries them
        // verbatim under `usage`.
        const u = event.data?.usage
        if (u) {
          usage.promptTokens += u.prompt_tokens ?? u.promptTokens ?? 0
          usage.completionTokens += u.completion_tokens ?? u.completionTokens ?? 0
          usage.cachedTokens += u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0
          usage.cacheMissTokens += u.prompt_cache_miss_tokens ?? 0
        }
      } else if (event.type === 'turn/end') {
        lastReason = event.data?.reason?.kind ?? event.data?.reason
      }
    }
    result.live = {
      task,
      toolCalls: toolNames.length,
      toolNames: [...new Set(toolNames)],
      assistantTurns,
      outputChars,
      reason: lastReason,
      usage,
    }
  }

  io.stdout.write('===BENCH===\n' + JSON.stringify(result, null, 2) + '\n===BENCHEND===\n')
  io.exit(live ? (result.live?.reason === 'completed' ? 0 : 1) : 0)
}
