# Save the Train: design spec

**Date:** 2026-10-08 · **Ship by:** 2026-10-09 evening (IST) · **Owner:** Saumy

## 1. What this is

This is a mobile-first, single-page RSVP "pre-invite" for **Saumy & Manorika's** Marwadi wedding in **Bhilwara, Rajasthan**. Saumy sends it to **their own friends and personal connections only**; the family invites relatives separately. Saumy sends **one common WhatsApp message** with one link.

The page has three jobs:

1. Get each guest's RSVP status: **Confirmed**, **Waitlisted** (will confirm later, like a waitlisted ticket confirming at chart preparation) or **Regret**.
2. Collect guest names and **tentative** travel plans: mode, from city, arrival and departure date plus time of day. Saumy uses these to plan stays, pickups and drop-offs. Saumy allots the rooms; guests are never asked about rooms.
3. Get people to **book trains now**. Booking opens 60 days before the journey date at 08:00 IST: 9 Dec opens 10 Oct, 10 Dec opens 11 Oct, 12 Dec opens 13 Oct.

**Not in scope:**
- room or berth picking;
- train squads;
- a "what's covered" note (hospitality in Bhilwara is implied and never stated);
- exact train or flight numbers;
- a second form step;
- group tally boards.

## 2. Functions (the timetable)

| Function | Date | Time shown | Sort time (for "catch" logic) |
|---|---|---|---|
| Carnival | Thu 10 Dec 2026 | Afternoon | 10 Dec 13:00 |
| Sangeet | Thu 10 Dec 2026 | Evening | 10 Dec 19:00 |
| Maayra | Fri 11 Dec 2026 | Afternoon | 11 Dec 13:00 |
| Baraat, then Reception | Fri 11 Dec 2026 | Evening | 11 Dec 18:00 |
| Phera | Sat 12 Dec 2026 | "3 AM. Yes, AM." | 12 Dec 03:00 |

## 3. The single journey (what the guest sees)

There is one continuous journey with no second step. A **sticky journey track** sits at the top of the page. As the guest moves through the stops, their vehicle (train, plane, bus or car, matching their chosen mode) moves along the track. At the far end is a yellow Indian-railway-style **station nameboard reading "भीलवाड़ा BHILWARA"**, where the couple wait as **bobbleheads**.

All travel copy is **tentative**: "roughly", "your best guess", "you can change this anytime".

| Stop | Content |
|---|---|
| **0 · Platform (cover)** | The ticket cover reads "Shaadi Express", "Saumy weds Manorika", "10–12 Dec · Bhilwara", with the function timetable in dot-matrix type. Below it is a **"Who's boarding?"** name search: type 3+ characters to get up to 5 matches from the private guest list, then tap one. A "Not on the list? Board anyway" link lets an unlisted guest type their name; they're flagged `unlisted`. `?g=<id>` in the URL skips the search. A returning device (localStorage) shows "Welcome back, <name>" with **View my pass** and **Edit my ticket**. |
| **1 · Passengers** | A card per guest. Guest 1 is pre-filled from the list. Each card has the name (editable only on added cards) and **three status chips: Confirmed / Waitlisted / Regret**. **Add guest** appears from the second guest onward, while `guests.length < max_guests`; added guests are removable. Every guest needs a name and a status. If **all** guests choose Regret, go straight to the Regret ending. |
| **2 · Route** | Travel mode chips (Train, Flight, Bus, Car; the vehicle on the track swaps to match) and "Travelling from" (a city text input with a datalist of major Indian cities). |
| **3 · Arrival (tentative)** | Date chips (8, 9, 10, 11 Dec, Not sure yet) and time-of-day chips (Early morning (before 8 AM), Morning, Afternoon, Evening, Night). |
| **4 · Departure (tentative)** | Date chips (11, 12, 13, 14 Dec, Not sure yet) and the same time-of-day chips. A **live "Your stops" timetable** ticks the functions they'll catch and playfully flags missed ones. Below it is an optional "A note for Saumy & Manorika" box. The CTA reads **Confirm my seat**. |
| **5 · Bhilwara Junction** | The vehicle pulls in, the station board fills the screen, the bobbleheads wobble and wave, and marigolds shower down (reduced-motion: a static scene). The page then shows: **the boarding pass** (a canvas-rendered image preview) with **Download** and **Share** buttons (Web Share API with the image file, falling back to download plus a `wa.me` link to Saumy); **booking-open reminders** (train mode only) for their arrival and return dates, each with an "Add 7:50 AM reminder" button (Google Calendar link plus `.ics`); the **leave kit**, with "Formal" and "Honest" leave emails, a copy button and a working-days count; and an **Edit my ticket** button. |
| **5r · Regret ending** | The bobbleheads look sad, "We'll miss you", and the optional note box. The response is still saved. |

If nobody is Confirmed but at least one guest is Waitlisted, stops 2–4 are still shown. Their copy changes to "if your ticket confirms, roughly when would you come?", and "Not sure yet" is always allowed.

### 3.1 The Regret button joke (required behaviour)

There is one counter for the whole page, `dodges`, starting at 0. When a guest taps **Regret** and `dodges < 3`, the button **does not select**. Instead:

