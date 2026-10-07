# Save the Train Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this project, tasks 1–6 are executed in parallel by a Workflow, followed by integration, review and fix stages. Agents must **not** run `git commit`; the orchestrator commits.

**Goal:** Build the mobile-first "Save the Train" RSVP pre-invite for Saumy & Manorika's Bhilwara wedding, as specified in `docs/superpowers/specs/2026-10-08-save-the-train-design.md`.

**Architecture:** A static site (`index.html` + `css/styles.css` + ES modules in `js/`) with no build step and no npm dependencies. A Google Apps Script web app over a private Google Sheet stores the guest list and responses. Pure logic sits in `js/logic.js`, unit-tested with `node --test`. DOM-free feature modules (`regret`, `audio`, `pass`, `api`) are wired together by `js/app.js`.

**Tech stack:**
- HTML5, modern CSS, vanilla JS ES modules
- Google Fonts: Yatra One, Mukta, DotGothic16
- Web Audio API, Canvas 2D, Web Share API Level 2
- Google Apps Script (V8)
- `node --test` (Node 24) for unit tests

## Global Constraints

- **Read the spec first:** `docs/superpowers/specs/2026-10-08-save-the-train-design.md`. It is the source of truth for copy, behaviour and visual tokens.
- **Audience:** Saumy's own friends only. Never mention rooms, berths, "what's covered" or relatives.
- **Statuses:** exactly `confirmed`, `waitlisted`, `regret`. UI labels are "Confirmed", "Waitlisted", "Regret".
- **Modes:** `train`, `flight`, `bus`, `car`.
- **Slots:** `early`, `morning`, `afternoon`, `evening`, `night`, `unsure`. Labels: "Early morning" (before 8 AM), "Morning", "Afternoon", "Evening", "Night", "Not sure yet".
- **Dates** are `YYYY-MM-DD` or `unsure`.
- **Travel copy is tentative:** "roughly", "best guess", "you can change this anytime".
- **Regret dodge messages, verbatim:**
  1. "Do you not love Saumy?"
  2. "How could you miss a Marwadi wedding?"
  3. "You must be completely anti-fun person!!"
  - Final: "Okay, okay, you must be really busy at the time. We will try to understand. 😢"
- **Palette (CSS custom properties):**

  | Token | Hex |
  |---|---|
  | `--neel` | `#1A2260` |
  | `--neel-deep` | `#10164A` |
  | `--genda` | `#F6A609` |
  | `--genda-deep` | `#E07B00` |
  | `--rani` | `#D6246E` |
  | `--haldi` | `#FFD23F` |
  | `--kagaz` | `#FCE9D6` |
  | `--syahi` | `#1B1B2F` |
  | `--patta` | `#2F7D32` |
  | `--sindoor` | `#C62828` |

- **Fonts:** "Yatra One" (display, sparing), "Mukta" (body, 400/600), "DotGothic16" (dot-matrix utility).
- **Mobile first:** 360–430px wide, tap targets ≥ 44px, no horizontal scroll, safe-area insets, `prefers-reduced-motion` respected, visible `:focus-visible`, contrast ≥ 4.5:1.
- **No external JS libraries.** No emoji used as icons (emoji inside copy text is fine). All decor is inline SVG or CSS.
- **Dependencies:** none, and no npm packages. Tests run with `node --test tests/`.
- **Commits:** agents do not commit; the orchestrator does.
- **The Apps Script URL is unknown at build time.** `CONFIG.apiUrl = ''` means mock mode.

## File map

| File | Owner task | Responsibility |
|---|---|---|
| `js/logic.js` | 1 | Pure helpers (tests in `tests/logic.test.mjs`, already written) |
| `js/config.js` | 2 | All content/config constants |
| `js/api.js` | 2 | API client and mock backend; local persistence |
| `apps-script/Code.gs`, `apps-script/appsscript.json` | 2 | Backend |
| `docs/SETUP.md`, `tools/guests-template.csv` | 2 | Deployment guide and guest-list format |
| `js/regret.js` | 3 | Runaway Regret button controller (self-styled, `.rj-*` classes) |
| `js/audio.js` | 4 | "Baaja": synthesised dhol and shehnai |
| `js/pass.js` | 5 | Canvas boarding pass: render, download, share |
| `index.html`, `css/styles.css`, `js/app.js`, `assets/couple/*.svg`, `assets/og.svg` | 6 | UI shell, decor, flow, wiring |

