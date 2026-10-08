# Save the Train: v2 amendments

These amendments extend `2026-10-08-save-the-train-design.md`. Where the two disagree, **this file wins**. Everything else in the original spec still applies.

## A. Guest list format (Google Sheet tab `Guests`)

Saumy maintains these columns. Row 1 is the header.

| Col | Header | Example | Meaning |
|---|---|---|---|
| A | Names | `Rahul Sharma & Priya Sharma` / `Ananya Iyer` / `Mr & Mrs Agarwal` | One invitation unit (shown as the ticket label) |
| B | M/F | `M, F` / `F` / `M, F` | Gender per name in A, in the same order |
| C | Plus-one | `Y` / `N` | Whether the unit may bring one extra guest |
| D | Plus-one name | `Kavya` (optional) | Pre-fills the added guest's name |
| E | Couple | `Y` / `N` | `Y` means both names in A are Saumy's friends, and both get the link |
| F | List | `Primary` / `Secondary` | Invite wave. It's used for reporting only, and both lists can RSVP |
| G | Nicknames | `Annu, Ani` (optional) | Extra search terms |
| H | ID | auto | The script fills it with a unique 4-char slug |

**Parsing rules** (implemented in Apps Script, and mirrored by the mock data):

- **Splitting names in A:** split on `&`, `,`, ` and ` and `/`, then trim each name.
- **Title shorthand:** `Mr & Mrs X` (also with `Mr.`, `Mrs.`, `Ms`, `Dr`) expands to `Mr X` and `Mrs X`.
- **Genders from B:** split on commas, spaces and `&`, and keep only `M`/`F` (upper-cased) aligned to the names. If a gender is missing, infer it from a title (`Mr` gives M; `Mrs`/`Ms` give F), otherwise leave it empty.
- **`max_guests`** is `names.length + (C === 'Y' ? 1 : 0)`, capped at 4.
- **D:** when present and C is Y, the plus-one name is pre-filled as an added guest with an empty gender.
- **Defaults:** blank E means N, and blank F means Primary.

**Lookup record returned to the client:**

```
{ id, label, names:[...], genders:['M'|'F'|''...], max_guests, couple:boolean, list:'Primary'|'Secondary',
  plus_one_name:string|null, booked: null | { filled_by:string, updated_at:ISO, payload:<last rsvp payload> } }
```

`booked` is the latest saved response for that `id`, so a partner, or the same person on a different device, sees the existing ticket instead of creating a duplicate.

## B. Forgiving name search

There are two pure functions in `js/logic.js`, mirrored in `Code.gs`:

- `normalizeName(s): string`: lower-case, strip diacritics (NFD), replace any non-letter/space with a space, collapse spaces, and trim.
- `matchScore(query, {label, names, aliases}): number`, defined below.
  - **Query words:** the normalised query words of 2 or more chars, excluding the stop words `mr, mrs, ms, dr, smt, shri, and, the`. If the query has fewer than 3 letters in total, or no words, the score is 0.
  - **Candidate words:** the normalised words of the label, names and aliases (deduplicated, stop words removed). Each alias also counts as a whole word with its spaces removed.
  - **Per query word**, take the best of:
    - exact match = **3**
    - query word is a prefix of the candidate word (query word ≥ 3 chars) = **2**
    - fuzzy match = **1**. This uses optimal-string-alignment (Damerau) distance: at most 1 when the query word has 4–7 chars, at most 2 when it has 8 or more, and never for words under 4 chars.
    - otherwise 0.
  - `matched` = the number of query words with a score above 0, and `score` = the sum of the best scores.
  - **Return 0** unless `matched ≥ 1` and `score ≥ (queryWords === 1 ? 1 : 2)`. Otherwise return `score + matched * 0.1`. This lets unexpected middle names and extra words through while ranking fuller matches higher.
  - **Concatenated names:** if the query has no spaces and equals the concatenation of a name's words (e.g. `rahulsharma`), the score is 6.
- `searchGuests(query, entries, limit = 5): [{id, label, score}]`: sorted by score descending, then label ascending, keeping only scores > 0.
- `matchesQuery(q, label, names)` stays as a thin wrapper: `matchScore(q, {label, names, aliases: []}) > 0`.

**UI copy for the search box:** label "Who's boarding?", placeholder "Type your first or full name", and helper text "First name is enough. Spelling slips are okay."

## C. Already-booked tickets and couples