- a speech bubble or toast shows the message for that dodge:
  1. "Do you not love Saumy?"
  2. "How could you miss a Marwadi wedding?"
  3. "You must be completely anti-fun person!!"
- the button **jumps** to a random position. It is moved to `document.body` as `position: fixed`, so ancestor transforms can't trap it. The new position is clamped inside the **visual viewport** (`window.visualViewport`), at least 12px from every edge, and clear of the sticky journey bar and the bottom CTA, so it is always visible and tappable. Its original slot shows a dashed ghost chip ("Regret ran away →").
- `dodges++`.

On the 4th tap, Regret selects normally and shows "Okay, okay, you must be really busy at the time. We will try to understand. 😢". The button animates back into its slot. Once `dodges ≥ 3`, Regret works immediately for every other guest card.

Keyboard users get the same behaviour, and focus follows the button. Under reduced motion it moves without the spring transition.

## 4. Visual design

**Concept:** a vintage **Indian Railways PRS ticket meets a Marwadi wedding**. The page is a deep-indigo bandhani night. The paper ticket card is printed in dot-matrix and framed by marigold. The destination is the yellow station board.

**Palette tokens:**

| Token | Name | Hex | Use |
|---|---|---|---|
| `--neel` | Neel (indigo night) | `#1A2260` | Page background, with a bandhani dot pattern |
| `--neel-deep` | | `#10164A` | Sticky bar, deep areas |
| `--genda` | Genda (marigold) | `#F6A609` | Garlands, primary CTA |
| `--genda-deep` | Orange marigold | `#E07B00` | Garland shading, hover |
| `--rani` | Rani pink | `#D6246E` | Accents, selected chips, safa |
| `--haldi` | Station-board yellow | `#FFD23F` | Station board |
| `--kagaz` | Ticket card | `#FCE9D6` | Ticket surface |
| `--syahi` | Ink | `#1B1B2F` | Ticket print |
| `--patta` | Leaf green | `#2F7D32` | Toran mango leaves; the Confirmed stamp |
| `--sindoor` | Sindoor | `#C62828` | Errors, Regret stamp |

Waitlisted uses amber (`--genda-deep`). Contrast must be at least 4.5:1 for all text.

**Type:**
- **Display:** *Yatra One* (Latin plus Devanagari; "yatra" means journey). Used sparingly for the couple's names, stop titles and the station board.
- **Body:** *Mukta* (400 and 600).
- **Utility:** *DotGothic16* for dot-matrix ticket fields: train number, timetable times, PNR and stamps.

**Decor** (inline SVG, `pointer-events: none`, `aria-hidden`):
- a **toran** of mango leaves and marigolds across the top, swaying gently;
- **marigold ladis** (vertical strings) on the left and right edges, kept thin on mobile;
- a row of **diyas** with flickering flames;
- a **dhol** and a **shehnai** flanking the station board. Tapping either plays a synthesised sound.
- a **jharokha** arch outline at the top of the cover ticket. Other motifs (bandhani dots, a small elephant, kalash) are used sparingly. Follow the frontend-design skill: one signature, and stay disciplined elsewhere.

**Signature:** the journey track and the arrival at the Bhilwara station board, where the bobblehead couple waits.

**Sound:** a "Baaja" toggle in the top bar, **off by default**. It plays a synthesised Web Audio dhol loop with occasional shehnai phrases, all procedurally generated with no audio files. It stops on `visibilitychange` to hidden.

**Bobbleheads:** AI caricature head PNGs (transparent background) on small illustrated bodies. Saumy wears a safa, Manorika a lehenga and dupatta. The head wobbles from a spring at the neck. Until the PNGs arrive, use **SVG placeholder heads**. Images live in `assets/couple/saumy-head.png` and `manorika-head.png`, with fallback to the SVG.

**Accessibility and quality floor:**
- mobile first, at 360–430px; desktop is a centred column of at most 480px;
- tap targets at least 44px;
- a visible `:focus-visible` style;
- `prefers-reduced-motion` respected;
- labels on every input;
- `aria-live` announcements for the dodge messages and stop changes;
- no horizontal scroll;
- safe-area insets respected.

## 5. Architecture

The site is static: `index.html` plus `css/` plus ES modules in `js/`, hosted on GitHub Pages or any static host. There is no build step.