---

### Task 1: Pure logic (`js/logic.js`)

**Files:**
- Create: `js/logic.js`
- Test: `tests/logic.test.mjs` (exists; do not weaken it)

**Interfaces (Produces):** all are named ESM exports. They take no DOM and no `Date.now()` unless a `now` argument is passed in. All date maths uses UTC on `Date.UTC(y, m-1, d)` so results don't depend on timezone.

| Export | Behaviour |
|---|---|
| `isValidISODate(s: string): boolean` | |
| `formatDate(iso: string): string` | `'2026-12-09'` → `'Wed 9 Dec'`; `'unsure'` → `'Not sure yet'` |
| `bookingOpens(journeyISO: string): {date, label, iso, ms} \| null` | Journey − 60 days at 08:00 IST. `label` is like `'Sat 10 Oct'`, `iso` like `'2026-10-10T08:00:00+05:30'`, `ms` is the UTC epoch ms. Returns `null` for `unsure`. |
| `bookingStatus(journeyISO: string, nowMs: number): {state:'open'\|'upcoming', msUntil:number} \| null` | |
| `slotHour(slot: string): number \| null` | early 6, morning 10, afternoon 14, evening 18, night 22, unsure 12. Anything else returns null. |
| `catches({arrive:{date,slot}, depart:{date,slot}}, functions:[{id,name,at}]): [{id,name,caught}]` | `at` is `'YYYY-MM-DDTHH:MM'` local wedding time. A function is caught when `arriveH ≤ fnH + 1` and `departH ≥ fnH + 2`, where H is absolute hours. A side whose date is `unsure` always passes. |
| `workingDays(arriveISO, departISO): number` | Mon–Fri inclusive. `unsure` arrival becomes 2026-12-09 and `unsure` departure becomes 2026-12-12. Returns 0 if departure < arrival. |
| `overallStatus(guests): 'confirmed'\|'waitlisted'\|'regret'` | |
| `validatePayload(p): {ok:boolean, errors:string[]}` | Rules in the spec §5.1. Names are 1–60 chars; there are 1–10 guests; `note` is ≤ 500 chars; travel is required unless everyone regrets; `from` is 1–60 chars; departure date ≥ arrival date when both are known, with an error message containing "before". |
| `buildPayload(state, client:{ts,ua}): payload` | Shape exactly as in the test. |
| `calendarUrl({title, startISO, minutes, details}): string` | |
| `icsText({uid, title, startISO, minutes, details}): string` | CRLF line endings. Includes a VALARM that fires at the start. |
| `leaveEmail(kind:'formal'\|'honest', {name, arrive, depart, days, couple, city}): {subject, body}` | The honest body mentions the 3 AM phera and dancing in the baraat, in a warm, funny tone. |
| `matchesQuery(q, label, names[]): boolean` | Trimmed q must be at least 3 chars. Every query word must be a prefix of some word in `label` or `names`. Case-insensitive; ignores `&`, `.` and `,`. |

- [ ] **Step 1:** Run `node --test tests/` and confirm it FAILs (the module is missing).
- [ ] **Step 2:** Implement `js/logic.js` to satisfy every test and the interface table. Keep it under 250 lines and use JSDoc on exports.
- [ ] **Step 3:** Run `node --test tests/`. Expected: all tests pass.

### Task 2: Config, API client, Apps Script backend, setup docs

**Files:** create `js/config.js`, `js/api.js`, `apps-script/Code.gs`, `apps-script/appsscript.json`, `docs/SETUP.md` and `tools/guests-template.csv`.

**`js/config.js` (Produces):**

