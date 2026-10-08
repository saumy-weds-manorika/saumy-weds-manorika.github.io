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
| `body[data-mode]` | `train` `flight` `bus` `car` | app, whenever the mode chip changes (initial: `train`) | Swaps the vehicle on the journey track. Steam puffs show only for `train`. |
| `body[data-party]` | `confirmed` `waitlisted` `regret` | app: `overallStatus(state.guests)` from `logic.js` on every status change (initial: `confirmed`) | `waitlisted` swaps `.v-cnf` copy for `.v-wl` copy (route, arrival and departure titles; junction heading). `regret` tilts the mini-board heads sadly. |
| `body[data-heads]` | `svg` `png` | static markup, or app (see §9) | Tells app.js whether to swap the head images to the PNGs. |
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
  7. Announce it: `announce('Stop 2 of 4: Route')`.
- **Copy variants:** `.v-cnf` and `.v-wl` spans sit inside `#t-route`, `#t-arrival`, `#t-departure`, `#t-junction` and the junction lede. Only `body[data-party]` controls them, so there's no JS text swapping.

## 3. Journey bar (sticky, `header#journey-bar`)

| Hook | Notes |
|---|---|
| `#journey` `style="--progress: N"` | Sets progress: `journey.style.setProperty('--progress', String(n))` with `n` from 0 to 1. It's a registered `@property` with a 1.1s transition. The vehicle glides, the lit rail grows, and each `.journey__station` lights up automatically as the vehicle passes its `--at` value, so there are no per-station classes to manage. |
| `#journey.is-moving` | Add it when progress changes and remove it after about 1100ms (or on `transitionend` where `e.propertyName === '--progress'`). It drives the chug bob and the steam puffs. |
| `.journey__station[data-stop]` | Static dots at `--at` = 0, .2, .4, .6, .8. Read-only. |
| `.vehicle__svg[data-mode]` | Four inline SVGs. CSS shows the one that matches `body[data-mode]`, so app.js only sets `data-mode`. |
| `#baaja-toggle[aria-pressed]` | Set `aria-pressed="true"` or `"false"` to match `baaja.toggle()`. The icon is a dhol, struck through when off. Its accessible name is static ("Baaja: wedding band sound"). |
| `.mini-board`, `.mini-board__head[data-head="a"/"b"]` | Decor, `aria-hidden`. The heads hop on `body[data-stop="junction"]` and droop on `body[data-party="regret"]`. |
| `.toran` | The garland hanging 20–30px below the bar, with no pointer events. Count it in regret insets (§10). |

## 4. Platform (`#stop-platform`)

| Id | Element | Contract |
|---|---|---|
| `#cover` | `article.ticket.cover` | Static cover ticket with the timetable. No hooks. |
| `#welcome` | panel, **hidden** by default | Show it when `local.load()` returns a record, and hide `#search-block`. |
| `#welcome-name` | `p` | `textContent = record.label` |
| `#welcome-view-pass` | button | Go to the junction with the saved payload. |
| `#welcome-edit` | button | Restore the state and go to passengers. |
| `#welcome-reset` | link-style button | Optional "Someone else? Start a new ticket": clear the local record and show `#search-block`. Hide it if not used. |
| `#search-block` | wrapper | The whole "Who's boarding?" area. |
| `#guest-search` | `input[type=search]` | Debounce 250ms, call `findGuests(q)` when `q.trim().length >= 3`, and render rows into `#search-results`. |
| `#search-results` | `ul` | `replaceChildren()` and then append `#tpl-result` clones. It collapses when empty (`:empty`). |
| `#search-empty` | `p`, **hidden** | Show it when a 3+ character query returns `[]`. Its copy is already in the markup. |
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

**`#tpl-guest`** produces `li.guest-card`:

