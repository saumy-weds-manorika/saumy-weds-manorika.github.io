# Save the Train: v2 amendments

These amendments extend `2026-10-08-save-the-train-design.md`. Where the two disagree, **this file wins**. Everything else in the original spec still applies.

## A. Guest list format: Saumy's real workbook (replaces the earlier template)

Saumy keeps the list in their own workbook format. Saumy uploads `Wedding Invites.xlsx` to Google Drive and opens it as a Google Sheet. The script must read **exactly that format**:

- **Two tabs:** `First List` maps to list **Primary**, and `Second List` maps to list **Secondary**. Find tabs by name, case- and space-insensitively. A tab whose name contains "first" or "primary" is Primary, and one containing "second" or "secondary" is Secondary.
- **Header row 1** in each tab:

| Col | Header (as in Saumy's file) | Values |
|---|---|---|
| A | `Guest 1` | Full name of the invited friend, e.g. `Meera Kapoor` |
| B | `Gender Guest 1` | `M` / `F` |
| C | `Guest 2` | A partner's name (`Dev Malhotra`, `Tara`), **or** `Mrs` / `Mr` / `Ms` (an invited partner whose name isn't known), **or** `NA` / blank (no partner invited) |
| D | `Gender Guest 2` | `M` / `F` / `NA` |
| E | `Both Primary?` | `Y` means both are Saumy's friends and both may get the link (a couple). `N` means guest 2 is guest 1's partner. `NA` means there's no guest 2 |
| F | `Nicknames` | Optional. The script adds this header if it's missing. Comma-separated extra search terms |
| G | `ID` | Auto. `setup()` and `generateIds()` fill it with a unique 4-char base36 slug, unique across both tabs |

**Parsing** (Apps Script). Trim every cell. Treat `NA`, `N/A`, `-` and blank as empty, case-insensitively.

- **Partner type** (from C):
  - Empty: no partner slot.
  - A title (`Mr`, `Mrs`, `Ms`, `Mr.` or `Mrs.`): an **unnamed partner** slot `{ title, gender }`. Gender comes from D, or from the title if D is empty (Mr gives M; Mrs/Ms give F).
  - Anything else: a **named partner**.