```js
export const CONFIG = {
  couple: { a: 'Saumy', b: 'Manorika', joined: 'Saumy & Manorika', weds: 'Saumy weds Manorika' },
  city: 'Bhilwara', cityHi: 'भीलवाड़ा', station: 'BHL', state: 'Rajasthan',
  train: { name: 'Shaadi Express', number: '1012' },
  apiUrl: '',          // Apps Script /exec URL; '' => mock mode
  hostWhatsApp: '',    // Saumy's WhatsApp, digits only with country code, e.g. '919812345678'
  siteUrl: '',         // public URL once hosted
  functions: [
    { id: 'carnival', name: 'Carnival', date: '2026-12-10', when: 'Afternoon', at: '2026-12-10T13:00' },
    { id: 'sangeet',  name: 'Sangeet',  date: '2026-12-10', when: 'Evening',   at: '2026-12-10T19:00' },
    { id: 'maayra',   name: 'Maayra',   date: '2026-12-11', when: 'Afternoon', at: '2026-12-11T13:00' },
    { id: 'baraat',   name: 'Baraat & Reception', date: '2026-12-11', when: 'Evening', at: '2026-12-11T18:00' },
    { id: 'phera',    name: 'Phera',    date: '2026-12-12', when: '3 AM. Yes, AM.', at: '2026-12-12T03:00' },
  ],
  arriveDates: ['2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', 'unsure'],
  departDates: ['2026-12-11', '2026-12-12', '2026-12-13', '2026-12-14', 'unsure'],
  slots: [
    { id: 'early', label: 'Early morning', hint: 'before 8 AM' },
    { id: 'morning', label: 'Morning', hint: '8 AM – noon' },
    { id: 'afternoon', label: 'Afternoon', hint: 'noon – 4 PM' },
    { id: 'evening', label: 'Evening', hint: '4 – 8 PM' },
    { id: 'night', label: 'Night', hint: 'after 8 PM' },
    { id: 'unsure', label: 'Not sure yet', hint: '' },
  ],
  modes: [
    { id: 'train', label: 'Train' }, { id: 'flight', label: 'Flight' },
    { id: 'bus', label: 'Bus' }, { id: 'car', label: 'Car' },
  ],
  statuses: [
    { id: 'confirmed', label: 'Confirmed', stamp: 'CNF' },
    { id: 'waitlisted', label: 'Waitlisted', stamp: 'WL' },
    { id: 'regret', label: 'Regret', stamp: 'REGRET' },
  ],
  regret: {
    dodges: ['Do you not love Saumy?', 'How could you miss a Marwadi wedding?', 'You must be completely anti-fun person!!'],
    final: 'Okay, okay, you must be really busy at the time. We will try to understand. 😢',
  },
  cities: ['Ahmedabad','Ajmer','Bengaluru','Bhopal','Chandigarh','Chennai','Delhi','Gurugram','Hyderabad','Indore','Jaipur','Jodhpur','Kolkata','Kota','Lucknow','Mumbai','Noida','Pune','Surat','Udaipur','Vadodara'],
};
```

**`js/api.js` (Produces):**

```js
export function isMock(): boolean               // CONFIG.apiUrl === '' || URLSearchParams has mock=1
export async function findGuests(q): Promise<{id,label}[]>   // [] when q.trim().length < 3
export async function getGuest(id): Promise<{id,label,names:string[],max_guests:number} | null>
export async function submitRsvp(payload): Promise<{ok:true,id,updated_at}>   // throws Error(userFacingMessage) on failure
export function newUnlistedId(): string        // 'u-' + 8 random base36 chars (crypto.getRandomValues)
export const local = {                          // localStorage key 'stt.v1', all calls wrapped in try/catch
  load(): {id,label,unlisted,payload,updated_at} | null,
  save(record): void,
  clear(): void,
  loadDraft(): object | null, saveDraft(state): void, clearDraft(): void,   // key 'stt.draft.v1'
};
```

- **Mock mode:**
  - Uses an in-file `MOCK_GUESTS`:
    - `{id:'k7m2', label:'Rahul Sharma', names:['Rahul Sharma','Priya Sharma'], max_guests:2}`
    - `{id:'p3x9', label:'Mr & Mrs Agarwal', names:['Mr Agarwal','Mrs Agarwal'], max_guests:2}`
    - `{id:'a1b2', label:'Ananya Iyer', names:['Ananya Iyer'], max_guests:1}`
    - `{id:'z8q4', label:'Kabir Khan', names:['Kabir Khan'], max_guests:2}`
  - `findGuests` uses `matchesQuery` from `logic.js`.
  - `submitRsvp` validates with `validatePayload`, waits 600ms, and stores the payload in localStorage key `stt.mock.responses`.
