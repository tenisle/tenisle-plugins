/**
 * Tenisle for DeepSeek Harness — Host half.
 *
 * Owns the Tenisle account session (OAuth 2.1 authorization code with PKCE,
 * dynamic client registration, refresh-token rotation) and serves a loopback
 * MCP bridge that adds a fresh Bearer token to every request. The shipped MCP
 * client row inserted by `cordis.patch.yml` connects to that bridge, so its
 * tools reach the model as `mcp__tenisle__<tool>`. The same plugin registers the
 * bundled Tenisle skills.
 *
 * The prompt text the model sees for the connection comes from the Tenisle MCP
 * server itself; this package only carries credentials and display metadata.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBridge } from './lib/bridge.js'
import { TenisleOAuth } from './lib/oauth.js'
import { registerSkills } from './lib/skills.js'
import { CredentialStore, defaultStateDir } from './lib/token-store.js'

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ISSUER = 'https://tenisle.com'
const DEFAULT_PORT = 61980

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tenisle'

/**
 * Start the account session, the loopback MCP bridge, and the bundled skills.
 *
 * @param {object} ctx - Cordis plugin context of the `tenisle` row.
 * @param {object} [config] - the row's resolved config.
 * @param {string} [config.issuer] - Tenisle origin; defaults to `https://tenisle.com`.
 * @param {number} [config.port] - loopback port for the MCP bridge; defaults to `61980`.
 * @param {string} [config.stateDir] - credential directory; defaults to `$DSH_HOME/tenisle`.
 * @param {boolean} [config.autoLogin] - open the browser sign-in when no token is usable.
 * @param {boolean} [config.openBrowser] - open the sign-in URL automatically.
 * @returns {Promise<void>} resolves after the bridge listens.
 */
export async function apply(ctx, config = {}) {
  const issuer = normalizeIssuer(config.issuer)
  const port = normalizePort(config.port)
  const stateDir =
    typeof config.stateDir === 'string' && config.stateDir.trim().length > 0 ? config.stateDir.trim() : defaultStateDir()
  const redirectUri = `http://127.0.0.1:${port}/oauth/callback`

  const store = new CredentialStore({ file: join(stateDir, 'credentials.json'), log: ctx.logger })
  const oauth = new TenisleOAuth({
    issuer,
    redirectUri,
    store,
    log: ctx.logger,
    clientName: 'DeepSeek Harness',
    allowLogin: config.autoLogin !== false,
    openBrowser: config.openBrowser !== false,
  })
  const bridge = createBridge({ port, issuer, oauth, log: ctx.logger })

  ctx.effect(
    () => () => {
      void bridge.stop()
    },
    'tenisle.bridge',
  )
  await bridge.start()
  ctx.logger.info(`tenisle: MCP bridge listening on http://127.0.0.1:${port}/mcp`)

  ctx.inject(['skills'], (scoped) => {
    scoped.effect(() => registerSkills(scoped, PACKAGE_DIR, ctx.logger), 'tenisle.skills')
  })

  if (!(await oauth.isAuthenticated())) {
    ctx.logger.info('tenisle: no Tenisle account is connected yet; the first MCP request opens the browser sign-in')
  }
}

function normalizeIssuer(value) {
  const issuer = typeof value === 'string' && value.trim().length > 0 ? value.trim() : DEFAULT_ISSUER
  let parsed
  try {
    parsed = new URL(issuer)
  } catch {
    throw new Error(`tenisle: issuer "${issuer}" is not a valid URL`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`tenisle: issuer "${issuer}" must be an http(s) URL`)
  }
  return parsed.origin
}

function normalizePort(value) {
  const port = value ?? DEFAULT_PORT
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`tenisle: port must be an integer between 1024 and 65535 (received ${JSON.stringify(value)})`)
  }
  return port
}
