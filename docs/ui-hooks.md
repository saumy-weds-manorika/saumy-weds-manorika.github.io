# UI hooks: the DOM contract for `js/app.js`

This document is the contract between the static UI shell (`index.html`, `css/styles.css`) and the behaviour layer (`js/app.js`). It lists every id, template, class and attribute that `app.js` reads or toggles. The CSS does all visual work. `app.js` only flips the hooks below and fills text.

**Ground rules**

- **Text goes in with `textContent`, never `innerHTML`.** Guest names, labels and notes are untrusted.
- **Show and hide with the `hidden` attribute** (`el.hidden = true/false`). The CSS has `[hidden] { display: none !important }`, so `hidden` always wins.
- **Lists are rendered from `<template>`s.** Clone with `tpl.content.firstElementChild.cloneNode(true)`, fill the `[data-slot]` nodes, then append. Containers ship with sample children marked `[data-sample]`. Always clear them with `container.replaceChildren()` before rendering. Outside preview mode the samples are already `display: none`.
- **Preview mode:** `?preview=all` adds `body.preview-all`, unhides every `[data-preview]` element, checks every `[data-preview-check]` chip, adds `.is-arrived` to scenes and sets `--progress: .6`. **`app.js` should do nothing in preview mode.** Start `init()` with `if (document.body.classList.contains('preview-all')) return;`.
- `index.html` already loads `<script type="module" src="js/app.js">` in `<head>`.

---

## 1. `<body>` attributes and classes

| Hook | Values | Who sets it | Effect |
|---|---|---|---|
| `body[data-stop]` | `platform` `passengers` `route` `arrival` `departure` `junction` `regret-end` | app, on every stop change (initial markup: `platform`) | At `junction` the mini-board heads hop. Also useful to app.js for conditionals. |
| `body[data-dir]` | `forward` `back` | app, before switching stops | Slide direction of the stop entrance (from the right or the left). |
| `body[data-mode]` | `local` `train` `flight` `bus` `car` | app, whenever the mode chip changes (initial: `train`) | Swaps the vehicle on the journey track (`local` is the auto-rickshaw) and where its riders sit. Steam puffs show only for `train`. `local` also swaps `.v-away` for `.v-home` copy and fades the arrival and departure stations. |
| `body[data-party]` | `confirmed` `waitlisted` `regret` | app: `overallStatus(state.guests)` from `logic.js` on every status change (initial: `confirmed`) | `waitlisted` swaps `.v-cnf` copy for `.v-wl` copy (route, arrival and departure titles; junction heading). `regret` tilts the mini-board heads sadly. |
| `body.is-busy` | class | app, while `submitRsvp` is in flight | Disables pointer events on `<main>`. Pair it with `#cta-next[aria-busy="true"]`. |
| `body.is-baaja-on` | class (optional) | app, optional | The same as `#baaja-toggle[aria-pressed="true"]`, which CSS already detects with `:has()`. The dhol icon, the scene dhol and both shehnais move to the beat. |
| `body.preview-all` | class | inline preview script only | Dev review mode. Never set it from app.js. |

## 2. Stops

| Stop | Section | Focus target (heading) | Track `--progress` |
|---|---|---|---|
| Platform | `section#stop-platform.stop[data-stop="platform"]` | `#t-platform` (the `h1` on the cover) | `0` |
| Passengers | `#stop-passengers` | `#t-passengers` | `.2` |
| Route | `#stop-route` | `#t-route` | `.4` |
| Arrival | `#stop-arrival` | `#t-arrival` | `.6` |
| Departure | `#stop-departure` | `#t-departure` | `.8` |
| Junction | `#stop-junction` | `#t-junction` | `1` |
| Regret ending | `#stop-regret-end` | `#t-regret` | keep the current value (suggest `.2`) |