- **Live mode:**
  - GET: `fetch(apiUrl + '?action=find&q=' + encodeURIComponent(q))`.
  - POST: `fetch(apiUrl, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify(payload)})`, then parse JSON. A 12s timeout uses AbortController.
  - Errors map to messages like "Couldn't reach the ticket counter. Check your connection and try again."

**`apps-script/Code.gs`:**
- `doGet(e)`: actions `find`, `guest` and `ping`. It responds with `ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)`.
- `doPost(e)`:
  - parses `e.postData.contents`;
  - validates, mirroring `validatePayload`, as a self-contained copy, since Apps Script can't import ES modules;
  - takes `LockService.getScriptLock().waitLock(20000)`;
  - appends to `Responses`;
  - upserts `People` (deletes the rows with this `id`, then appends one row per guest);
  - returns `{ok:true,id,updated_at}`.
- **Unknown listed ids** are rejected with `{ok:false,error:'unknown guest'}`. **Unlisted ids** must match `^u-[a-z0-9]{8}$`. It caps total `Responses` rows at 5000 to limit spam damage.
- **`setup()`:**
  - creates the sheets `Guests` (headers `id, label, names, max_guests, notes`), `Responses`, `People` and `Summary`, plus `Summary` formulas: counts by status; confirmed and waitlisted people per night of 8–13 Dec, where a person is present on night D if `arrive_date ≤ D < depart_date`, with `unsure` treated as 9 Dec arrival and 12 Dec departure; an arrivals table of date × slot; a departures table of date × slot; and an unlisted list;
  - freezes the header rows.
- **Other helpers:** `generateIds()` fills blank `id` cells in `Guests` with unique 4-char base36 slugs. `listPersonalLinks()` logs `SITE_URL + '?g=' + id` for each guest. `SITE_URL` is a constant at the top of the file.

**`apps-script/appsscript.json`:** `{"timeZone":"Asia/Kolkata","runtimeVersion":"V8","exceptionLogging":"STACKDRIVER","webapp":{"executeAs":"USER_DEPLOYING","access":"ANYONE_ANONYMOUS"}}`

**`docs/SETUP.md`:** step-by-step instructions for Saumy, written for a non-developer:
1. Create a Google Sheet "Save the Train RSVPs".
2. Open Extensions → Apps Script, paste `Code.gs`, show the manifest and paste `appsscript.json`, then save.
3. Run `setup` once and authorise. Explain the "Google hasn't verified this app" screen: Advanced → Go to project, which is safe because it's your own script.
4. Paste guests into the `Guests` tab (format from the CSV; `max_guests` is 2 when a plus-one is invited), then run `generateIds`.
5. Deploy → New deployment → Web app, with Execute as: Me and Access: Anyone. Copy the `/exec` URL.
6. Put the URL in `js/config.js` `apiUrl`, and put the WhatsApp number in `hostWhatsApp`.
7. Test: open the site, find your own name, submit, and see the rows appear.
8. After every Code.gs change: Deploy → Manage deployments → Edit → New version.
9. Optional: run `listPersonalLinks` for per-person links.

**`tools/guests-template.csv`:** has the header `id,label,names,max_guests,notes` and the four mock rows, with `names` pipe-separated.

- [ ] **Step 1:** Write `js/config.js` and `js/api.js` exactly to the interface above.
- [ ] **Step 2:** Write a quick node smoke test, `tests/api.mock.test.mjs`. It stubs `globalThis.localStorage` with an in-memory object and `globalThis.location = {search:''}`, then asserts that `findGuests('rah')` returns the k7m2 entry and that `submitRsvp(validPayload)` resolves `ok:true`. Run `node --test tests/`; all pass.
- [ ] **Step 3:** Write `Code.gs`, `appsscript.json`, `SETUP.md` and the CSV. Self-review `Code.gs` for Apps Script V8 compatibility: no ES module syntax, `const`/`let` and arrow functions are fine, and no top-level `await`.

### Task 3: Regret runaway button (`js/regret.js`)

**Files:** create `js/regret.js`.

**Interface (Produces):**

```js
export function createRegretController({ messages, finalMessage, announce, getInsets, reducedMotion }) => ({
  handle(buttonEl, onSelect),   // call from the Regret chip's click handler
  get dodges(),                 // number (0..3)
  reset(),                      // restore any moved button, dodges = 0 (used by tests/dev only)
})
```