- `payload.filled_by` holds the name from the record's `names` that best matched the guest's search query. Use `matchScore` per name, and fall back to `names[0]` or the label. For unlisted guests it's the entered name. If the guest arrived via `?g=` with no query, use `names[0]`.
- When `getGuest` returns `booked`, the app pre-fills all state from `booked.payload` and shows a banner on the passengers stop:
  - For couples (`couple: true`) where `filled_by` differs from the person searching now: "Priya already booked seats for you both on Fri 9 Oct. Check the details or make changes."
  - Otherwise: "Your seats are already booked (updated Fri 9 Oct). Check the details or make changes."
  - Also offer a "View my pass" shortcut that jumps straight to the junction.
- Submitting again replaces the previous response (latest wins), as before.

## D. Gender per guest and the riders animation

- **Gender field:** each guest object becomes `{ name, status, gender }`, where `gender` is `'M' | 'F' | ''`. List guests get it from the record. Added guests show a compact **M / F** segmented toggle (labels "M" and "F", accessible names "Male" and "Female"). It defaults to the opposite of guest 1's gender, or `''` if unknown.
- **Validation:** `validatePayload` accepts `gender` in `['M','F','']` (an optional field; reject other values). `buildPayload` passes `gender` through, defaulting to `''`.
- **Riders:** the vehicle on the sticky journey track carries **up to 2** rider busts, `assets/bobble/guest-m-bust.webp` or `guest-f-bust.webp`, peeking out of its windows.
  - Riders are the first two guests whose status is not `regret`. If no statuses are chosen yet, use the first two guests.
  - A `''` gender uses `M` for rider 1 and `F` for rider 2.
  - **Never show more than 2 riders.**
  - Riders update live: hop in with a small bounce when a guest is added or confirmed, and hop out when they regret.
- **Pure helper in logic.js:** `ridersFor(guests): ('M'|'F')[]` (length 0–2), unit-tested.

## E. Real bobbleheads (already exported to `assets/bobble/`)

- **Figures and wobble:** `saumy-{full,head,body}.webp` and `manorika-{full,head,body}.webp` are 900px tall, and each head and body pair share the same canvas size. For the wobble, stack body then head (both `position:absolute; inset:0; height:100%`) and rotate the head around the pivot from `assets/bobble/meta.json`. Saumy's pivot is `49.64% 29.52%` and Manorika's is `45.96% 24.88%`. Keep the wobble between ±3° and ±4° with a spring-like ease, desync the two heads, and use reduced motion for a static figure.
- **Busts:** `saumy-bust.webp` and `manorika-bust.webp` are for the mini station board in the journey bar and the boarding pass (`heads.a`, `heads.b`). `guest-m-bust.webp` and `guest-f-bust.webp` are for the riders.
- **Junction stop:** both full figures stand beside the BHILWARA station board. Saumy does a namaste, Manorika waves, and their heads wobble. Petals fall.
- **Regret-end stop:** the same figures with their heads tilted down and to the side about 8°, with a slow and small wobble.
- **Platform cover:** the two busts peek over the top edge of the ticket (a small delight). Keep it tasteful.
- **Placeholders:** remove the old placeholder `assets/couple/*.svg` from the UI (they can stay as fallbacks in `pass.js` only if the image fails to load).
- **Credits:** none needed on the page.

## F. Config

- `CONFIG.hostWhatsApp = '919414087162'`.
- `CONFIG.lists = ['Primary','Secondary']` (for display only).

## G. Sheets and Summary (Apps Script)

- **`People` columns:** `id, label, list, couple, person, gender, status, mode, from, arrive_date, arrive_slot, depart_date, depart_slot, note, filled_by, updated_at, unlisted`.
- **`Summary` additions:** people counts by status × list (Primary, Secondary, Unlisted); number of invitation units that have responded vs. not responded, per list (the not-responded list of labels helps with follow-ups); and the existing per-night presence and arrival/departure tables (unchanged).
- **`Responses`** stays an append-only log.
- **Lookup speed:** `find` should cache the parsed guest list in `CacheService` for 60s, so search stays fast. Invalidate the cache from an `onEdit` trigger, or simply let it expire.

## H. Mock data (api.js)

Replace `MOCK_GUESTS` with records in the new shape, covering:
- a couple flagged Y: "Rahul Sharma & Priya Sharma", M,F, max 2, Primary;
- a single with a plus-one: "Ananya Iyer", F, plus-one Y with plus-one name "Kavya", alias "Annu", max 2, Primary;
- a title couple: "Mr & Mrs Agarwal", M,F, max 2, Secondary;
- a single with no plus-one: "Kabir Khan", M, max 1, Primary;
- a middle-name case: "Rohan Mehta", M, plus-one N, Primary. A search for "Rohan Kumar Mehta" must find it.

Mock `getGuest` returns `booked` from the mock responses in localStorage.
