// Remove build output so every build starts from a clean tree.
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
await rm(new URL('../out', import.meta.url), { recursive: true, force: true })
console.log(`[clean] removed ${root}out`)
