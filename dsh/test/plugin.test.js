/**
 * Offline smoke tests for the Tenisle DeepSeek Harness bundle.
 *
 * They cover the pieces that run without Tenisle: the embedded skill
 * registration contract, the credential document, and the loopback bridge's
 * forwarding behavior against a fake upstream MCP server.
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { createBridge } from '../lib/bridge.js'
import { OAuthError, TenisleOAuth } from '../lib/oauth.js'
import { registerSkills } from '../lib/skills.js'
import { CredentialStore } from '../lib/token-store.js'

const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

let nextPort = 62100

function takePort() {
  nextPort += 1
  return nextPort
}

async function temporaryStore() {
  const directory = await mkdtemp(join(tmpdir(), 'tenisle-dsh-'))
  return new CredentialStore({ file: join(directory, 'credentials.json') })
}

/** A fake Tenisle authorization session for the bridge tests. */
function fakeOAuth(overrides = {}) {
  return {
    accessToken: async () => 'access-token-1',
    isAuthenticated: async () => true,
    handleCallback: async () => ({ ok: false, message: 'No Tenisle sign-in is in progress.' }),
    ...overrides,
  }
}

/**
 * Start a fake upstream MCP endpoint.
 *
 * @param {(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, body: string) => void} handler
 * @returns {Promise<{port: number, requests: object[], close: () => Promise<void>}>} running server.
 */
async function startUpstream(handler) {
  const requests = []
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString()
      requests.push({ method: request.method, url: request.url, headers: request.headers, body })
      handler(request, response, body)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    port,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

test('registers both bundled skills with a registry-valid shape', () => {
  const registered = []
  const ctx = {
    skills: {
      register: (skill) => {
        registered.push({
          ...skill,
          invocation: skill.invocation ?? { modelInvocable: true, userInvocable: true },
          provider: skill.provider ?? 'runtime',
        })
        return () => {}
      },
    },
  }
  const dispose = registerSkills(ctx, PACKAGE_DIR)
  assert.equal(registered.length, 2)
  for (const skill of registered) {
    assert.match(skill.name, SKILL_NAME)
    assert.equal(typeof skill.description, 'string')
    assert.ok(skill.description.length > 0)
    assert.equal(typeof skill.content, 'string')
    assert.match(skill.content, /Tenisle/)
    assert.equal(skill.source, 'bundled')
    assert.equal(skill.provider, 'runtime')
    assert.equal(skill.whenToUse === undefined || typeof skill.whenToUse === 'string', true)
    assert.equal(skill.resourceBase.kind, 'directory')
    assert.equal(skill.path, join(skill.resourceBase.path, 'SKILL.md'))
  }
  dispose()
})

test('credential document is created 0600 and reports a usable session', async () => {
  const store = await temporaryStore()
  const tokens = { access_token: 'access', refresh_token: 'refresh', expires_at: Date.now() + 3_600_000 }
  await store.patch({ tokens })
  const oauth = new TenisleOAuth({
    issuer: 'https://tenisle.com',
    redirectUri: 'http://127.0.0.1:1/oauth/callback',
    store,
    allowLogin: false,
  })
  assert.equal(await oauth.isAuthenticated(), true)
  assert.equal(await oauth.accessToken(), 'access')
  if (process.platform !== 'win32') {
    const mode = (await stat(store.file)).mode & 0o777
    assert.equal(mode, 0o600)
  }
})

test('an expired token without a reachable token endpoint fails as an OAuth error', async () => {
  const store = await temporaryStore()
  await store.patch({ tokens: { access_token: 'expired', refresh_token: 'refresh', expires_at: Date.now() - 1000 } })
  const oauth = new TenisleOAuth({
    issuer: 'https://127.0.0.1:1',
    redirectUri: 'http://127.0.0.1:1/oauth/callback',
    store,
    allowLogin: false,
  })
  await assert.rejects(() => oauth.accessToken(), OAuthError)
})

test('bridge answers health, rejects unknown paths, and demands authentication', async (t) => {
  const port = takePort()
  const bridge = createBridge({ port, issuer: 'https://tenisle.example', oauth: fakeOAuth() })
  await bridge.start()
  t.after(() => bridge.stop())

  const health = await fetch(`http://127.0.0.1:${port}/health`)
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { ok: true, authenticated: true, issuer: 'https://tenisle.example' })

  const missing = await fetch(`http://127.0.0.1:${port}/nowhere`)
  assert.equal(missing.status, 404)

  const unauthorizedPort = takePort()
  const unauthorized = createBridge({
    port: unauthorizedPort,
    issuer: 'https://tenisle.example',
    oauth: fakeOAuth({
      accessToken: async () => {
        throw new OAuthError('Tenisle authentication required')
      },
      isAuthenticated: async () => false,
    }),
  })
  await unauthorized.start()
  t.after(() => unauthorized.stop())

  const denied = await fetch(`http://127.0.0.1:${unauthorizedPort}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  })
  assert.equal(denied.status, 401)
  const payload = await denied.json()
  assert.equal(payload.error.code, -32001)
  assert.match(payload.error.message, /authentication required/i)
})

test('bridge injects the Bearer token and forwards JSON responses', async (t) => {
  const upstream = await startUpstream((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'session-1' })
    response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'fake' } } }))
  })
  t.after(() => upstream.close())

  const port = takePort()
  const bridge = createBridge({ port, issuer: `http://127.0.0.1:${upstream.port}`, oauth: fakeOAuth() })
  await bridge.start()
  t.after(() => bridge.stop())

  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'mcp-session-id': 'session-0' },
    body,
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('mcp-session-id'), 'session-1')
  assert.deepEqual(await response.json(), { jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'fake' } } })

  const forwarded = upstream.requests.at(-1)
  assert.equal(forwarded.method, 'POST')
  assert.equal(forwarded.url, '/mcp')
  assert.equal(forwarded.headers.authorization, 'Bearer access-token-1')
  assert.equal(forwarded.headers['mcp-session-id'], 'session-0')
  assert.equal(forwarded.body, body)
})