- `messages`: 3 strings. `finalMessage`: a string.
- `announce(text)`: app-provided aria-live writer.
- `getInsets()`: returns `{top, bottom}` in px, covering the sticky journey bar and the bottom CTA.
- `reducedMotion`: a boolean.

**Behaviour:** see spec §3.1. Implementation notes:
- **Moving the button:** move `buttonEl` to `document.body` and leave a ghost placeholder `<span class="rj-ghost">Regret ran away →</span>` in its original slot. Set `position:fixed` with `left`/`top` computed inside `visualViewport` (use `offsetLeft`/`offsetTop` plus width and height, falling back to `innerWidth`/`innerHeight`). Keep 12px margins and stay clear of `getInsets()`. Choose a position at least 80px from the previous one when space allows. Animate with a spring-ish `transition: left .35s cubic-bezier(.34,1.56,.64,1), top ...` unless `reducedMotion` is set.
- **Speech bubble:** show `div.rj-bubble[role=status]` near the button with the message. It hides after 2.6s or on the next dodge.
- **On each dodge:** call `announce(message)`, increment `dodges` and keep focus on the button.
- **Fourth tap and beyond:** when `dodges === 3`, the next `handle` call returns the button to its slot (replacing the ghost), shows `finalMessage` in a bubble, calls `announce(finalMessage)`, then calls `onSelect()`. From then on, `handle` calls `onSelect()` immediately for any button, with no messages.
- **On `resize` or `visualViewport` resize:** re-clamp a moved button.
- **Styles:** inject a `<style id="rj-style">` once. It contains `.rj-bubble` (kagaz background, syahi text, Mukta, rounded with a tail, `z-index:60`, max-width 240px), `.rj-ghost` (dashed sindoor outline, 44px tall) and `.rj-moving` (`z-index:59`, sindoor background chip).
- **Don't** set `pointer-events:none` on anything, and never place the button under the bars.

- [ ] **Step 1:** Implement it.
- [ ] **Step 2:** Create `dev/regret-demo.html` (a standalone page with three fake chips and a fake sticky header and footer) to test it manually in a browser at a 375×812 viewport. Log `dodges` to the console.

### Task 4: Baaja audio (`js/audio.js`)

**Files:** create `js/audio.js`.

**Interface (Produces):**

```js
export function createBaaja() => ({
  get on(): boolean,
  toggle(): boolean,          // starts/stops the loop; returns new state
  dholHit(kind = 'dha'),      // 'dha' (bass+treble), 'ge' (bass), 'na' (treble)
  shehnaiPhrase(),            // plays one ~4s phrase
  stop(),
})
```

- The `AudioContext` is created lazily on the first call, which must come from a user gesture. Call `ctx.resume()` every time.
- **Dhol:**
  - the bass "ge" is a sine that sweeps 140→55 Hz over 0.25s with an exponential gain decay, plus a low-passed noise thump;
  - the treble "na" is a 40ms bandpass noise burst (2.5 kHz, Q 1.2) plus a short 900 Hz triangle click;
  - "dha" is both together.
