# Tenisle Plugin

Use [Tenisle](https://tenisle.com) with Claude. Ask about your tennis stats,
match history, head-to-head records and league standings, and enter or
approve league match scores in normal conversation.

Claude replies in the language you write in (for example Turkish or English).

## Components

| Component | Name | Purpose |
|---|---|---|
| Skill | `player-stats` | Profile stats, match history, head-to-head, standings, achievements (read-only) |
| Skill | `score-entry` | Find matches without a score, submit a score, approve or reject an opponent's score |
| MCP server | `tenisle` | Connects Claude to Tenisle at `https://tenisle.com/mcp` |

## Setup

1. Install the plugin.
2. Connect the Tenisle connector and log in with your own Tenisle account.
   No API keys or environment variables are necessary.

Claude can only see and change what your Tenisle account can see and change.

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

A score changes a shared match record and can notify other players.
Claude always shows the full score and asks for your confirmation before it
submits, approves, rejects or clears a score.

## Limits in version 0.1.0

- Tournament scores are not supported (they need club admin rights).
- Club, league and tournament management are not included yet.