| Node / attribute | Fill or toggle |
|---|---|
| `li.guest-card[data-index]` | Set to the guest index. |
| `li.guest-card[data-status]` | `confirmed`, `waitlisted` or `regret`. **This prints the rubber stamp** (CNF, WL, REGRET) with a stamp-in animation. Remove the attribute when there's no status. |
| `li.guest-card.is-invalid` | Red solid border. Toggle it with `[data-slot="error"]`. |
| `li.guest-card.is-added` | Optional. Added cards are also detected with `:has(.guest-card__remove:not([hidden]))`. |
| `[data-slot="no"]` | 1-based passenger number. |
| `[data-slot="name"]` (`p`) | Read-only name for listed guests. Hide it on added cards. |
| `.guest-card__name-field` (**hidden**) | Unhide it on added cards. |
| `[data-slot="name-label"]` + `[data-slot="name-input"]` | Give the input a unique `id` (e.g. `guest-name-1`) and set the label's `htmlFor` to it. Use `aria-invalid="true"` on errors. |
| `button[data-action="remove"]` (**hidden**) | Unhide it on added cards. Set `aria-label="Remove passenger N"`. |
| `.chips[role=radiogroup][data-group="status"]` | Set `aria-label` to `"<name>'s status"` (or "Passenger N's status"). |
| `.chip[data-value="confirmed" / "waitlisted" / "regret"]` | Radio chips (§7). **The Regret chip** (`.chip--regret`) must route its click through `regret.handle(btn, () => setStatus(i, 'regret'))`. |
| `[data-slot="error"]` (**hidden**) | Inline error text. |

## 6. Route, arrival, departure

| Id | Contract |
|---|---|
| `#mode-chips[data-group="mode"]` | Static chips with `data-value` = `train`, `flight`, `bus`, `car`. On select, also set `body.dataset.mode`. |
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
| `#catches` (`ol`) | `replaceChildren()` plus one `#tpl-catch-row` per entry of `catches()`. Re-render on every date or slot change. |
| `#note` | textarea (maxlength 500). Update `#note-count` (`"N / 500"`) on input. |

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
- **Dynamic chips:** `#tpl-chip` produces `button.chip`. Fill `[data-slot="label"]`. `[data-slot="kicker"]` and `[data-slot="hint"]` are `hidden` until you fill and unhide them. Add a modifier class (`chip--date`, `chip--slot`, `chip--unsure`) if needed. The static markup already covers every fixed group, so you only need this template if you choose to render from `CONFIG`.
- **Leave kind:** `#leave-kind-chips[data-group="leave-kind"]` has `formal` and `honest` (formal is checked in the markup).

## 8. Junction (`#stop-junction`)

| Id | Contract |
|---|---|
| `#arrival-scene.scene` | Add `.is-arrived` once the stop is shown (after a frame). This drives the marigold shower (about 3–5s, runs once), the bobbling heads and the waving arms. Remove it and re-add it to replay. Under reduced motion it's a static scene. |
| `#tap-dhol`, `#tap-shehnai` | Buttons (72px). On click, call `baaja.dholHit()` / `baaja.shehnaiPhrase()`. |
| `#pass` (`figure.pass.is-loading`) | Keep `.is-loading` while `renderPass` runs; it shows the dot-matrix "Printing your ticket…" placeholder. Then set `#pass-img.src` to an object URL of `passBlob(canvas)` (the cached PNG, revoke the previous URL) and remove `.is-loading`. The figure sits in `.pass-wrap`, whose `::before` is the tilted rani card behind it. |
| `#pass-img` | `<img>` with intrinsic size 1080×1350. Its alt text is set. |
| `#pass-download` | `downloadPass(canvas, passFilename(label))` |
| `#pass-share` | `sharePass(...)`. On `'unsupported'`, download and then unhide `#pass-wa` (only when `CONFIG.hostWhatsApp` is set). |
| `#pass-wa` (`a`, **hidden**) | Set `href` to `https://wa.me/<hostWhatsApp>?text=<encoded>`. It already has `target=_blank rel=noopener`. |
| `#pass-error` (**hidden**) | Shown if rendering fails. |
| `#booking` (section, **hidden**) | Unhide it only when `travel.mode === 'train'`. |
| `#booking-list` (`ul`) | `replaceChildren()` plus one `#tpl-booking` per leg. Onward uses the arrival date, or the day before for an early/morning arrival (overnight train). Return uses the departure date. A `Not sure yet` side gets one card listing every candidate date's window. |
| `#leave-days` | `textContent = workingDays(...)` |
| `#leave-subject`, `#leave-body` | From `leaveEmail(kind, …)`. `#leave-body` keeps line breaks (`white-space: pre-wrap`). |
| `#leave-copy` | `navigator.clipboard.writeText(...)`, falling back to a textarea select. Confirm with the toast "Copied". |
| `#leave-mail` (`a`) | Set `href` to `mailto:?subject=…&body=…`. |
| `#junction-edit` | Return to passengers with the state restored. |

