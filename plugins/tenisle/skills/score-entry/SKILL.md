---
name: score-entry
description: >
  This skill should be used when the user wants to enter, send, approve,
  reject or clear a Tenisle league match score, or asks which matches still
  need a score: "enter my score", "I beat Ahmet 6-4 6-3", "I lost 4-6 6-7(5)",
  "which matches have no score", "approve the score", "reject the score",
  "walkover", "my opponent retired", or Turkish equivalents such as
  "skor gir", "Ahmet'i 6-4 6-3 yendim", "skoru girilmemiş maçlarım",
  "skoru onayla", "skoru reddet", "rakip gelmedi", "rakip sakatlandı".
metadata:
  version: "0.1.0"
---

# Tenisle Score Entry

Enter and manage league match scores on Tenisle. Every action in this skill
changes a shared match record and can send notifications to other players.
Accuracy and explicit confirmation come before speed.

## Language

Reply in the language the user writes in. Translate Tenisle's Turkish labels.

## Scope

- Supported: league matches through `submit_league_match_score` with the
  actions `submit`, `approve`, `reject`, `clear`.
- Not supported in this version: tournament match scores. They need club
  admin rights (`update_tournament_match_score`). Tell the user to enter
  tournament scores on the Tenisle website or ask a club admin.

## Step 1: Find the match

- Matches without a score: call `list_matches_missing_score`.
- Scores waiting for the user's approval: call `list_my_matches` with
  `status: "awaiting_approval"`.
- Match the user's words (opponent name, date, league) to one match.
- If several matches fit, list them (date, league, opponent) and ask which one.
- If none fit, say so. Do not create or guess a match.
- Keep `leagueId` and `matchId` from the result. Never ask the user for IDs.

## Step 2: Understand the score

Read `references/score-format.md` for the full conversion rules and JSON
examples. Key rules:

- Use `perspective: "mine"` (default) when the user played in the match.
  Then `home` = the user's side and `away` = the opponent.
- Use `perspective: "home"` only when the user enters a score for a match
  they did not play (club or league admin). Then use the official
  `homeParticipant` / `awayParticipant` from `list_league_matches`.
- Users often write the winner's games first ("I lost 6-4 6-3"). If the
  stated result (won/lost) and the numbers disagree, flip the numbers so they
  fit the stated result, and show this in the confirmation.
- If the user does not say who won and the order is unclear, ask.
- Check that each set is plausible: 6-0 to 6-4, 7-5, 7-6 with a tie-break,
  super tie-break to at least 10 with a two-point lead, at most 5 sets.
  Clubs can use other formats (for example pro sets to 8). If a set looks
  unusual, ask the user to confirm it; do not reject it.

## Step 3: Confirm before every action

Before calling `submit_league_match_score`, show a short summary and wait
for an explicit yes:

- League and match date
- Opponent name
- Score from the user's point of view, for example "6-4, 3-6, 10-7 (super tie-break)"
- Result: won or lost, or walkover / retired / defaulted
- Any note the user added
- What happens next:
  - Player submits: the opponent must approve the score.
  - Club or league admin submits: the score is approved directly.
  - Reject: the opponent's score is removed from approval; offer to submit the correct score.
  - Clear (admin only): the score is deleted.

Do not send anything if the answer is not a clear yes. If the user corrects
the score, show the new summary and ask again.

When the user gives several scores at once, show all of them in one list and
ask for one confirmation for the whole list. Send them one by one and report
each result.

## Step 4: Approve or reject an opponent's score

1. Show the score the opponent submitted, from the user's point of view.
2. Ask: approve or reject?
3. Call `submit_league_match_score` with `action: "approve"` or `action: "reject"`.
   No `score` object is needed.
4. After a reject, offer to submit the correct score.

## Step 5: Report the result

- Success: state the new status in one sentence ("Sent. Ahmet must approve it.").
- Error: explain it in plain words. Common causes: the match already has a
  score, the user is not a player or admin in this league, or the score is
  invalid. Do not retry with changed data without asking the user.

## Never

- Never send, approve, reject or clear a score without explicit confirmation.
- Never use `clear` unless the user asks to delete a score and is an admin.
- Never invent sets, tie-break points or notes the user did not give.
