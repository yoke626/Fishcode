/**
 * DeepSeek account balance display for the tray.
 *
 * Reads the DEEPSEEK_API_KEY credential from $DSH_HOME/.credentials.yaml (the
 * same file dsh itself reads) and queries the official balance endpoint. The
 * key is used only in the Authorization header and is never logged. Failures
 * degrade to a one-line tray label, never a crash or a dialog.
 *
 * The credential file is strict YAML (`uniqueKeys: true`) that dsh parses at
 * boot, so this reader only looks at top-level key lines and refuses to
 * interpret anything ambiguous (block scalars, quotes it cannot unescape).
 * Byte-for-byte preservation is not needed here — this is a read-only scan.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from '../shared/paths'
import { STRINGS } from '../shared/strings'

const CREDENTIALS_FILENAME = '.credentials.yaml'
// Top-level key line only: zero leading whitespace, optional quoting of the ref.
const KEY_LINE_RE = /^(DEEPSEEK_API_KEY|['"]DEEPSEEK_API_KEY['"])\s*:(.*)$/
const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const FETCH_TIMEOUT_MS = 10_000

interface BalanceInfo {
  currency: string
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

interface BalanceResponse {
  is_available: boolean
  balance_infos: BalanceInfo[]
}

export type BalanceStatus = 'ok' | 'unconfigured' | 'error'

export interface BalanceState {
  status: BalanceStatus
  /** Single user-facing line for the tray, e.g. "¥110.00". */
  label: string
}

/** Unwrap a YAML scalar: single/double quotes and '' escapes, else plain. */
function unquote(value: string): string {
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replace(/\\(.)/g, '$1')
  }
  return value
}

function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case 'CNY':
      return '¥'
    case 'USD':
      return '$'
    default:
      return `${currency} `
  }
}

function formatBalance(data: BalanceResponse): string {
  const parts = (data.balance_infos ?? []).map(
    (info) => `${currencySymbol(info.currency)}${Number(info.total_balance ?? 0).toFixed(2)}`,
  )
  const label = parts.length > 0 ? parts.join(' / ') : '—'
  return data.is_available === false ? `${label}（不可用）` : label
}

export class DeepSeekBalance {
  private state: BalanceState = {
    status: 'unconfigured',
    label: STRINGS.tray.balanceLoading,
  }
  private inFlight: AbortController | null = null

  getLabel(): string {
    return this.state.label
  }

  getStatus(): BalanceStatus {
    return this.state.status
  }

  /** Read-only extraction of DEEPSEEK_API_KEY. Returns null when absent/unparsable. */
  private readApiKey(): string | null {
    if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
    let text: string
    try {
      text = readFileSync(join(dshHome(), CREDENTIALS_FILENAME), 'utf8')
    } catch {
      return null
    }
    for (const line of text.split(/\r\n|\n/)) {
      const match = KEY_LINE_RE.exec(line)
      if (!match) continue
      let value = match[2].trim()
      if (value === '' || /^[>|]/.test(value)) return null // block scalar / empty — refuse
      // A trailing ` #comment` is only meaningful on plain scalars.
      if (!value.startsWith("'") && !value.startsWith('"')) {
        value = value.replace(/\s+#.*$/, '')
      }
      value = unquote(value).trim()
      return value || null
    }
    return null
  }

  /** Query the balance endpoint; the state is the return value. */
  async refresh(): Promise<BalanceState> {
    const key = this.readApiKey()
    if (!key) {
      this.state = { status: 'unconfigured', label: STRINGS.tray.balanceMissingKey }
      return this.state
    }

    const controller = new AbortController()
    this.inFlight = controller
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(BALANCE_URL, {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = (await response.json()) as BalanceResponse
      this.state = { status: 'ok', label: formatBalance(data) }
    } catch {
      this.state = { status: 'error', label: STRINGS.tray.balanceError }
    } finally {
      clearTimeout(timer)
      this.inFlight = null
    }
    return this.state
  }

  /** Abort an in-flight query (app shutdown) so the process can exit cleanly. */
  dispose(): void {
    this.inFlight?.abort()
    this.inFlight = null
  }
}
