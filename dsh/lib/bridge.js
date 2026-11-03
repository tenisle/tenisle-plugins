/**
 * Loopback bridge between the shipped MCP client and the Tenisle MCP endpoint.
 *
 * The shipped `@deepseek-ai/dsh-mcp-client` speaks Streamable HTTP with static
 * headers, while `https://tenisle.com/mcp` needs a short-lived OAuth access
 * token. This server terminates the local connection on `127.0.0.1:<port>/mcp`,
 * forwards each request upstream with a fresh Bearer token, and streams the
 * response back — including the long-lived SSE stream. It also serves the OAuth
 * redirect (`/oauth/callback`) and a small `/health` probe.
 */

import { createServer } from 'node:http'
import { OAuthError } from './oauth.js'

/** Request headers worth forwarding; everything else is hop-by-hop or local. */
const FORWARDED_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'content-type',
  'last-event-id',
  'mcp-protocol-version',
  'mcp-session-id',
])
/** Response headers the local Node server recomputes or must not repeat. */
const SKIPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const MCP_PATH = '/mcp'
const CALLBACK_PATH = '/oauth/callback'
const HEALTH_PATH = '/health'

/**
 * Create the loopback bridge. Nothing listens until {@link start} is called.
 *
 * @param {object} options
 * @param {number} options.port - loopback port; the same port hosts the OAuth redirect.
 * @param {string} options.issuer - Tenisle origin; MCP requests go to `<issuer>/mcp`.
 * @param {import('./oauth.js').TenisleOAuth} options.oauth - the account session.
 * @param {{info?: Function, warn?: Function, error?: Function}} [options.log] - optional logger.
 * @returns {{port: number, start: () => Promise<void>, stop: () => Promise<void>}}
 */
export function createBridge({ port, issuer, oauth, log }) {
  const upstreamUrl = new URL('/mcp', issuer)
  const sockets = new Set()
  let starting
  let server

  const sendJson = (response, status, payload, headers = {}) => {
    if (response.destroyed || response.writableEnded) return
    const body = JSON.stringify(payload)
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
      ...headers,
    })
    response.end(body)
  }

  const readBody = (request) =>
    new Promise((resolve, reject) => {
      const chunks = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', () => resolve(chunks.length > 0 ? Buffer.concat(chunks) : undefined))
      request.on('error', reject)
    })

  const pickRequestHeaders = (incoming) => {
    const picked = {}
    for (const [key, value] of Object.entries(incoming)) {
      if (value === undefined) continue
      const name = key.toLowerCase()
      if (!FORWARDED_REQUEST_HEADERS.has(name)) continue
      picked[name] = Array.isArray(value) ? value.join(', ') : value
    }
    return picked
  }

  async function forward(request, response) {
    const controller = new AbortController()
    response.on('close', () => {
      if (!response.writableEnded) controller.abort()
    })

    let token
    try {
      token = await oauth.accessToken()
    } catch (error) {
      const message = error instanceof OAuthError ? error.message : `Tenisle authorization failed: ${error.message}`
      log?.warn?.(`tenisle: ${message}`)
      sendJson(
        response,
        401,
        { jsonrpc: '2.0', id: null, error: { code: -32001, message } },
        { 'www-authenticate': 'Bearer realm="tenisle", error="invalid_token"' },
      )
      return
    }

    let body
    try {
      body = await readBody(request)
    } catch (error) {
      log?.warn?.(`tenisle: could not read the local MCP request: ${error.message}`)
      return
    }

    const callUpstream = (bearer) =>
      fetch(upstreamUrl, {
        method: request.method,
        headers: { ...pickRequestHeaders(request.headers), authorization: `Bearer ${bearer}` },
        body,
        signal: controller.signal,
        redirect: 'manual',
      })

    let upstream
    try {
      upstream = await callUpstream(token)
      if (upstream.status === 401) {
        log?.info?.('tenisle: the MCP endpoint rejected the access token; refreshing it')
        await upstream.body?.cancel?.()
        try {
          token = await oauth.accessToken({ forceRefresh: true })
        } catch (error) {
          log?.warn?.(`tenisle: token refresh failed: ${error.message}`)
        }
        upstream = await callUpstream(token)
      }
    } catch (error) {
      if (controller.signal.aborted) return
      log?.error?.(`tenisle: forwarding to ${upstreamUrl.origin} failed: ${error.message}`)
      sendJson(response, 502, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32002, message: 'The Tenisle MCP server is unreachable.' },
      })
      return
    }

    if (response.destroyed || response.writableEnded) {
      await upstream.body?.cancel?.()
      return
    }

    const headers = {}
    upstream.headers.forEach((value, key) => {
      if (!SKIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) headers[key] = value
    })
    response.writeHead(upstream.status, headers)

    if (request.method === 'HEAD' || upstream.status === 204 || upstream.status === 304 || upstream.body === null) {
      response.end()
      return
    }

    try {
      for await (const chunk of upstream.body) {
        if (response.destroyed || response.writableEnded) break
        if (!response.write(chunk)) await new Promise((resolve) => response.once('drain', resolve))
      }
    } catch (error) {
      if (!controller.signal.aborted) log?.warn?.(`tenisle: response stream interrupted: ${error.message}`)
    } finally {
      if (!response.destroyed && !response.writableEnded) response.end()
    }
  }

  async function route(request, response) {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
    if (url.pathname === CALLBACK_PATH) {
      const result = await oauth.handleCallback(url.searchParams)
      const page = renderPage(result.ok, result.message)
      if (response.destroyed || response.writableEnded) return
      response.writeHead(result.ok ? 200 : 400, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(page),
      })
      response.end(page)
      return
    }
    if (url.pathname === HEALTH_PATH) {
      sendJson(response, 200, { ok: true, authenticated: await oauth.isAuthenticated(), issuer })
      return
    }
    if (url.pathname !== MCP_PATH) {
      sendJson(response, 404, { error: 'not found' })
      return
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        allow: 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
      })
      response.end()
      return
    }
    await forward(request, response)
  }

  server = createServer((request, response) => {
    void route(request, response).catch((error) => {
      log?.error?.(`tenisle: bridge request failed: ${error?.stack ?? error}`)
      if (response.headersSent) response.destroy()
      else
        sendJson(response, 500, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: 'The Tenisle bridge failed.' },
        })
    })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.on('clientError', (_error, socket) => socket.destroy())

  return {
    port,
    async start() {
      if (starting !== undefined) return starting
      starting = new Promise((resolve, reject) => {
        const onError = (error) => reject(new Error(`cannot listen on 127.0.0.1:${port}: ${error.message}`))
        server.once('error', onError)
        server.listen(port, '127.0.0.1', () => {
          server.off('error', onError)
          resolve()
        })
      })
      return starting
    },
    async stop() {
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      if (!server.listening) return
      await new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

function renderPage(ok, message) {
  const title = ok ? 'Tenisle connected' : 'Tenisle sign-in failed'
  const accent = ok ? '#0F7A3D' : '#B3261E'
  const safeMessage = String(message).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; background: #F6F7F4; color: #17211A; }
main { max-width: 34rem; padding: 2.5rem; border-radius: 1rem; background: #FFFFFF; box-shadow: 0 1rem 3rem rgba(15, 122, 61, 0.12); text-align: center; }
h1 { margin: 0 0 0.75rem; font-size: 1.5rem; color: ${accent}; }
p { margin: 0; line-height: 1.6; color: #46524A; }
</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p>${safeMessage}</p>
</main>
</body>
</html>`
}