| File | Responsibility |
|---|---|
| `index.html` | Markup for every stop, decor SVG, meta and OG tags |
| `css/styles.css` | Tokens, layout, components, animations, reduced motion |
| `js/config.js` | Couple names, functions, dates, `API_URL`, `HOST_WHATSAPP` (Saumy's number, E.164 without +), mock flag |
| `js/logic.js` | **Pure** helpers, unit-tested with `node --test`: booking-open date, function catches, working-days count, payload build and validate, slot and date labels, calendar URL and ICS text, leave-email text |
| `js/api.js` | `findGuests(q)`, `getGuest(id)`, `submitRsvp(payload)`; mock mode (sample guests plus localStorage) when `API_URL` is empty or `?mock=1` |
| `js/regret.js` | `initRegret({ onSelect, announce })` runaway-button controller (§3.1) |
| `js/pass.js` | `renderPass(state) → Promise<HTMLCanvasElement>` (1080×1350), `downloadPass(canvas)`, `sharePass(canvas, text)` |
| `js/audio.js` | `Baaja` with `toggle()`, `dholHit()`, `shehnaiPhrase()` |
| `js/app.js` | The state machine across stops, rendering, validation, journey-track progress, localStorage draft and "welcome back", and wiring for all modules |
| `apps-script/Code.gs`, `apps-script/appsscript.json` | The Google Apps Script web app over a Google Sheet |
| `tests/*.test.mjs` | `node --test` unit tests for `logic.js` |
| `docs/SETUP.md` | Step-by-step deployment for Saumy (Sheet plus Apps Script plus hosting) |
| `tools/guests-template.csv` | Guest-list import format |

### 5.1 Data contracts

**Guest list** (Sheet `Guests`): `id` (short slug, e.g. `k7m2`), `label` ("Rahul Sharma", "Mr & Mrs Agarwal"), `names` (known person names separated by `|`; may be empty), `max_guests` (integer; 1 = no plus-one, 2 = plus-one invited), `notes`.

**API:** the Apps Script web app is deployed with *Execute as: me* and *Who has access: Anyone*.
- `GET ?action=find&q=<≥3 chars>` returns `{ok, matches:[{id,label}]}` with at most 5 matches. It case-insensitively matches word prefixes of `label` or `names`.
- `GET ?action=guest&id=<id>` returns `{ok, guest:{id,label,names:[...],max_guests}}`.
- `POST` with body `text/plain` JSON returns `{ok:true, id, updated_at}` or `{ok:false, error}`. The body is: `{action:"rsvp", id, unlisted, label, guests:[{name,status}], travel:{mode,from,arrive:{date,slot},depart:{date,slot}}|null, note, client:{ts,ua}}`.
  - `status` is one of `confirmed`, `waitlisted`, `regret`.
  - `mode` is one of `train`, `flight`, `bus`, `car`.
  - `slot` is one of `early`, `morning`, `afternoon`, `evening`, `night`, `unsure`.
  - `date` is `YYYY-MM-DD` or `unsure`.
  - Unlisted guests get `id = "u-" + random`.

**Sheets written by the script:**
- `Responses` is an append-only log: `ts, id, label, unlisted, payload_json`.
- `People` holds one row per person with the latest data, upserted by `id`: `id, label, person, status, mode, from, arrive_date, arrive_slot, depart_date, depart_slot, note, updated_at, unlisted`.
- `Summary` holds formulas: counts by status, confirmed and waitlisted people per night (9–13 Dec), arrivals and departures by date × slot, a pickup list sorted by arrival, and a list of unlisted responses.

A `setup()` function creates the sheets, headers and formulas. `LockService` guards writes, and inputs are validated server-side.

**Edit model:** the latest submission per `id` wins. The device keeps `{id, payload}` in localStorage, so the same device can re-open and edit with everything pre-filled. A different device starts fresh, and its submission replaces the old one.

### 5.2 Booking-open rule (`logic.js`)

`bookingOpens(journeyDate) = journeyDate − 60 days, at 08:00 IST`. The UI also notes that long-distance trains open 60 days before the date the train leaves its origin station, so possibly a day earlier. If that date has passed, show "Booking is open now: book today".

### 5.3 Catches

Each slot has a midpoint hour: early 6, morning 10, afternoon 14, evening 18, night 22. A function is **caught** when `arrive ≤ fnTime + 1h` and `depart ≥ fnTime + 2h`. If either side is `unsure`, the function counts as caught on that side.

### 5.4 Leave kit

Working days are the Monday–Friday days from the arrival date to the departure date, inclusive. If a date is `unsure`, assume 9 Dec and 12 Dec, which gives 3 days. Both emails use the guest's own dates.

## 6. Error handling

- Network or API failures show an inline error near the CTA with a "Try again" button. The draft stays in localStorage.
- A name search with no matches shows "No match. Check spelling or board anyway."
- If share is unsupported, download plus the `wa.me` link are offered instead.
- If the canvas fonts aren't ready, await `document.fonts.ready` before rendering.

## 7. Testing

- **Unit tests:** `node --test` on `logic.js` covering booking-open dates (e.g. 9 Dec gives 10 Oct and 12 Dec gives 13 Oct), catches, working days, payload validation and ICS output.
- **Manual and automated browser checks:** a 375×812 viewport and the full journey in mock mode; the regret dodge stays inside the viewport for 3 dodges and works on the 4th tap; boarding-pass download; reduced motion; no console errors.
- **Apps Script:** a manual end-to-end check after Saumy deploys it (documented in `SETUP.md`).

## 8. Open inputs (placeholders until provided)

- Couple head photos, which become the AI caricature heads (the SVG placeholders stay until then).
- Guest list, in `tools/guests-template.csv` format.
- `HOST_WHATSAPP` (Saumy's WhatsApp number, for the share fallback).
- The hosting choice: GitHub Pages needs a public repo on the free plan, and the repo holds no guest data.
