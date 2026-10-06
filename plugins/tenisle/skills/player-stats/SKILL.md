---
name: player-stats
description: >
  This skill should be used when the user asks about their own or another
  player's tennis data on Tenisle: "show my stats", "my win rate", "my last
  matches", "how did I do against Ahmet", "head-to-head with Mehmet",
  "where am I in the league", "league standings", "my upcoming matches",
  "my trophies", or Turkish equivalents such as "istatistiklerim",
  "son maçlarım", "Ahmet'le aramızdaki rekabet", "ligde kaçıncıyım",
  "puan durumu", "yaklaşan maçlarım", "kupalarım".
metadata:
  version: "0.1.0"
---

# Tenisle Player Stats

Answer questions about Tenisle players, matches, standings and achievements
with the Tenisle connector. All data is read-only in this skill.

## Language

- Reply in the language the user writes in.
- Tenisle returns Turkish field names and labels. Translate them into the
  user's language. Keep proper names (players, clubs, leagues, courts) as they are.

## Identify the current user and their clubs

Call `get_me` once per conversation when a club ID or the user's own ID is
needed. It returns the user profile and club memberships. Reuse the result.

## Resolve player names to IDs

Users name players; tools need user IDs.

1. Take the club IDs from `get_me`.
2. Call `search_club_players` with each club ID and the name (at least 2 characters).
3. If one player matches, use that ID.
4. If several players match, list them (name and club) and ask the user to pick one.
5. If no player matches, say so and ask for another spelling or the club name.

Never guess an ID. Never show raw UUIDs unless the user asks for them.

## Pick the right tool

| Question | Tool | Notes |
|---|---|---|
| My overall stats, streaks, tie-break %, comebacks, upcoming matches | `get_my_profile` | Same data as the Tenisle profile page |
| Another player's stats | `get_player_profile` (userId) | Public data only |
| Match history or upcoming matches | `list_my_matches` | Filters: `status` (upcoming, completed, awaiting_approval, cancelled), `source` (league, tournament), `discipline` (singles, doubles), `opponentUserId`, `eventId`, `limit` (default 25, max 200), `userId` for another player |
| Rivalry between two players | `get_head_to_head` (otherUserId, optional userId) | Default compares the current user with otherUserId |
| My position in leagues and tournaments | `list_my_events` | `status`: ongoing or completed. Includes rank, nearby table and playoff projection |
| Full league table | `get_league_standings` | Use league and club IDs from `list_my_events` |
| Trophies and season summaries | `get_my_achievements` | 1st, 2nd and 3rd places |

Make the fewest calls that answer the question. Do not fetch the full
profile when the user asks only for the last three matches.

## Read the data correctly

- In `list_my_matches`, `score` is from the player's point of view.
  `rawScore` uses the official home/away order and `isHome` tells which side
  the player was. Use `score` when you describe results to the player.
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
  The score-entry skill handles score actions.

## Errors

If a tool returns an access or permission error, tell the user in plain
words that Tenisle does not allow this data to be shown. If the connector is
not authenticated, ask the user to connect their Tenisle account.