- **Visible stop:** exactly one `section.stop` has `.is-active` (the initial markup activates platform). CSS animates the entrance (slide plus fade, none under reduced motion).
- **Recommended `go(stop, dir)`:**
  1. Set `body.dataset.dir = dir`.
  2. Move `.is-active` to `#stop-<name>`.
  3. Set `body.dataset.stop = name`.
  4. Set the track progress (§3).
  5. Scroll to the top: `scrollTo({top: 0})`.
  6. Focus the heading: `#t-<name>.focus({preventScroll: true})`. Every stop title has `tabindex="-1"`.
  7. Announce it: `announce('Stop 2 of 4: Getting to Bhilwara')`.
- **Copy variants:** `.v-cnf` and `.v-wl` spans sit inside `#t-route`, `#t-arrival`, `#t-departure`, `#t-junction` and the junction lede. Only `body[data-party]` controls them, so there's no JS text swapping. `.v-away` / `.v-home` (by `body[data-mode]`) do the same for locals: the passengers and route strips ("Stop 1 of 2", "Last stop") and the junction heading ("See you at the shaadi!"). The live-region line follows suit ("Stop 1 of 2", "Last stop: Getting to Bhilwara"; travellers hear "Stop 2 of 4: Getting to Bhilwara").

## 3. Journey bar (sticky, `header#journey-bar`)

| Hook | Notes |
|---|---|
| `#journey` `style="--progress: N"` | Sets progress: `journey.style.setProperty('--progress', String(n))` with `n` from 0 to 1. It's a registered `@property` with a 1.1s transition. The vehicle glides, the lit rail grows, and each `.journey__station` lights up automatically as the vehicle passes its `--at` value, so there are no per-station classes to manage. |
| `#journey.is-moving` | Add it when progress changes and remove it after about 1100ms (or on `transitionend` where `e.propertyName === '--progress'`). It drives the chug bob and the steam puffs. |
| `.journey__station[data-stop]` | Static dots at `--at` = 0, .2, .4, .6, .8. Read-only. |
| `.vehicle__svg[data-mode]` | Four inline SVGs. CSS shows the one that matches `body[data-mode]`, so app.js only sets `data-mode`. |
| `#baaja-toggle[aria-pressed]` | Set `aria-pressed="true"` or `"false"` to match `baaja.toggle()`. The icon is a dhol, struck through when off. Its accessible name is static ("Baaja: wedding band sound"). |
| `.riders > img.rider[data-rider="0"/"1"]` | The two rider slots in the vehicle (amendments §D). app.js sets `src` to `assets/bobble/guest-{m,f}-bust.webp` from `ridersFor(guests)`, toggles `hidden`, and adds `.is-in` (hop in) or `.is-out` (hop out, then `hidden`). There are only two slots, so never more than two riders. |
| `.mini-board`, `.mini-board__head[data-head="a"/"b"]` | Decor, `aria-hidden`: the couple's busts (`assets/bobble/*-bust.webp`). They hop on `body[data-stop="junction"]` and droop on `body[data-party="regret"]`. |
| `.toran` | The garland hanging 20–30px below the bar, with no pointer events. Count it in regret insets (§10). |

## 4. Platform (`#stop-platform`)