- **`names`** is guest 1 plus the named partner (if any). These are the people whose names are known. **`genders`** are aligned to `names`, each `'M'`, `'F'` or `''`.
- **`partner`** is `{ title, gender }` for an unnamed partner, or `null`.
- **`label`**, the greeting on the ticket:
  - named partner: `"Guest1 & Guest2"`, e.g. `Meera Kapoor & Dev Malhotra`, `Arjun Mehra & Tara`;
  - unnamed partner: **`"Mr & Mrs Guest1"`**, e.g. `Mr & Mrs Kabir Khan` (this follows Saumy's instruction to use the Mr & Mrs format);
  - no partner: `Guest1`.
- **`couple`** is `E === 'Y'`, and **`list`** is Primary or Secondary, from the tab.
- **`aliases`** come from F, split on commas.
- **`max_guests` is `MAX_GUESTS = 4` for everyone.** Every ticket may use **Add guest**, as Saumy asked. The list only records who is actually invited, with or without a plus-one.
- Skip rows where Guest 1 is empty.

**Lookup record returned to the client:**

```
{ id, label, names:[...], genders:[...], partner: null | { title:'Mr'|'Mrs'|'Ms', gender:'M'|'F'|'' },
  max_guests: 4, couple:boolean, list:'Primary'|'Secondary', booked: null | { filled_by, updated_at, payload } }
```

**Initial guest cards** (UI):
- one read-only card per entry in `names`, with the gender from `genders`;
- if `partner` is set, one more card with an **editable, required name** input (placeholder "Your partner's name"), the gender preset from the partner, and **no remove button** (they choose a status instead);
- **Add guest**, with an editable name, an M/F toggle and a remove button, stays available while `guests.length < max_guests`.

**Payload changes:** each guest in the payload carries `added: true` when it came from Add guest (beyond the invite), and `partner: true` for the unnamed-partner slot, so Saumy can see uninvited additions. `validatePayload` accepts these optional booleans.

**`booked`** is the latest saved response for that `id`, so a partner, or the same person on another device, sees the existing ticket instead of creating a duplicate.

**Privacy:** the real guest list lives only in the private Google Sheet and in the git-ignored `private/` folder. **No real guest name may appear in any committed file.** Mock data, docs, tests and templates use fictional names only.

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

## H. Mock data (api.js), fictional names only

Replace `MOCK_GUESTS` with records in the §A lookup shape (as if parsed from the two tabs) covering:
- a couple with E = Y: "Rahul Sharma & Priya Sharma" (M, F), Primary;
- a named partner with E = N: "Arjun Mehra & Tara" (M, F), Primary;
- an unnamed partner: guest 1 "Kabir Khan" (M), Guest 2 `Mrs`, giving the label "Mr & Mrs Kabir Khan" and `partner {title:'Mrs', gender:'F'}`, Secondary;
- a single: "Ananya Iyer" (F) with alias "Annu", Primary;
- a title-only typo case: "Isha Agarwal" (F), Primary. A search for "agrawal" must find it;
- a middle-name case: "Rohan Mehta" (M), Primary. A search for "Rohan Kumar Mehta" must find it.

All records have `max_guests: 4`. Mock `getGuest` returns `booked` from the mock responses in localStorage.

---

# v3 additions (Saumy's 2026-10-08 requests). These also override anything above.

## J. Dates in copy

All official and generic copy says **10–11 December 2026** (or "10–11 Dec"). The number **12 appears only next to the Phera time**, as in the timetable row "Phera · Sat 12 Dec · 3 AM. Yes, AM." and the pass's stop list.

That covers the cover line, the page title and meta, OG and Twitter text, `assets/og.svg` (and the regenerated `og.png`), the share text, the pass subtitle and `docs/SETUP.md` sample messages. Travel date chips (e.g. departure "Sat 12 Dec") are the guest's own travel dates and are fine. `tests/copy.test.mjs` guards against any "10–12" range.

## K. Train booking info: ONE quick line

- **Remove** the booking cards, countdowns, Tatkal/overnight/Aadhaar notes, IRCTC links and booking calendar reminders.
- **Keep exactly one line**, shown on the junction stop **only when mode = train**, and personalised when the arrival date is known: "🎟️ Trains for Wed 9 Dec open for booking Sat 10 Oct, 8 AM. Grab yours early!" (that's `bookingOpens(arrive.date)`). If the date is unsure: "🎟️ Train bookings open 60 days ahead at 8 AM. For 9 Dec, that's Sat 10 Oct."
- Nothing else about trains appears anywhere. `bookingOpens` stays in logic.js; `bookingStatus`, `calendarUrl` and `icsText` may stay unused.

## L. Local guests (from Bhilwara)

- **Route stop:** the first, visually distinct option is **"Bhilwara is home"**. Sub-copy: "Local platform. Skip the travel bits and just bring your dancing shoes." The heading stays as is, and the existing modes follow it.
- **What selecting it does:**
  - sets `travel = { mode:'local', from:'Bhilwara', arrive:{date:'unsure',slot:'unsure'}, depart:{date:'unsure',slot:'unsure'} }`;
  - hides the city input;
  - **skips the Arrival and Departure stops** (the journey bar jumps ahead, and Back returns to Route);
  - shows the optional note to the couple right on the Route stop;
  - turns the CTA into "Confirm my seat".
- **Vehicle:** a cheerful **auto-rickshaw** (inline SVG, same style as the other vehicles), still carrying up to 2 rider busts.
- **"Your stops":** every function lit, with the line "Home advantage: you'll make every function." Show it on the Route stop for locals.
- **Junction copy for locals:** "Home platform! No train to catch. Just follow the dhol." There's **no** booking line for locals.
- **Pass for locals:** FROM "BHILWARA · LOCAL", TO "EVERY FUNCTION"; ARR/DEP rows become one row, "HOME PLATFORM · see you at every function".
- **Leave kit for locals:** working days are 10–11 Dec, which is 2.
- **logic.js:**
  - `MODES` includes `local`;
  - `validatePayload`: for mode `local`, `from` is optional and dates/slots may be `unsure`;
  - `buildPayload`: for mode `local`, `from` defaults to "Bhilwara" and empty dates/slots become `unsure` (see the tests).
- **CONFIG.modes:** add `{ id:'local', label:'Local' }` first.
- **Code.gs:**
  - accepts `local`;
  - `Summary` shows a "Locals" count and **excludes** locals from the per-night stay and arrival/departure (pickup) tables;
  - `People.mode` = `local`.

## M. Rajasthan long-weekend map

The wedding is on a Thursday and Friday, so the page invites guests to turn it into a **Rajasthan long weekend**. Don't print the date 12 in this copy; say "the weekend that follows".

- **Where:**
  - a section on the junction stop, after the pass and leave kit, titled "Make it a Rajasthan long weekend" with one line of creative intro copy;
  - a one-line teaser on the departure stop, under the date chips: "Staying on for the weekend? We've mapped some escapes for you. They're waiting at the end of your journey.";
  - for locals, show the section on the junction too.
- **Component:**
  - `js/trip.js` exports `mountTrip(container, { origin, destinations })`;
  - `js/trip-data.js` exports `ORIGIN` and `DESTINATIONS` (shape enforced by `tests/trip.test.mjs`): `{ id, name, lat, lon, km, drive, note, label: { dx, dy, anchor } }`;
  - styles go in **`css/trip.css`**, linked from index.html.
- **Map:**
  - an inline SVG of Rajasthan's outline, with Bhilwara as the highlighted home pin (station-board yellow, gentle pulse) and the 8 destinations as marigold pins with name labels;
  - positions come from lat/lon via an equirectangular projection with cos(mid-lat) x-scaling. **Amended (2026-10-08):** the view is fitted to the pins' bounds (`mountTrip` default `fit: 'points'`), not the outline's, because fitting the whole state on a 360px phone merges Kumbhalgarh and Ranakpur (12 km apart) into one blob. Once OUTLINE is supplied, its border is clipped into that view and a small whole-state locator inset shows where the view sits in Rajasthan. `fit: 'outline'` remains available;
  - label offsets avoid overlaps, notably Kumbhalgarh/Ranakpur and Nathdwara/Udaipur;
  - the outline geometry comes from `js/rajasthan-outline.js` (`export const OUTLINE = { bbox:[minLon,minLat,maxLon,maxLat], d:'<svg path in lon/lat or pre-projected units>' } | null`). **Until the orchestrator supplies real outline data, OUTLINE is null**, and the component draws a soft, clearly decorative rounded frame instead of a fake border. Do **not** download any map data yourself.
- **Interaction:**
  - tapping a pin **or** the destination's name in the chip list below the map selects it;
  - a dashed "railway" route animates from Bhilwara to it (no animation under reduced motion);
  - an info card (ticket-stub style, aria-live polite) shows the **name**, "**{km} km · {drive} by car** from Bhilwara", the **note (≤250 chars)** and a link "Directions from Bhilwara" (`https://www.google.com/maps/dir/?api=1&origin=Bhilwara,Rajasthan&destination=<Name>,Rajasthan`, opening in a new tab).
- **Accessibility:** pins are focusable (SVG `<a role="button" tabindex="0">` or overlay buttons) with aria-labels such as "Udaipur, 170 km, about 3 hours by car", and the chips are real `<button>`s.
- **Mobile:** sized for 360–430px wide, with tap targets of 44px or more (an invisible hit circle around each pin).
- **Data:** distances and drive times are researched and verified (Bhilwara to each, by road, typical car time), and recorded in `docs/trip-research.md` with sources.

## N. Status is always per person (Saumy, 2026-10-08)

Every person on a ticket has their **own** status: guest 1, a named partner, an unnamed partner (Mr/Mrs slot), and every added guest. A partner invited as a plus-one may well come alone or skip ("Arjun: Confirmed · Tara: Regret" is a normal answer). Never collapse a ticket into one party-level status.

- **Guest cards:** never pre-copy a status from one card to another.
- **Riders:** `ridersFor` uses per-person statuses, so a partner who regrets hops off.
- **The pass:** per-person stamps.
- **Catches and Summary counts:** these count people.
- **Couples (`couple: true`):** the same rule applies. Either partner can be Confirmed while the other is Waitlisted or Regret.
- **Ending stop:** the regret-end stop shows only when **every** person on the ticket chose Regret. Otherwise it's the junction, with the regretting people shown as "REGRET" on the pass.
