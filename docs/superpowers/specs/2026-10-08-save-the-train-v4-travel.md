# Save the Train: v4, every way of getting to Bhilwara

This extends `2026-10-08-save-the-train-v2-amendments.md` (A–N). Where they disagree, this file wins.

Saumy's note: many friends will come by **bus**, **car**, or a **flight plus a bus, train or car**, so the messaging must not read as train-only. Guests should also be told the nearest **airports** (Udaipur, Jaipur, Kishangarh, Ahmedabad) and the important **railway junctions** near Bhilwara (Udaipur, Kota, Chittaurgarh, Ratlam, Ajmer, Jaipur), each list in **increasing order of distance from Bhilwara**.

## O1. Inclusive copy

The train theme ("Shaadi Express", tickets, platforms, stations) stays as a playful metaphor. Wherever real travel is discussed, all modes get equal billing.

- **Platform or cover sub-line:** "Train, bus, car or flight, every route ends at Bhilwara."
- **Route stop:**
  - heading: "How are you getting to Bhilwara?";
  - helper: "Train, bus, car, or a flight plus a short ride: tell us your best guess.";
  - mode chips in this order: **Bhilwara is home** (§L) · Train · Bus · Car · Flight.
- **Junction: exactly one travel line per mode**, using real numbers from `js/travel-data.js`:
  - **train:** the §K booking line (unchanged);
  - **flight:** "✈️ From {airport name}, Bhilwara is about {km} km by road ({drive})." If the airport is unsure: "✈️ Nearest airports: {names in distance order}.";
  - **bus:** one verified line about buses, written from `BUS_FACTS` in travel-data.js. Only use facts that research verified;
  - **car:** "🚗 Road trip! {verified highway fact, e.g. Bhilwara sits on NH48 between Ajmer and Chittaurgarh}.";
  - **local:** the §L line.
- **WhatsApp caption and `docs/SETUP.md` sample message:** mention all modes. Keep exactly one train-booking line.

## O2. "Getting to Bhilwara" panel (Route stop)

A compact, collapsible `<details>` panel, closed by default, with the summary "Getting to Bhilwara: airports, junctions, roads". It holds:
- **Nearest airports**, in increasing road distance: name (code) · {km} km · {drive}. Add a one-line note that Bhilwara itself has no commercial airport, if verified.
- **Railway:** "Bhilwara (BHL) has its own station. Big junctions nearby:", then the junctions in increasing road distance: name (code) · {km} km · {drive}.
- **By road:** one or two verified lines from `HIGHWAYS` and `BUS_FACTS`.

The data lives in **`js/travel-data.js`**:
- `AIRPORTS` (`[{ code, name, city, km, drive }]`, sorted by `km` ascending);
- `JUNCTIONS` (`[{ code, name, km, drive }]`, sorted ascending);
- `BHILWARA_STATION` (`{ code:'BHL', name:'Bhilwara' }`);
- `HIGHWAYS` (`string[]`);
- `BUS_FACTS` (`string[]`).

All values come from the verified research in `docs/travel-research.md`. `tests/travel.test.mjs` checks the sets (exactly the four airports and six junctions Saumy named), ascending order and the field shapes.

## O3. Hub and onward questions (Route stop, progressive disclosure)

- **Flight:**
  - "Landing at (best guess)": chips from `AIRPORTS` in order, each showing `{km} km`, plus "Not sure yet";
  - then "Then on to Bhilwara by": Car/cab · Train · Bus · Not sure yet.
- **Train:**
  - "Getting off at": **Bhilwara (BHL)** first, then `JUNCTIONS` in order with `{km} km`, plus "Not sure yet";
  - if a junction other than BHL is chosen: "Then on to Bhilwara by": Car/cab · Bus · Train · Not sure yet.
- **Bus, car or local:** no extra questions.
- **Defaults and resets:** when the mode changes, hub and onward reset. Selecting BHL clears onward. Both questions are optional, and Next is never blocked by them.

**Payload:** `travel.via = { hub, onward }`.
- `hub` is `''`, an airport or station code (2 to 5 uppercase letters), or `'unsure'`.
- `onward` is one of `'' | 'car' | 'train' | 'bus' | 'unsure'`.
- `buildPayload` always emits `via`, defaulting to `{ hub:'', onward:'' }`, and emits `{ hub:'', onward:'' }` for bus, car and local.
- `validatePayload` accepts a missing `via` (old clients), and rejects an invalid hub or onward.

**Backend:**
- `People` gains the columns `hub` and `onward`, added after `from`.
- `Summary` adds an **"Arrivals by hub"** table: confirmed plus waitlisted people per hub, across all arrival dates and slots, excluding locals. This is for pickup planning.

**Pass:** when present, the route row shows the hub ("via KQH · car") under FROM.

**Riders and vehicle:** these are unchanged (flight shows the plane).

## P. The Regret joke resets for each guest card (Saumy, 2026-10-08)

This replaces the page-wide counter from the original spec §3.1. Each guest card runs its own joke:

- **Taps 1–3** on a card's Regret chip dodge, with messages 1, 2 and 3.
- **Tap 4** selects Regret and shows the final "Okay, okay…" message.
- **After that**, that card's Regret selects immediately, for the rest of the visit.
- **A new card starts at 0.** That includes the second person, an unnamed partner and any added guest.
- **Stable key:** the counter is keyed by a stable per-guest key, not by the DOM element, so re-rendering a card (Back/Next, Edit my ticket, Add guest) neither resets nor shares it. Removing an added guest drops its counter. A reload resets everything.

**API:** `createRegretController(...).handle(buttonEl, onSelect, key?)`. `key` (a string) identifies the guest; app.js passes a stable per-guest id that it keeps in state and never stores in the payload. Without a `key`, the counter falls back to the element. `controller.dodges` becomes `controller.dodgesFor(key)`, while `dodges` (the total) can stay for debugging. `reset(key?)` resets one key, or all keys if none is given.

**Testing:** `dev/regret-demo.html` gets two fake cards, and both must dodge three times independently. Browser QA covers both people on the couple ticket.

## Data status

`js/travel-data.js`, `docs/travel-research.md` and `tests/travel.test.mjs` already exist, with verified values. Use them as they are, and don't re-research or change the numbers.
- Airports, nearest first: Udaipur UDR 145 km, Kishangarh KQH 160 km, Jaipur JAI 255 km, Ahmedabad AMD 410 km.
- Junctions, nearest first: Chittaurgarh COR 55 km, Ajmer AII 135 km, Udaipur City UDZ 155 km, Kota KOTA 160 km, Jaipur JP 250 km, Ratlam RTM 265 km.
- Bhilwara has no commercial airport, and its station is BHL.

## Q. Custom travel dates: "Other date" (Saumy, 2026-10-08)

Guests can type a date that isn't one of the chips. December is fixed; they type only the day.

**The chip.** Both date chip groups (`#arrive-date-chips` and `#depart-date-chips`) get an **"Other date"** radio chip, placed before "Not sure yet". Selecting it reveals an inline field right under the chips:
- a small numeric input (`inputmode="numeric"`, at most 2 characters) labelled "Day in December", followed by a fixed **"Dec"** suffix;
- a hint line: "e.g. 7".

**Rules.** These live in `js/logic.js` as `customDate(text, kind)` → `{ok:true, date:'2026-12-DD'}` or `{ok:false, error, empty?}`; see `tests/logic.custom.test.mjs`.
- **Arrival:** day 1–11. Message: "Arrival has to be on or before 11 Dec."
- **Departure:** day 10–31. Message: "Departure has to be on or after 10 Dec."
- **Anything else:** whole numbers only. Empty input gives "Type the day you arrive, e.g. 7." or "Type the day you leave, e.g. 13."
- **Format:** the stored value is always the standard `YYYY-MM-DD` string, the same as the chip dates. It goes into the payload and the Sheet unchanged.
- **Validation:** the existing departure-before-arrival check still applies. `validatePayload` (logic.js) and `validatePayload_` (Code.gs) also refuse a real date outside these ranges (only a stale or hand-made page could send one): "Pick a rough arrival date from 1 to 11 Dec (or "Not sure yet")." / "Pick a rough departure date from 10 to 31 Dec (or "Not sure yet")." Every chip date is inside them.

**State and UI.**
- While "Other date" is selected and the day is empty or invalid, the side's date is `''`. The stop then counts as incomplete, and Next shows the customDate error inline under the field.
- Typing a valid day sets the date immediately, so catches, the timetable, riders and drafts update live.
- When a saved draft, an "Edit my ticket", or a booked prefill has a December date that isn't one of the chips, the "Other date" chip is selected and the input is filled with the day. `cleanSide` must keep valid December dates that aren't chips, and still drop anything invalid.
- A draft also keeps each "Other date" field as typed, so a reload brings back a day still being typed, a wrong one, or a chip's own day typed under "Other date", exactly as the guest left it.
- A typed day that is one of that side's chip dates (arriving "9") keeps the "Other date" chip on its plain label, so no second "Wed 9 Dec" chip shows. Edit my ticket and a booked prefill show that date on its own chip.
- A paste is read whole before the 2-character limit cuts it (`pastedDay` in logic.js): " 7 ", "2026-12-07" or "7 Dec" put "7" in the field. Text with no December day in it empties the field and the error says why.
- Next with a bad day and no time of day: the day's error shows under the field, and the stop's error asks only for the time ("Pick a rough time of day. "Not sure yet" is fine.").
- The slot chips work the same as before.
- **Accessibility:** the input has a visible label; errors use `aria-describedby` and `role="alert"`.
- **Styling:** the field follows the existing form styling on mobile.

**Sheet (Code.gs Summary).**
- The arrival and departure date × slot grids add an **"Other dates"** row: people whose date is a real date but isn't one of the listed chip dates.
- The per-night stay table adds two rows: **"Nights before 9 Dec"** (people arriving before 9 Dec) and **"Nights from 12 Dec on"** (people leaving after 12 Dec).
- People rows keep `arrive_date` and `depart_date` as plain `YYYY-MM-DD` text, the same as today. The Summary formulas read a date number (a date typed into People by hand) as that same text, so it lands in the right rows.
- The pickup list already includes everyone, sorted by date.
