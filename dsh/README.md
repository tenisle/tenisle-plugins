# Tenisle for DeepSeek Harness

Use [Tenisle](https://tenisle.com) inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
Ask about your tennis stats, match history, head-to-head records and league
standings, and enter or approve league match scores in normal conversation.
The agent replies in the language you write in (for example Turkish or English).

This package is the DeepSeek Harness counterpart of the Claude plugin in
[`../plugins/tenisle`](../plugins/tenisle). It ships the same two skills plus a
connection to the same Tenisle MCP server.

## Components

| Component | Name | Purpose |
|---|---|---|
| Skill | `tenisle-player-stats` | Profile stats, match history, head-to-head, standings, achievements (read-only) |
| Skill | `tenisle-score-entry` | Find matches without a score, submit a score, approve or reject an opponent's score, clear a score (admins) |
| Host plugin | `tenisle` | Keeps your Tenisle account session and serves a loopback MCP bridge to `https://tenisle.com/mcp` |
| MCP server | `mcp__tenisle__*` | The Tenisle MCP tools, registered by the shipped MCP client through that bridge |

## Why a bridge

`https://tenisle.com/mcp` requires an OAuth 2.1 access token, while the shipped
`@deepseek-ai/dsh-mcp-client` supports static headers only. This plugin owns the
account session instead: it registers a public client with Tenisle's dynamic
client registration, runs the authorization-code + PKCE flow in your browser,
keeps the refresh token, and forwards each MCP request with a fresh Bearer
token over a loopback-only HTTP bridge (`127.0.0.1:61980`). The shipped MCP
client then behaves exactly as it does for any other Streamable HTTP server —
tool naming, discovery, reconnection, and resources all stay native.

## Install

The bundle is a normal DSH bundle: it declares `dsh.bundle.patch`, ships no
build step, and imports only Node built-ins.

- **DeepSeek Harness desktop:** install the bundle from this `dsh/` directory
  with the plugin manager in Settings → Plugins.
- **From a Harness session:** call the plugin manager's `install_bundle`
  action with the absolute path of this `dsh/` directory.
- **Published package:** publish this directory to npm, then install that
  package spec the same way.

The bundle inserts two rows:

| Row id | Plugin | Role |
|---|---|---|
| `tenisle` | `@tenisle/dsh-plugin` | OAuth session, loopback bridge, bundled skills |
| `tenisle-mcp` | `@deepseek-ai/dsh-mcp-client` | MCP client connected to `http://127.0.0.1:61980/mcp` |

Row configuration:

| Field | Default | Meaning |
|---|---|---|
| `issuer` | `https://tenisle.com` | Tenisle origin used for discovery, registration and the MCP endpoint |
| `port` | `61980` | Loopback port for the MCP bridge and the OAuth redirect |
| `stateDir` | `$DSH_HOME/tenisle` | Directory of the credential document |
| `autoLogin` | `true` | Start the browser sign-in when no usable token exists |
| `openBrowser` | `true` | Open the sign-in URL automatically; the URL is always logged |

## First run

1. Install the bundle and restart the Harness Host if the plugin manager asks for it.
2. The first MCP connection needs an access token, so the plugin opens your
   browser on Tenisle's sign-in page. The same URL is logged, for example:
   `tenisle: sign in to Tenisle to finish connecting: https://tenisle.com/oauth/authorize?...`
3. Sign in with your own Tenisle account and approve the connection. The
   callback page confirms it.
4. The tools appear as `mcp__tenisle__*` once the connection succeeds. The MCP
   client retries while the sign-in is pending, so no manual reload is needed
   when you finish within a few minutes.

Access tokens last one hour; the plugin refreshes them silently. Refresh tokens
last 30 days and rotate on every refresh, so a working installation stays
connected as long as you use it.

## Usage examples

Player stats:

- "Show my stats" / "İstatistiklerimi göster"
- "My last 10 singles matches" / "Son 10 tekler maçım"
- "Head-to-head with Ahmet" / "Ahmet'le aramızdaki rekabet"
- "Where am I in the league?" / "Ligde kaçıncıyım?"

Score entry:

- "Which matches have no score?" / "Skoru girilmemiş maçlarım hangileri?"
- "I beat Mehmet 6-4 3-6 10-7" / "Mehmet'i 6-4 3-6 10-7 yendim"
- "My opponent did not come" / "Rakip gelmedi"
- "Approve the score from Ali" / "Ali'nin girdiği skoru onayla"

## Safety

A score changes a shared match record and can notify other players. The
`tenisle-score-entry` skill always shows the full score and asks for explicit
confirmation before it submits, approves, rejects or clears a score.

Credentials never leave the machine except as the Bearer token sent to
`tenisle.com`: the OAuth client registration and the token set live in
`$DSH_HOME/tenisle/credentials.json` (`0600`), and the bridge listens on
`127.0.0.1` only. The plugin can see and change exactly what your Tenisle
account can see and change.

## Limits in version 0.1.0

- Tournament scores are not supported (they need club admin rights).
- Club, league and tournament management are not included yet.
- The loopback bridge uses a fixed local port (`61980` by default); changing
  the OAuth redirect means the plugin registers a new public client.

## Development

The bundle has no build step and no dependency install for normal use. Its
offline smoke tests exercise the skill registration contract, the credential
document, and the loopback bridge against fake MCP upstreams:

```bash
cd dsh
npm test
```

## Layout

```
dsh/
├── package.json          bundle manifest and display exports
├── cordis.patch.yml      the two inserted rows
├── index.js              Host plugin entry (session, bridge, skills)
├── lib/
│   ├── oauth.js          dynamic registration, PKCE login, refresh rotation
│   ├── bridge.js         loopback Streamable HTTP bridge and OAuth callback
│   ├── skills.js         embedded skill registration
│   └── token-store.js    atomic 0600 credential document
├── skills/               the two bundled skills
├── test/                 offline smoke tests
├── locale/               display metadata (en, tr)
└── icon.svg              plugin icon
```