test('bridge streams an SSE response back to the client', async (t) => {
  const upstream = await startUpstream((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
    response.write('event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n')
    setTimeout(() => {
      response.write('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{}}\n\n')
      response.end()
    }, 20)
  })
  t.after(() => upstream.close())

  const port = takePort()
  const bridge = createBridge({ port, issuer: `http://127.0.0.1:${upstream.port}`, oauth: fakeOAuth() })
  await bridge.start()
  t.after(() => bridge.stop())

  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/event-stream/)
  const text = await response.text()
  assert.equal(text.match(/data: /g)?.length, 2)
  assert.match(text, /notifications\/progress/)
})

test('bridge refreshes the token once when the upstream answers 401', async (t) => {
  let attempts = 0
  const upstream = await startUpstream((_request, response) => {
    attempts += 1
    if (attempts === 1) {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'invalid_token' }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ jsonrpc: '2.0', id: 3, result: { ok: true } }))
  })
  t.after(() => upstream.close())

  const tokens = ['stale-token', 'fresh-token']
  const requested = []
  const port = takePort()
  const bridge = createBridge({
    port,
    issuer: `http://127.0.0.1:${upstream.port}`,
    oauth: fakeOAuth({
      accessToken: async (options) => {
        requested.push(options ?? {})
        return tokens.shift()
      },
    }),
  })
  await bridge.start()
  t.after(() => bridge.stop())

  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { jsonrpc: '2.0', id: 3, result: { ok: true } })
  assert.equal(upstream.requests[0].headers.authorization, 'Bearer stale-token')
  assert.equal(upstream.requests[1].headers.authorization, 'Bearer fresh-token')
  assert.deepEqual(requested.at(-1), { forceRefresh: true })
})

test('bridge renders a failure page for an unexpected OAuth callback', async (t) => {
  const port = takePort()
  const bridge = createBridge({ port, issuer: 'https://tenisle.example', oauth: fakeOAuth() })
  await bridge.start()
  t.after(() => bridge.stop())

  const response = await fetch(`http://127.0.0.1:${port}/oauth/callback?code=abc&state=xyz`)
  assert.equal(response.status, 400)
  assert.match(await response.text(), /No Tenisle sign-in is in progress/)
})
