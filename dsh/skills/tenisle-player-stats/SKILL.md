---
name: tenisle-player-stats
description: Use when the user asks about tennis data on Tenisle — their own or another player's stats, win rate, recent or upcoming matches, head-to-head records, league standings or trophies ("show my stats", "istatistiklerim", "son maçlarım", "Ahmet'le aramızdaki rekabet", "ligde kaçıncıyım", "puan durumu", "kupalarım").
whenToUse: The user wants to read Tenisle player data (their own or another player's) through the connected Tenisle MCP tools.
metadata:
  version: "0.1.0"
---

# Tenisle Player Stats

Answer questions about Tenisle players, matches, standings and achievements
with the connected Tenisle MCP tools. Everything in this skill is read-only.

## Find the tools

Tenisle tools are exposed as `mcp__tenisle__<tool>`, for example
`mcp__tenisle__get_my_profile`. If no `mcp__tenisle__*` tool is listed, the
Tenisle account is not connected: tell the user the Tenisle plugin needs a
browser sign-in and that the sign-in link is in the harness log. Do not guess
data.

## Language

- Reply in the language the user writes in.
- Tenisle returns Turkish field names and labels. Translate them into the
  user's language. Keep proper names (players, clubs, leagues, courts) as they are.

## Identify the current user and their clubs

Call `mcp__tenisle__get_me` once per conversation when a club ID or the user's
own ID is needed. It returns the user profile and club memberships. Reuse the
result; do not call it again for every question.

## Resolve player names to IDs

Users name players; tools need user IDs.

1. Take the club IDs from `mcp__tenisle__get_me`.
2. Call `mcp__tenisle__search_club_players` with each club ID and the name
   (at least 2 characters).
3. If one player matches, use that ID.
4. If several players match, list them (name and club) and ask the user to pick one.
5. If no player matches, say so and ask for another spelling or the club name.

Never guess an ID. Never show raw UUIDs unless the user asks for them.

## Pick the right tool

| Question | Tool | Notes |
|---|---|---|
| My overall stats, streaks, tie-break %, comebacks, upcoming matches | `mcp__tenisle__get_my_profile` | Same data as the Tenisle profile page |
| Another player's stats | `mcp__tenisle__get_player_profile` (userId) | Public data only |
| Match history or upcoming matches | `mcp__tenisle__list_my_matches` | Filters: `status` (upcoming, completed, awaiting_approval, cancelled), `source` (league, tournament), `discipline` (singles, doubles), `opponentUserId`, `eventId`, `limit` (default 25, max 200), `userId` for another player |
| Rivalry between two players | `mcp__tenisle__get_head_to_head` (otherUserId, optional userId) | Default compares the current user with otherUserId |
| My position in leagues and tournaments | `mcp__tenisle__list_my_events` | `status`: ongoing or completed. Includes rank, nearby table and playoff projection |
| Full league table | `mcp__tenisle__get_league_standings` | Use league and club IDs from `list_my_events` |
| Trophies and season summaries | `mcp__tenisle__get_my_achievements` | 1st, 2nd and 3rd places |

Make the fewest calls that answer the question. Do not fetch the full
profile when the user asks only for the last three matches.

## Read the data correctly

- In `mcp__tenisle__list_my_matches`, `score` is from the player's point of
  view. `rawScore` uses the official home/away order and `isHome` tells which
  side the player was. Use `score` when you describe results to the player.
- All times are ISO 8601 in UTC. Convert to the user's local time when it
  is known; otherwise state that the time is UTC.
- `winRatePercent` is null when a player has played fewer than 5 matches.
  Say that the rate shows after 5 matches; do not show 0%.
- Events from unlisted clubs are hidden on other players' profiles. Do not
  speculate about missing data.

## Present results

- Start with a one or two sentence answer, for example the win-loss record.
- Use a table for match lists: date, event, opponent, score, result.
- For head-to-head, give the win count first, then sets and games, then the
  most recent matches.
- For standings, show the rows near the user and mark the user's row.
- Offer one useful next step only when it is natural, for example
  "Do you want to enter the score for your match on Friday?" when
  `list_my_events` or the profile shows a played match without a score.
  The `tenisle-score-entry` skill handles score actions.

## Errors

If a tool returns an access or permission error, tell the user in plain
words that Tenisle does not allow this data to be shown. If the tool reports
`Authentication required`, the session needs a new sign-in; tell the user how
to reconnect instead of retrying the same call.
