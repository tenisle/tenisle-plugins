/**
 * Tenisle OAuth 2.1 session: dynamic client registration, authorization code
 * with PKCE, and refresh-token rotation.
 *
 * Tenisle publishes its authorization metadata at
 * `https://tenisle.com/.well-known/openid-configuration`; the MCP endpoint
 * (`/mcp`) requires an OAuth access token as a Bearer credential. The public
 * client registered here needs no secret, so the whole flow runs locally and
 * the resulting tokens stay in the credential store.
 */

import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'

/** Refresh a token this long before it actually expires. */
const EXPIRY_SKEW_MS = 60_000
/** How long one browser sign-in may take before the attempt is abandoned. */
const LOGIN_TIMEOUT_MS = 10 * 60_000

/** A Tenisle authorization, token, or registration failure. */
export class OAuthError extends Error {
  /** @param {string} message - operator-facing explanation. */
  constructor(message) {
    super(message)
    this.name = 'OAuthError'
  }
}

const base64url = (value) => Buffer.from(value).toString('base64url')
const randomToken = (bytes) => base64url(randomBytes(bytes))

/**
 * Open a URL in the user's default browser without blocking the Host.
 *
 * @param {string} url - URL to open.
 * @returns {void}
 */
export function openExternal(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

/** One Tenisle account session bound to a single loopback redirect URI. */
export class TenisleOAuth {
  #issuer
  #redirectUri
  #store
  #log
  #clientName
  #scope
  #allowLogin
  #openBrowser
  #pending
  #loginInFlight
  #refreshInFlight

  /**
   * @param {object} options
   * @param {string} options.issuer - authorization server origin.
   * @param {string} options.redirectUri - loopback redirect registered for this session.
   * @param {import('./token-store.js').CredentialStore} options.store - credential storage.
   * @param {{info?: Function, warn?: Function}} [options.log] - optional logger.
   * @param {string} [options.clientName] - name shown on the Tenisle consent screen.
   * @param {string} [options.scope] - requested scopes.
   * @param {boolean} [options.allowLogin] - whether an interactive sign-in may start.
   * @param {boolean} [options.openBrowser] - whether to open the sign-in URL automatically.
   */
  constructor({
    issuer,
    redirectUri,
    store,
    log,
    clientName = 'DeepSeek Harness',
    scope = 'openid profile email offline_access mcp',
    allowLogin = true,
    openBrowser = true,
  }) {
    this.#issuer = issuer
    this.#redirectUri = redirectUri
    this.#store = store
    this.#log = log
    this.#clientName = clientName
    this.#scope = scope
    this.#allowLogin = allowLogin
    this.#openBrowser = openBrowser
  }

  /** @returns {string} authorization server origin. */
  get issuer() {
    return this.#issuer
  }

  /** @returns {string} loopback redirect URI registered with Tenisle. */
  get redirectUri() {
    return this.#redirectUri
  }

  /**
   * Whether stored credentials exist that could still produce an access token.
   *
   * @returns {Promise<boolean>} `true` when a refresh token or a live access token is stored.
   */
  async isAuthenticated() {
    const { tokens } = await this.#store.read()
    if (tokens === undefined || tokens === null) return false
    if (typeof tokens.refresh_token === 'string' && tokens.refresh_token.length > 0) return true
    return typeof tokens.expires_at === 'number' && tokens.expires_at - EXPIRY_SKEW_MS > Date.now()
  }

  /**
   * The dynamically registered public client for this redirect URI.
   *
   * @returns {Promise<{client_id: string, redirect_uri: string}>} stored or freshly registered client.
   */
  async client() {
    const state = await this.#store.read()
    const client = state.client
    if (client?.client_id && client.redirect_uri === this.#redirectUri) return client
    return this.#registerClient()
  }

  /**
   * A currently valid access token, refreshing it or signing the user in.
   *
   * @param {{forceRefresh?: boolean}} [options] - `forceRefresh` skips the cache after a 401.
   * @returns {Promise<string>} access token for the Tenisle MCP endpoint.
   */
  async accessToken({ forceRefresh = false } = {}) {
    const { tokens } = await this.#store.read()
    if (!forceRefresh && tokens?.access_token && tokens.expires_at - EXPIRY_SKEW_MS > Date.now()) {
      return tokens.access_token
    }
    if (typeof tokens?.refresh_token === 'string' && tokens.refresh_token.length > 0) {
      try {
        return await this.#refresh()
      } catch (error) {
        this.#log?.warn?.(`tenisle: token refresh failed: ${error.message}`)
        if (!this.#allowLogin) throw error
      }
    }
    if (!this.#allowLogin) throw new OAuthError('Tenisle authentication required')
    await this.login()
    const next = await this.#store.read()
    if (typeof next.tokens?.access_token !== 'string') throw new OAuthError('Tenisle sign-in finished without an access token')
    return next.tokens.access_token
  }

  /**
   * Start (or join) one interactive sign-in and resolve when it completes.
   *
   * @returns {Promise<string>} the new access token.
   */
  async login() {
    if (this.#loginInFlight !== undefined) return this.#loginInFlight
    this.#loginInFlight = this.#beginLogin().finally(() => {
      this.#loginInFlight = undefined
    })
    return this.#loginInFlight
  }

  /**
   * Complete a pending sign-in from the loopback callback.
   *
   * @param {URLSearchParams} params - callback query parameters.
   * @returns {Promise<{ok: boolean, message: string}>} result rendered in the browser.
   */
  async handleCallback(params) {
    const pending = this.#pending
    if (pending === undefined) return { ok: false, message: 'No Tenisle sign-in is in progress.' }
    const failure = params.get('error')
    if (failure !== null) {
      const description = params.get('error_description')
      this.#finishPending(pending, new OAuthError(`Tenisle sign-in was rejected: ${failure}${description ? ` — ${description}` : ''}`))
      return { ok: false, message: 'Tenisle sign-in was not completed.' }
    }
    if (params.get('state') !== pending.state) {
      return { ok: false, message: 'The sign-in state did not match. Start the connection again.' }
    }
    const code = params.get('code')
    if (code === null || code.length === 0) {
      const error = new OAuthError('the Tenisle redirect carried no authorization code')
      this.#finishPending(pending, error)
      return { ok: false, message: error.message }
    }
    try {
      const client = await this.client()
      const json = await this.#postForm(
        '/oauth/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: client.client_id,
          redirect_uri: this.#redirectUri,
          code_verifier: pending.verifier,
        }),
      )
      const tokens = await this.#saveTokens(json)
      this.#log?.info?.('tenisle: account connected')
      this.#finishPending(pending, undefined, tokens.access_token)
      return { ok: true, message: 'Tenisle connected. You can close this tab and return to the harness.' }
    } catch (error) {
      this.#finishPending(pending, error)
      return { ok: false, message: `Tenisle sign-in failed: ${error.message}` }
    }
  }

  async #registerClient() {
    let response
    try {
      response = await fetch(new URL('/oauth/register', this.#issuer), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          client_name: this.#clientName,
          redirect_uris: [this.#redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: this.#scope,
        }),
      })
    } catch (error) {
      throw new OAuthError(`cannot reach Tenisle to register the client: ${error.message}`)
    }
    const text = await response.text()
    if (!response.ok) throw new OAuthError(`client registration failed with ${response.status}: ${text.slice(0, 300)}`)
    let json
    try {
      json = JSON.parse(text)
    } catch {
      throw new OAuthError('client registration returned a non-JSON response')
    }
    if (typeof json.client_id !== 'string' || json.client_id.length === 0) {
      throw new OAuthError('client registration returned no client_id')
    }
    const client = {
      client_id: json.client_id,
      redirect_uri: this.#redirectUri,
      token_endpoint_auth_method: json.token_endpoint_auth_method ?? 'none',
      registered_at: new Date().toISOString(),
    }
    await this.#store.patch({ client })
    this.#log?.info?.(`tenisle: registered OAuth client ${client.client_id}`)
    return client
  }

  async #beginLogin() {
    const client = await this.client()
    const verifier = randomToken(32)
    const challenge = base64url(createHash('sha256').update(verifier).digest())
    const state = randomToken(16)
    const url = new URL('/oauth/authorize', this.#issuer)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: this.#redirectUri,
      scope: this.#scope,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString()
    const completion = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pending?.state === state) {
          this.#pending = undefined
          reject(new OAuthError('Tenisle sign-in timed out — retry the connection to get a fresh sign-in link'))
        }
      }, LOGIN_TIMEOUT_MS)
      timer.unref?.()
      this.#pending = { state, verifier, resolve, reject, timer }
    })
    this.#log?.info?.(`tenisle: sign in to Tenisle to finish connecting: ${url.toString()}`)
    if (this.#openBrowser) {
      try {
        openExternal(url.toString())
      } catch (error) {
        this.#log?.warn?.(`tenisle: could not open a browser automatically: ${error.message}`)
      }
    }
    return completion
  }

  #finishPending(pending, error, token) {
    if (this.#pending !== pending) return
    this.#pending = undefined
    clearTimeout(pending.timer)
    if (error !== undefined) pending.reject(error)
    else pending.resolve(token)
  }

  #refresh() {
    if (this.#refreshInFlight !== undefined) return this.#refreshInFlight
    const run = (async () => {
      const client = await this.client()
      const { tokens } = await this.#store.read()
      const refreshToken = tokens?.refresh_token
      if (typeof refreshToken !== 'string' || refreshToken.length === 0) throw new OAuthError('no refresh token is stored')
      const json = await this.#postForm(
        '/oauth/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: client.client_id,
        }),
      )
      const next = await this.#saveTokens(json)
      this.#log?.info?.('tenisle: access token refreshed')
      return next.access_token
    })()
    this.#refreshInFlight = run
    return run.finally(() => {
      if (this.#refreshInFlight === run) this.#refreshInFlight = undefined
    })
  }

  async #saveTokens(json) {
    if (typeof json.access_token !== 'string' || json.access_token.length === 0) {
      throw new OAuthError('the Tenisle token endpoint returned no access_token')
    }
    const expiresIn = Number(json.expires_in)
    const { tokens: previous } = await this.#store.read()
    const tokens = {
      access_token: json.access_token,
      refresh_token:
        typeof json.refresh_token === 'string' && json.refresh_token.length > 0 ? json.refresh_token : previous?.refresh_token,
      token_type: json.token_type ?? 'Bearer',
      scope: json.scope,
      expires_at: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined,
      obtained_at: new Date().toISOString(),
    }
    await this.#store.patch({ tokens })
    return tokens
  }

  async #postForm(path, form) {
    let response
    try {
      response = await fetch(new URL(path, this.#issuer), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: form.toString(),
      })
    } catch (error) {
      throw new OAuthError(`cannot reach the Tenisle token endpoint: ${error.message}`)
    }
    const text = await response.text()
    if (!response.ok) throw new OAuthError(`${path} rejected with ${response.status}: ${text.slice(0, 300)}`)
    try {
      return text.length > 0 ? JSON.parse(text) : {}
    } catch {
      throw new OAuthError(`${path} returned a non-JSON response`)
    }
  }
}
