# Score Format for submit_league_match_score

## Score object

```json
{
  "sets": [ { "home": 6, "away": 4 } ],
  "walkover": "home | away",
  "retired": "home | away",
  "defaulted": "home | away",
  "notes": "optional text, max 500 characters"
}
```

- `sets` is required for `action: "submit"`. Order: as played. Maximum 5 sets.
- With `perspective: "mine"`: `home` = the user's side, `away` = the opponent.
- `walkover`: the side that did not come to the match (that side loses).
- `retired`: the side that stopped because of injury (that side loses).
- `defaulted`: the side that was disqualified (that side loses).
- Use only one of `walkover`, `retired`, `defaulted`.

## Set fields

| Field | Meaning |
|---|---|
| `home`, `away` | Games won in the set (or points in a super tie-break) |
| `kind` | `"regular"` (default) or `"super_tiebreak"` for a deciding match tie-break |
| `tiebreak` | Points of the player who LOST the tie-break, e.g. 4 for 7-6(4) |
| `tiebreakDetail` | Optional full tie-break points `{ "home": 7, "away": 4 }` |

## Examples (perspective "mine")

User won 6-4 6-3:
```json
{ "sets": [ { "home": 6, "away": 4 }, { "home": 6, "away": 3 } ] }
```

User lost 6-4 6-3 (winner's games written first, so flip):
```json
{ "sets": [ { "home": 4, "away": 6 }, { "home": 3, "away": 6 } ] }
```

User won 7-6(5) 6-7(3) 10-8 with a super tie-break:
```json
{ "sets": [
  { "home": 7, "away": 6, "tiebreak": 5 },
  { "home": 6, "away": 7, "tiebreak": 3 },
  { "home": 10, "away": 8, "kind": "super_tiebreak" }
] }
```

Opponent did not come (user wins by walkover):
```json
{ "sets": [], "walkover": "away" }
```

Opponent retired at 6-3 2-1:
```json
{ "sets": [ { "home": 6, "away": 3 }, { "home": 2, "away": 1 } ], "retired": "away" }
```

## Parsing user text

| User writes | Interpretation |
|---|---|
| `6-4 3-6 10-7` | Third set is a super tie-break when it ends at 10 or more with a 2-point lead |
| `7-6(4)` or `7-6 (4)` | Tie-break; 4 = loser's tie-break points |
| `7-6 7/4` | Tie-break; full points 7-4 → `tiebreak: 4` |
| `w/o`, `walkover`, `hükmen`, `rakip gelmedi` | Walkover |
| `ret`, `retired`, `sakatlık`, `çekildi` | Retired |
| `diskalifiye` | Defaulted |

If the text fits more than one reading, ask the user. Do not guess.
