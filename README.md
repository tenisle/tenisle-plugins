# Tenisle plugins for AI assistants

Use [Tenisle](https://tenisle.com) with your AI assistant: ask about tennis
stats, match history, head-to-head records and league standings, and enter or
approve league match scores in normal conversation. Both integrations talk to
the same Tenisle MCP server at `https://tenisle.com/mcp` with your own Tenisle
account.

## Claude

Install in Claude Code:

```
/plugin marketplace add tenisle/tenisle-plugins
/plugin install tenisle@tenisle
```

See [plugins/tenisle/README.md](plugins/tenisle/README.md) for features and usage.

## DeepSeek Harness

Install the bundle package in [`dsh/`](dsh/) with the Harness plugin manager.
The bundle inserts a Host plugin that keeps your Tenisle OAuth session and a
loopback MCP bridge, plus the shipped MCP client row that exposes the Tenisle
tools as `mcp__tenisle__*`. The first MCP connection opens your browser for a
Tenisle sign-in.

See [dsh/README.md](dsh/README.md) for install steps, configuration and limits.

To share it, point the other person at this repository: the bundle installs
straight from Git
(`git+https://github.com/tenisle/tenisle-plugins.git#<commit>&path:/dsh`), or
through the Tenisle market index
(`https://cdn.jsdelivr.net/gh/tenisle/tenisle-plugins@main/dsh/market/index.json`,
added in Settings → Plugins → Experimental → Custom plugin market → Discover).
Each person signs in with their own Tenisle account.

## Layout

| Path | Platform | Contents |
|---|---|---|
| `plugins/tenisle/` | Claude Code / Claude apps | Claude plugin: MCP connector (`.mcp.json`) and two skills |
| `dsh/` | DeepSeek Harness | DSH bundle: Host plugin (OAuth session + MCP bridge) and two skills |
| `.claude-plugin/marketplace.json` | Claude Code | Marketplace entry that points at `plugins/tenisle` |

## License

MIT — see [LICENSE](LICENSE).