**`#tpl-booking`** produces `li.booking-card`:

| Hook | Contract |
|---|---|
| `li.booking-card[data-state]` | `upcoming` or `open`. With `open`, CSS hides the countdown and the reminder actions and shows `[data-slot="open-now"]` (text plus an "Open IRCTC" link, `[data-slot="irctc"]`). With `upcoming`, it hides `open-now`. |
| `[data-slot="leg"]` | e.g. `Onward · Wed 9 Dec` or `Return · Sat 12 Dec` |
| `[data-slot="opens-verb"]` | `Opens` or `Opened` |
| `[data-slot="opens"]` | e.g. `Sat 10 Oct, 8:00 AM` |
| `[data-slot="countdown"]` | e.g. `in 1 day 23 h`. Tick it every minute while the stop is visible. |
| `[data-slot="dates"]` (`ul`, **hidden**) | "Not sure yet" cards: one `li[data-state]` per candidate date with two spans (date, "opens …" / "open now"). |
| `[data-slot="note"]` (**hidden**) | A short explanation, e.g. the overnight-train note. |
| `[data-slot="open-now"]` | Pre-filled: "Booking is open now. Book today." |
| `[data-slot="gcal"]` | `href = calendarUrl(...)`. The link text "Add 7:50 AM reminder" is in the markup. |
| `[data-slot="ics"]` | `href = URL.createObjectURL(new Blob([icsText(...)], {type: 'text/calendar'}))`. Set the `download` attribute to a filename. |

## 9. Regret ending (`#stop-regret-end`)

| Id | Contract |
|---|---|
| `#regret-scene` | Static sad couple (`.bobble.is-sad`, arms down, drizzle cloud, `*-head-sad.svg` placeholders with a frown and a tear). There's nothing to toggle. With photo heads (`data-heads="png"`) CSS greys them slightly and shows `.bobble__tear`. |
| `#regret-sub` | Default "Your reply is saved. Still loved, always." Override it if the save hasn't happened yet. |
| `#regret-note-wrap` | Hide it if a note was already written on the departure stop. |
| `#regret-note`, `#regret-note-count` | Same behaviour as `#note` / `#note-count`. |
| `#regret-note-save` | Re-submit with the note (or submit for the first time, depending on the flow). Use `aria-busy` while saving. |
| `#regret-edit` | Return to passengers. |

**Head images:** every `img[data-head="a" or "b"]` (two on the mini board and one in each scene) carries `src` = the SVG placeholder and `data-png` = the future PNG path. To avoid a 404 in the console, app.js should swap only when `document.body.dataset.heads === 'png'`. Saumy changes that attribute in `index.html` once the PNGs are added (docs/SETUP.md, Part 9):

```js
if (document.body.dataset.heads === 'png') {
  document.querySelectorAll('img[data-head]').forEach((img) => {
    const svg = img.src;
    img.onerror = () => { img.onerror = null; img.src = svg; };
    img.src = img.dataset.png;
  });
}
```

`renderPass` wants `heads: {a, b}` as loaded `HTMLImageElement`s. Pass `document.querySelector('.bobble--a img')` and `document.querySelector('.bobble--b img')` once each has `complete && naturalWidth`.

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
| `#tpl-guest` | `li.guest-card[data-index][data-status]` | `no`, `name`, `name-label`, `name-input`, `error`; `[data-action="remove"]`; status chips |
| `#tpl-chip` | `button.chip[role=radio][data-value]` | `kicker`, `label`, `hint` |
| `#tpl-booking` | `li.booking-card[data-state]` | `leg`, `opens-verb`, `opens`, `countdown`, `dates`, `note`, `open-now`, `irctc`, `gcal`, `ics` |
| `#tpl-catch-row` | `li.tt-row[data-caught]` | `name`, `when`, `quip`, `status` |

## 14. Static-review recipe

To review the design without `app.js`, open `http://localhost:8080/?preview=all` at 375×812. Every stop is stacked under a dashed `stop · <name>` label, with sample data, error states and the arrival scene visible.