- **Loop:** a chaal pattern at 100 BPM over 8 eighth-notes, `['dha','-','na','ge','dha','-','na','-']`. Use a lookahead scheduler (setInterval 25ms, schedule-ahead 0.1s).
- **Shehnai:**
  - a sawtooth plus square mix through two bandpass formants (~1.1 kHz and ~2.6 kHz) and a gentle low-pass at 4 kHz;
  - 5.5 Hz vibrato at ±12 cents, with a 60ms attack and 120ms release on each note;
  - an original phrase in a Yaman-like scale (Sa Re Ga Ma# Pa Dha Ni) around 440 Hz Sa, with ornamental glides of 60ms portamento between notes;
  - the phrase plays every 4 bars while the loop is on.
- Master gain is 0.6 and there is a DynamicsCompressor. `stop()` ramps the gain to 0 over 0.15s. Stop automatically on `document.visibilitychange` when the page is hidden.
- No audio files and no external libraries.

- [ ] **Step 1:** Implement it.
- [ ] **Step 2:** Create `dev/audio-demo.html` with buttons for toggle, dha, ge, na and shehnai. Check in a browser that there are no console errors (sound can't be verified headlessly).

### Task 5: Boarding pass (`js/pass.js`)

**Files:** create `js/pass.js`.

**Interface (Produces):**

```js
export async function renderPass(data) => HTMLCanvasElement   // 1080 x 1350
// data = {
//   config,                                   // CONFIG from js/config.js
//   label, passId,                            // e.g. 'Rahul Sharma', 'K7M2'
//   guests: [{name, status}],
//   travel: {mode, from, arrive:{date,slot}, depart:{date,slot}} | null,
//   catches: [{id, name, caught}],            // from logic.catches
//   heads: { a: HTMLImageElement|null, b: HTMLImageElement|null }  // optional, preloaded by app
// }
export function passFilename(label) => string                  // 'shaadi-express-ticket-rahul-sharma.png'
export async function downloadPass(canvas, filename) => void   // toBlob → object URL → <a download>; revoke later
export async function sharePass(canvas, {title, text, filename}) => 'shared'|'cancelled'|'unsupported'
```

**Design (draw with the Canvas 2D API only; first `await document.fonts.load('40px "Yatra One"')` and the same for Mukta and DotGothic16, then `document.fonts.ready`):**
- **Background:** neel with a bandhani dot pattern of small kagaz and rani dots at low alpha. Marigold garland arcs across the top (a scalloped toran of circles in genda and genda-deep, with patta leaves).
- **Ticket card:** kagaz, rounded corners, with semicircle perforation notches on both sides at about 62% height and a dashed tear line. A punched hole sits top-left.
- **Header strip** in rani: "SHAADI EXPRESS · 1012" in DotGothic16, kagaz colour.
- **Big title:** "Saumy weds Manorika" in Yatra One, syahi. A small line underneath: "10–12 Dec 2026 · Bhilwara, Rajasthan".
- **Route row:**
  - `FROM` shows the city, upper-cased, in DotGothic16 (or "YOUR CITY" if there's no travel);
  - a vehicle glyph drawn with simple shapes for the mode;
  - `TO` shows "BHILWARA (BHL)".
- **Passengers:** one row per guest with the name in Mukta and a rotated rubber-stamp status: "CNF" in patta, "WL" in genda-deep, "REGRET" in sindoor, each with a rough double border.
- **Arrival and departure:** "ARR (tentative)" and "DEP (tentative)" with `formatDate` plus the slot label, in DotGothic16.
- **Stops:** the five functions in a mini timetable. Caught functions get a filled diya dot; missed ones are outlined and greyed.
- **Footer:** "PNR " + passId plus a decorative barcode of random-width bars, seeded from passId so it's deterministic. Below it, small text: "Tentative plan · Chart prepares closer to the date".
- **Bobbleheads:** if `heads.a` or `heads.b` are provided, draw them in circles at the bottom-right, tilted −6° and +6°.
- **All-regret version:** a big "REGRET" stamp across the card and the line "We'll miss you! (Still loved.)".
- **Share:** `sharePass` uses `navigator.canShare({files:[file]})`, then `navigator.share({files, title, text})`. An `AbortError` returns 'cancelled'. Anything else returns 'unsupported'.

- [ ] **Step 1:** Implement it.
- [ ] **Step 2:** Create `dev/pass-demo.html`. It renders three variants (confirmed couple by train, waitlisted solo by flight, all regret) into `<img>` previews using `canvas.toDataURL`. Check in a browser that there are no console errors and the text is legible.

### Task 6: UI shell, decor, flow and wiring (`index.html`, `css/styles.css`, `js/app.js`, `assets/`)

**Files:** create `index.html`, `css/styles.css`, `js/app.js`, `assets/couple/saumy-head.svg`, `assets/couple/manorika-head.svg` and `assets/og.svg` (1200×630 share-card artwork).

**Interfaces (Consumes):** `CONFIG` (Task 2), `logic.*` (Task 1), `api.*` (Task 2), `createRegretController` (Task 3), `createBaaja` (Task 4), `renderPass`/`downloadPass`/`sharePass`/`passFilename` (Task 5). Use these exact names and signatures. If a module isn't present yet when you test, create a temporary stub *only in your head*: never commit stubs over another task's file.

**Requirements:**
- **Read** the spec, especially §3 (the stops), §3.1 (regret) and §4 (visual design).
- **Before writing CSS, also load and follow** the `frontend-design:frontend-design` and `anthropic-skills:ui-ux-pro-max` skills (via the Skill tool). The design tokens are fixed above; the skills govern execution quality.
- **`index.html`:**
  - `lang="en"`, viewport meta with `viewport-fit=cover`, `theme-color` set to `#10164A`;
  - title "Saumy & Manorika · Shaadi Express to Bhilwara", description;
  - OG/Twitter meta (title "Your ticket to Saumy & Manorika's wedding 🚂", description "10–12 Dec 2026 · Bhilwara. RSVP and plan your journey.", `og:image` `assets/og.png`, width 1200, height 630);
  - Google Fonts link (Yatra One, Mukta:wght@400;600, DotGothic16) with `display=swap` and preconnect;
  - `<script type="module" src="js/app.js">`.
- **Layout layers:**
  1. A decor layer (fixed, `pointer-events:none`, `aria-hidden`): the toran across the top, swaying; thin marigold ladis on the left and right edges, swaying with staggered delays; a bandhani dot background on `body` (CSS radial-gradient pattern on neel).
  2. A **sticky journey bar** in neel-deep containing:
     - a "Baaja" sound toggle (an SVG speaker icon plus text, `aria-pressed`);
     - the track: dashed rail, station dots for stops 1–4, the vehicle SVG for the current mode (train/plane/bus/car, inline symbols), positioned by progress with a `transform` transition and a small chug bob;
     - the right end: a mini yellow station board "BHILWARA" with two mini bobblehead heads.
  3. `<main>` holds one `section.stop[data-stop]` per stop: `platform`, `passengers`, `route`, `arrival`, `departure`, `junction` and `regret-end`. Only the active one is visible. Transitions between stops slide and fade (or are instant under reduced motion), and focus moves to the stop heading.
  4. A **bottom CTA bar** (sticky, safe-area padded) with Back plus the primary action, whose label depends on the stop: "Board now", "Next station →", "Confirm my seat".
  5. A diya row (decor) above the CTA bar or at the end of `main`, with flickering flames.
- **Platform stop:**
  - the cover ticket (kagaz card, jharokha arch top edge, perforations) with "Shaadi Express · 1012", the couple names in Yatra One, and the dates and city;
  - the function timetable in dot-matrix rows, with Phera shown as "Sat 12 Dec · 03:00 · 3 AM. Yes, AM.";
  - the "Who's boarding?" search: a labelled input with debounced `findGuests` (250ms), results as tappable rows, the "No match. Check spelling or board anyway." empty state, and a "Not on the list? Board anyway" link that opens a name input;
  - `?g=<id>` auto-loads `getGuest`;
  - a welcome-back panel when `local.load()` exists, with "View my pass" (jump to junction) and "Edit my ticket".
- **Passengers stop:**
  - a guest card per person: the name (read-only for list names, editable input for added guests) and a status chip group (radio semantics: `role=radiogroup`, chips are `role=radio` buttons with `aria-checked`);
  - the Regret chip click goes through `regret.handle(btn, () => setStatus(i,'regret'))`;
  - "Add guest" shows while `guests.length < max_guests` and adds a card with an empty name; added cards have a remove button;
  - initial guests come from `names` (if empty, use `[label]`), but only the first `max_guests`;
  - validation is inline per card.
- **Route stop:** mode chips (switching mode swaps the vehicle on the track) and a "Travelling from" input with a datalist from `CONFIG.cities`. Helper copy: "Your best guess is perfect".
- **Arrival and departure stops:** date chips (label from `formatDate`) and slot chips with hints. The heading reads "Roughly when do you arrive?" or "…leave?". Show the waitlisted variant copy when nobody is confirmed. The departure stop also shows the live "Your stops" timetable from `catches()` (caught = a lit diya, missed = struck through with a playful line such as "You'll miss the Phera! It's at 3 AM anyway…") and the optional note textarea (500 chars, with a counter).
- **Submit:**
  - build with `buildPayload(state, {ts:new Date().toISOString(), ua:navigator.userAgent})`, run `validatePayload`, then `submitRsvp`;
  - while saving, the CTA shows "Printing your ticket…" and is `aria-busy`;
  - on success, save `local.save({...})`, clear the draft and go to the junction (or `regret-end` if everyone regrets);
  - on failure, show an inline error with "Try again".
- **Junction stop:**
  - **arrival scene:** a full-width station board "भीलवाड़ा / BHILWARA", sub-line "समुद्र तल से ऊंचाई: बहुत खुश" ("Height above sea level: very happy"), and the bobblehead couple (head images from `assets/couple/saumy-head.png`/`.svg`, small SVG bodies — Saumy in a rani safa and sherwani, Manorika in a lehenga and dupatta — with the heads wobbling via CSS keyframes from a neck pivot);
  - a marigold-petal shower for about 3s; tapping the dhol or shehnai art plays `baaja.dholHit()` / `baaja.shehnaiPhrase()`;
  - the boarding pass preview (`renderPass`, then an `<img>` from a data URL) with **Download ticket** and **Share** buttons. Share calls `sharePass`; if it returns 'unsupported', fall back to download plus show "Send it to Saumy on WhatsApp" (a `wa.me/<hostWhatsApp>?text=` link, only when `hostWhatsApp` is set);
  - booking cards (only for train mode): for the arrival date and the return date, show `bookingOpens` and `bookingStatus` (a countdown when upcoming, "Booking is open now — book today" when open), plus the origin-station caveat line, plus "Add 7:50 AM reminder" (Google `calendarUrl` link plus an `.ics` download via `icsText`);
  - the leave kit: Formal/Honest toggle, a preview of the subject and body, a copy button (`navigator.clipboard`, falling back to a textarea select), a `mailto:` link, and "You'll need about N working days" from `workingDays`;
  - an "Edit my ticket" button that returns to the passengers stop with the state restored.
- **Regret-end stop:** the bobbleheads with a sad tilt, "We'll miss you!", and (if not already shown on the previous stop) the note box, plus "Changed your mind? Edit my ticket".
- **State and drafts:** a single state object `{guest:{id,label,unlisted,max_guests}, guests:[], travel:{mode,from,arrive:{date,slot},depart:{date,slot}}, note, stop}`, autosaved with `local.saveDraft` on every change and restored on load.
- **Accessibility:** a visually hidden `aria-live="polite"` region (announce) used by stop changes and the regret controller.
- **Placeholder head SVGs:** simple, charming caricature heads (round face, big eyes, smile). Saumy has a rani pink safa (turban) with a kalgi; Manorika has dark hair in a bun, a maang tikka and a nath. Each is 256×256 with a transparent background.
- **`assets/og.svg`:** 1200×630 with neel bandhani, the ticket card, "Saumy & Manorika", "Shaadi Express to Bhilwara · 10–12 Dec 2026" and a marigold toran. This is the source the orchestrator converts to `og.png`.
- **CSS:** custom properties from Global Constraints; a container max-width of 480px, centred; chips at least 44px tall; a selected chip uses rani fill with white text and a stamp-like inner border; all keyframes guarded by `@media (prefers-reduced-motion: no-preference)`.

- [ ] **Step 1:** Load the two design skills, then write `index.html` and `css/styles.css` with all stops' static structure and decor.
- [ ] **Step 2:** Write `js/app.js` wiring the flow.
- [ ] **Step 3:** Serve locally with `python -m http.server 8080` from the repo root and open `http://localhost:8080/?mock=1` at 375×812. Run the whole journey; there must be no console errors.

### Task 7: Integration and verification (orchestrator plus verifier agents)

- [ ] Run `node --test tests/`; all pass.
- [ ] Browser check at 375×812 in mock mode:
  - the full happy path;
  - the all-regret path, where Regret dodges three times inside the viewport and selects on the 4th tap;
  - the waitlisted-only path;
  - the boarding-pass render and download;
  - reload restores the draft;
  - the welcome-back panel;
  - `?g=k7m2` auto-load;
  - reduced motion;
  - no horizontal scroll;
  - no console errors.
- [ ] Code review against the spec: interface consistency, XSS (all guest-entered text rendered with `textContent`, never `innerHTML`), and the Apps Script validation.
- [ ] Convert `assets/og.svg` to `assets/og.png`: `msedge --headless --disable-gpu --screenshot=assets/og.png --window-size=1200,630 file:///.../assets/og.svg`.
- [ ] Commit and push.