| Id | Element | Contract |
|---|---|---|
| `#cover` | `article.ticket.cover` | Static cover ticket with the timetable. No hooks. `.cover__peek` holds the couple's busts, peeking out of the jharokha over the ticket's top edge (CSS only). `.cover__routes` is the static every-mode sub-line under the dates (v4 §O1: "Train, bus, car or flight, every route ends at Bhilwara."). |
| `#welcome` | panel, **hidden** by default | Show it when `local.load()` returns a record, and hide `#search-block`. |
| `#welcome-name` | `p` | `textContent = record.label` |
| `#welcome-view-pass` | button | Go to the junction with the saved payload. |
| `#welcome-edit` | button | Restore the state and go to passengers. |
| `#welcome-reset` | link-style button | Optional "Someone else? Start a new ticket": clear the local record and show `#search-block`. Hide it if not used. |
| `#search-block` | wrapper | The whole "Who's boarding?" area. |
| `#guest-search` | `input[type=search]` | Debounce 250ms, call `findGuests(q)` when `q.trim().length >= 3`, and render rows into `#search-results`. |
| `#search-results` | `ul` | `replaceChildren()` and then append `#tpl-result` clones. It collapses when empty (`:empty`). |
| `#search-empty` | `p`, **hidden** | Show it when a 3+ character query returns `[]`. Its copy is already in the markup. |
| `#search-short` | `p`, **hidden** | Show it while 1–2 characters are typed ("Keep going: type at least 3 letters, or add your surname."). Hide it at 0 or 3+. |
| `#search-error` | `p`, **hidden** | Show it when "Board now" is tapped with nothing chosen. Also focus `#guest-search`. |
| `#boarding-as` | panel, **hidden** | Show it once a guest is picked (or an unlisted name is typed). |
| `#boarding-as-name` | `span` | The chosen label. |
| `#boarding-change` | button | Clear the choice, hide `#boarding-as` and focus `#guest-search`. |
| `#board-anyway` | button `aria-expanded` `aria-controls="unlisted-block"` | Toggle `#unlisted-block.hidden` and keep `aria-expanded` in sync. Focus `#unlisted-name` when it opens. |
| `#unlisted-block` | field, **hidden** | Holds the unlisted guest's name input. |
| `#unlisted-name` | `input` (maxlength 60) | The unlisted guest's name. Set `aria-invalid="true"` together with `#unlisted-error`. |
| `#unlisted-error` | `p`, **hidden** | Its copy is in the markup. |

**`#tpl-result`** produces `li > button.result[data-id]`. Set `data-id` to the guest id and fill `[data-slot="label"]` with the label. The button already contains a "Board →" affordance.

**CTA on platform:** the label is "Board now". If nothing is chosen, show `#search-error` and focus the search box rather than moving on.

## 5. Passengers (`#stop-passengers`)

| Id | Contract |
|---|---|
| `#guest-list` (`ol`) | `replaceChildren()`, then one `#tpl-guest` clone per guest. |
| `#add-guest` | Show it while `guests.length < max_guests`. Clicking it appends a card with an empty name and focuses its input. |
| `#add-guest-hint` | e.g. "You can bring 1 more." Hide it when `#add-guest` is hidden. |
| `#passengers-error` (`role=alert`, **hidden**) | A stop-level error, e.g. "Pick a status for every passenger." |
| `#booked` (**hidden**) | Shown when the ticket was already saved (`getGuest(...).booked`, amendments §C). `#booked-text` gets the message ("Priya already booked seats for you both on Fri 9 Oct. …" for a couple when someone else filled it in, else "Your seats are already booked (updated …). …"). `#booked-view-pass` shows the saved ticket at the junction. |

**`#tpl-guest`** produces `li.guest-card`:

| Node / attribute | Fill or toggle |
|---|---|
| `li.guest-card[data-index]` | Set to the guest index. |
| `li.guest-card[data-status]` | `confirmed`, `waitlisted` or `regret`. **This prints the rubber stamp** (CNF, WL, REGRET) with a stamp-in animation. Remove the attribute when there's no status. |
| `li.guest-card.is-invalid` | Red solid border. Toggle it with `[data-slot="error"]`. |
| `li.guest-card.is-added` | Optional. Added cards are also detected with `:has(.guest-card__remove:not([hidden]))`. |
| `[data-slot="no"]` | 1-based passenger number. |
| `[data-slot="name"]` (`p`) | Read-only name for listed guests. Hide it on added and partner cards. |
| `.guest-card__name-field` (**hidden**) | Unhide it on added cards and on the invited-partner card (placeholder "Your partner's name", set a little smaller below 390px so it fits beside the M/F toggle; required, no remove button). `li.guest-card.is-partner` marks that card. |
| `[data-slot="gender"]` (`.gender[role=radiogroup][data-group=gender]`, **hidden**) | The M/F toggle (amendments §D): two `role=radio` buttons with `data-value="M"/"F"` and accessible names "Male"/"Female". Unhide it on added, partner and unlisted cards; set the group's `aria-label` to "<name>'s gender". Name and toggle share the `.guest-card__who` row. |
| `[data-slot="name-label"]` + `[data-slot="name-input"]` | Give the input a unique `id` (e.g. `guest-name-1`) and set the label's `htmlFor` to it. Use `aria-invalid="true"` on errors. |
| `button[data-action="remove"]` (**hidden**) | Unhide it on added cards. Set `aria-label="Remove passenger N"`. Removing the guest also calls `regret.reset(g.key)` (only ever with a key: a bare `reset()` would restart every card's joke), so their Regret joke (and a chip still on the run) goes with them (v4 §P). |
| `.chips[role=radiogroup][data-group="status"]` | Set `aria-label` to `"<name>'s status"` (or "Passenger N's status"). |
| `.chip[data-value="confirmed" / "waitlisted" / "regret"]` | Radio chips (§7). **The Regret chip** (`.chip--regret`) must route its click through `regret.handle(btn, () => setStatus(g, 'regret'), g.key)`. `g.key` is the guest's stable per-visit key (kept in state, never saved), so each card runs its own joke: three dodges, then the fourth tap selects, and re-rendering the card neither restarts nor shares it (v4 §P). A chip on the run is `position: fixed`, so it goes home (no status change) once the page scrolls more than 24px, or as soon as a scroll slides another control under it. |
| `[data-slot="error"]` (**hidden**) | Inline error text. |

## 6. Route, arrival, departure

| Id | Contract |
|---|---|
| `#mode-chips[data-group="mode"]` | Static chips with `data-value` = `local` ("Bhilwara is home", `.chip--home`, first and full width), then `train`, `bus`, `car`, `flight` (the `CONFIG.modes` order, v4 §O1). On select, also set `body.dataset.mode`. The home chip is named by `#home-label` (`aria-labelledby`) and described by `#home-sub`. |
| `#via` (**hidden**) | Flight and train only (v4 §O3): two optional questions after `#from-field`, shown one at a time, so the route stop reads mode, then "Travelling from", then where they land or get off, then how they go on. `.via::before` draws the itinerary rail, and each `.via__leg` gets a station dot that fills once its question is answered. Never blocks Next. |
| `#hub-group`, `#hub-label` (`#hub-label-text`, `#hub-label-note`) | "Landing at (best guess)" for flights, "Getting off at (optional)" for trains. app.js sets the two spans. |
| `#hub-chips[data-group="hub"]` | Rendered from `js/travel-data.js` with `#tpl-chip` whenever the mode changes (only then, so focus survives other updates): flights get `AIRPORTS`, trains get `BHILWARA_STATION` first and then `JUNCTIONS`, each nearest first, with `data-value` = the code, the name as the label, a `CODE · N km` hint (`.chip--hub`; the code is a `.hub-code` span in the body face, since DotGothic's capital I reads as an l; Bhilwara's hint is `BHL · in town`) and an `aria-label` such as "Udaipur airport (UDR), 145 km by road". When an airport's `city` names a better-known place, a `.chip__for` line says so ("for Ajmer" under Kishangarh) and the `aria-label` too ("Kishangarh airport, for Ajmer (KQH), 160 km by road"). Then `unsure` ("Not sure yet", `.chip--unsure`; it spans the row when it would sit alone). Writes `state.travel.via.hub`. |
| `#onward-group` (**hidden**), `#onward-chips[data-group="onward"]` | "Then on to Bhilwara by": shown for flights once any landing answer is picked, and for trains only for a junction (not `BHL`, not `unsure`). Chips `car` ("Car/cab"), `train`, `bus`, `unsure`; trains order them `car`, `bus`, `train`, `unsure`. Writes `state.travel.via.onward`. Picking `BHL` clears it, and changing the mode resets both answers. |
| `#from-field` | The city field's wrapper, right after the mode chips (it's the one required answer here). Hidden for locals. |
| `details#getting-there` | "Getting to Bhilwara: airports, junctions, roads" (v4 §O2): a native `<details>`, closed by default, hidden for locals. app.js fills `#gt-airports` and `#gt-junctions` (`ol.gt-list`, one `li.gt-row` per place, nearest first, laid out on the list's subgrid so the columns line up: `.gt-row__place` (`.gt-row__name` then `.gt-row__code` "(UDR)", plus `.gt-row__for` "for Ajmer" where it applies), `.gt-row__km`, `.gt-row__drive`, all `aria-hidden`, plus one `.sr-only` sentence such as "Udaipur (UDR): 145 km, about 2 hours 30 minutes by road."; below 360px the drive time drops under the km), `#gt-rail-lede` and `#gt-road` (`HIGHWAYS[0]` and `BUS_FACTS[0]`). The three parts are plain `div.getting__part`s under `h3`s (no extra landmarks). The "no commercial airport" note is static. The `data-sample` rows and chips in the markup only show in `?preview=all`; `tests/travel.test.mjs` checks their names and numbers against `js/travel-data.js`. |
| `#local-extras` (**hidden**) | Locals only (amendments §L): "Your stops" with every function lit (`#local-catches`, `#tpl-catch-row` rows) and the note to the couple (`#local-note`, `#local-note-count`, kept in step with `#note`). Locals skip the arrival and departure stops; the CTA reads "Confirm my seat". |
| `#mode-error` (**hidden**) | |
| `#from-city` | Text input (maxlength 60). `aria-invalid` on error. |
| `#city-list` (`datalist`, empty) | Fill it from `CONFIG.cities` with `new Option(city)`. |
| `#from-error` (**hidden**) | |
| `#arrive-date-chips[data-group="arrive-date"]` | Static: `2026-12-08` to `2026-12-11` and `unsure`. These match `CONFIG.arriveDates`, with labels from `formatDate`. |
| `#arrive-slot-chips[data-group="arrive-slot"]` | Static: `early`, `morning`, `afternoon`, `evening`, `night`, `unsure`. Hints match `CONFIG.slots`. |
| `#arrive-error` (**hidden**) | |
| `#depart-date-chips[data-group="depart-date"]` | Static: `2026-12-11` to `2026-12-14` and `unsure`. |
| `#depart-slot-chips[data-group="depart-slot"]` | Same values as the arrival slots. |
| `#depart-error` (**hidden**) | For the "departure before arrival" validation message. |
| `#trip-teaser` / `#trip-teaser-text` | The one-line teaser for the long-weekend map, under the departure date chips (text from `TRIP_COPY.teaser`). |
| `#catches` (`ol`) | `replaceChildren()` plus one `#tpl-catch-row` per entry of `catches()`. Re-render on every date or slot change. |
| `#note` | textarea (maxlength 500). Update `#note-count` (`"N / 500"`) on input. |
| `[data-note-kept]` (**hidden**) | One under each note box (`#note`, `#local-note`, `#regret-note`): "Your earlier note is saved…". Shown while the saved answer has a note this page can't see (`booked.has_note`; the server never sends the note itself) and the box is empty; the next save then sends `keep_note: true`. |

**`#tpl-catch-row`** produces `li.tt-row`:
- `[data-caught]` is `"true"` (lit diya) or `"false"` (unlit diya, struck-through name).
- Fill `[data-slot="name"]` with the function name.
- Fill `[data-slot="when"]` with e.g. `Thu 10 Dec · Afternoon`; Phera's is `Sat 12 Dec · 3 AM. Yes, AM.`.
- Fill `[data-slot="quip"]` with the playful line for missed functions. Leave it empty for caught ones; it collapses via `:empty`.
- Fill `[data-slot="status"]` (screen-reader only) with "You'll be there." or "You'll miss this one."

## 7. Chips (radio semantics), shared by every chip group

- **Structure:** a `.chips[role=radiogroup][data-group=…]` container holding `button.chip[role=radio][aria-checked][data-value]`.
- **Selecting a chip:** set `aria-checked="true"` on the chosen chip and `"false"` on its siblings. CSS paints the selection: rani fill, white text, stamp-like inner ring and a check mark. Status chips use their own colours instead: Confirmed is patta, Waitlisted is genda-deep with ink text, Regret is sindoor. Status chips show no check mark; the card stamp shows the choice instead.
- **Keyboard:** every chip is a `<button>`, so Enter and Space work natively. app.js adds a roving tabindex (one Tab stop per group, on the checked chip) and Arrow / Home / End keys that move and select. Arrowing onto a status group's Regret only moves focus; Space or Enter then triggers the dodge.
- **Dynamic chips:** `#tpl-chip` produces `button.chip`. Fill `[data-slot="label"]`. `[data-slot="kicker"]` and `[data-slot="hint"]` are `hidden` until you fill and unhide them. Add a modifier class (`chip--date`, `chip--slot`, `chip--unsure`, `chip--hub`) if needed. The static markup covers every fixed group; the hub and onward chips (§6) are the ones app.js renders from this template.
- **Leave kind:** `#leave-kind-chips[data-group="leave-kind"]` has `formal` and `honest` (formal is checked in the markup).

## 8. Junction (`#stop-junction`)

| Id | Contract |
|---|---|
| `#arrival-scene.scene` | Add `.is-arrived` once the stop is shown (after a frame). This drives the marigold shower (about 3–5s, runs once) and the wobbling heads. Remove it and re-add it to replay. Under reduced motion it's a static scene. The couple are `.figure` bobbleheads: `.figure__body` and `.figure__head` images stacked on one canvas, the head turning on its neck pivot from `assets/bobble/meta.json`. |
| `#travel-line` (**hidden**) | The junction's one travel line from `logic.arrivalLine` (amendments §K/§L, v4 §O1): the train booking date for `train`, the home-platform line for `local`, one verified line for `flight`, `bus` (the `BUS_FACTS` entry naming the guest's own city, e.g. Indore's overnight sleepers, else the first) and `car`. Hidden when everyone regrets. Dates, times and distances use non-breaking spaces. |
| `#tap-dhol`, `#tap-shehnai` | Buttons (72px). On click, call `baaja.dholHit()` / `baaja.shehnaiPhrase()`. |
| `#pass` (`figure.pass.is-loading`) | `renderPass` gets `state.travel` including `via`: for train and flight with a hub other than Bhilwara itself, the route row prints e.g. "BY FLIGHT · VIA UDAIPUR (UDR) · CAR" under FROM (just the code when the name won't fit). Keep `.is-loading` while `renderPass` runs; it shows the dot-matrix "Printing your ticket…" placeholder. Then set `#pass-img.src` to an object URL of `passBlob(canvas)` (the cached PNG, revoke the previous URL) and remove `.is-loading`. The figure sits in `.pass-wrap`, whose `::before` is the tilted rani card behind it. |
| `#pass-img` | `<img>` with intrinsic size 1080×1350. Its alt text is set. |
| `#pass-download` | `downloadPass(canvas, passFilename(label))` |
| `#pass-share` | `sharePass(...)` with the caption from `shareText()`: the guest's line with their own vehicle (🚂 ✈️ 🚌 🚗, or 🛺 for locals) and the dates, then for travellers the every-mode line "Train, bus, car or flight, every route ends at Bhilwara." (v4 §O1; no booking line). On `'unsupported'`, download and then unhide `#pass-wa` (only when `CONFIG.hostWhatsApp` is set). |
| `#pass-wa` (`a`, **hidden**) | Set `href` to `https://wa.me/<hostWhatsApp>?text=<encoded>`. It already has `target=_blank rel=noopener`. |
| `#pass-error` (**hidden**) | Shown if rendering fails. |
| `#leave-days` | `textContent = workingDays(...)` |
| `#leave-subject`, `#leave-body` | From `leaveEmail(kind, …)`. `#leave-body` keeps line breaks (`white-space: pre-wrap`). |
| `#leave-copy` | `navigator.clipboard.writeText(...)`, falling back to a textarea select. Confirm with the toast "Copied". |
| `#leave-mail` (`a`) | Set `href` to `mailto:?subject=…&body=…`. |
| `#trip-block`, `#trip` | "Make it a Rajasthan long weekend" (amendments §M): `mountTrip(#trip, {origin, destinations})` from `js/trip.js`, once, on the first visit to the junction. Shown for locals too. |
| `#junction-edit` | Return to passengers with the state restored. |

## 9. Regret ending (`#stop-regret-end`)

| Id | Contract |
|---|---|
| `#regret-scene` | The same bobbleheads as the junction (`.figure.is-sad`), heads drooped about 8° with a slow small wobble, colour slightly drained, under a drizzle cloud. There's nothing to toggle. |
| `#regret-sub` | Default "Your reply is saved. Still loved, always." Override it if the save hasn't happened yet. |
| `#regret-note-wrap` | Hide it if a note was already written on the departure stop. |
| `#regret-note`, `#regret-note-count` | Same behaviour as `#note` / `#note-count`. |
| `#regret-note-save` | Re-submit with the note (or submit for the first time, depending on the flow). Use `aria-busy` while saving. |
| `#regret-edit` | Return to passengers. |

**Busts for the pass:** `renderPass` wants `heads: {a, b}` as loaded `HTMLImageElement`s. app.js preloads `assets/bobble/saumy-bust.webp` and `manorika-bust.webp` at boot and passes them once loaded; if one fails, pass.js prints a BHILWARA JN postmark instead.

## 10. Bottom CTA bar (`#cta-bar`) and `regret.js` insets

| Id | Contract |
|---|---|
| `#cta-bar` | Hide it at junction and regret-end (`hidden`), where those stops carry their own buttons. |
| `#cta-back` (**hidden**) | Unhide it from passengers onward. Its label "Back" is static. |
| `#cta-next` | The primary action. Put its text in `#cta-label`: "Board now", "Next station →" or "Confirm my seat". |
| `#cta-next[aria-busy="true"]` | Shows the spinning wheel. Set `#cta-label` to "Printing your ticket…" and add `body.is-busy` while saving. |
| `#cta-error` (`role=alert`, **hidden**) | Unhide it on a submit failure. Put the message in `#cta-error-msg` and wire the retry to `#cta-retry`. |

**`getInsets()` for `createRegretController`:**

```js
getInsets: () => ({
  top: document.querySelector('.toran').getBoundingClientRect().bottom,   // bar + hanging garland
  bottom: (() => { const c = document.getElementById('cta-bar');
                   return c.hidden ? 0 : innerHeight - c.getBoundingClientRect().top; })(),
}),
reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
```

**Styling handshake with `regret.js`:** `styles.css` already styles `.chip.rj-moving` (sindoor pill, white ring, shadow, `z-index: 59`). It also styles `.chips .rj-ghost` so the "Regret ran away →" placeholder fills the chip-grid cell. Chip styles never depend on ancestors, so the button keeps its look when it's moved to `<body>`.

## 11. Global helpers

| Id | Contract |
|---|---|
| `#announce` | Visually hidden `aria-live="polite"`. Write it as `announce = (t) => { el.textContent = ''; requestAnimationFrame(() => el.textContent = t); }`. Use it for stop changes and pass it to `createRegretController({announce})`. |
| `#toast` (`role=status`) | Set `textContent`, add `.is-shown`, and remove the class after about 2.2s. Use it for "Copied" and "Ticket downloaded". |
| `noscript` | Already in the markup. |

## 12. Z-index scale

| Layer | z-index |
|---|---|
| Decor ladis (fixed) | 1 |
| `main` | 2 |
| Sticky journey bar and CTA bar | 40 |
| Toast | 50 |
| `regret.js` moving button / bubble | 59 / 60 |

## 13. Templates at a glance

| Template | Root | Slots |
|---|---|---|
| `#tpl-result` | `li > button.result[data-id]` | `label` |
| `#tpl-guest` | `li.guest-card[data-index][data-status]` | `no`, `name`, `name-label`, `name-input`, `gender`, `error`; `[data-action="remove"]`; status chips |
| `#tpl-chip` | `button.chip[role=radio][data-value]` | `kicker`, `label`, `hint` |
| `#tpl-catch-row` | `li.tt-row[data-caught]` | `name`, `when`, `quip`, `status` |

## 14. Static-review recipe

To review the design without `app.js`, open `http://localhost:8080/?preview=all` at 375×812. Every stop is stacked under a dashed `stop · <name>` label, with sample data, error states and the arrival scene visible.
