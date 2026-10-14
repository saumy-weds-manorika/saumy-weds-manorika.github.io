# Save the Train: Shaadi (family) edition

Date: 2026-10-14. Approved by Saumy in chat ("yes, go ahead and build it").

## Why

The friends edition (root of the site, `friends-v1.0`) searches Saumy's private guest list and speaks in
Saumy's voice. The family wants to send the same invite to relatives and family friends on both sides,
who are not on any list. This edition removes the list entirely and asks each guest which side they are
from. The friends edition, its Sheet and its Apps Script stay exactly as they are.

## Where it lives

- Link: `https://saumy-weds-manorika.github.io/shaadi/` (a `shaadi/` folder in the same repo).
- `shaadi/` is a full copy of the site (index.html, css, js), changed freely. It loads the shared art,
  band audio and preview image from `../assets/`. Nothing at the repo root changes.
- On-device storage uses its own keys (`stt.shaadi.*`), because both editions share one origin.
- Its own backend: `apps-script-shaadi/Code.gs`, pasted into a new, empty Google Sheet. No guest list,
  no search, no personal links.
- GitHub: tag + Release `friends-v1.0` on 7c73d45 (the final friends edition) and `shaadi-v1.1` on the
  final commit of this edition. A root README links both.

## Flow

1. **Platform.** The cover ticket and timetable as before. Below it, "Which side are you from?":
   - Left: Saumy's bobblehead (body + wobbling head), with four blue-outlined tabs under it:
     Ladke Wale · Mayra (Ladke Wale) · Ladke Ke Dost · Ladke Ke Family Friends.
   - Right: Manorika's bobblehead with four pink-outlined tabs:
     Ladki Wale · Mayra (Ladki Wale) · Ladki Ki Sakhiyaan · Ladki Ke Family Friends.
   - The eight tabs are one radio group (arrow keys move across both columns).
   - Tapping a tab selects it (filled), makes that side's bobblehead dance (hop, sway, faster head
     wobble, about 2 s) and bursts confetti from it in that side's colours plus marigold.
     Re-tapping replays it. With reduced motion: no confetti, one small bounce.
   - "Board now" needs a tab. Without one, an error appears under the picker and focus moves to it.
   - A returning phone shows "Welcome back" (View my pass / Edit my ticket / Start a new ticket)
     instead of the picker. Going Back to the platform shows the picker with the saved choice.
2. **Passenger chart.** Starts with one card; Add guest up to 6. Every card: Name (card 1: "Your
   name"), Age (required whole number 0–120), M/F (optional; card 2 guesses the opposite of card 1),
   and status Confirmed / Waitlisted / Regret. Card 1 can't be removed. The Regret joke stays, per card;
   its first line follows the side: "Do you not love Saumy?" or "Do you not love Manorika?".
   At most 2 guests ride the vehicle (unchanged).
3. **Route, arrival, departure, junction, regret ending:** unchanged behaviour (Bhilwara is home, hubs,
   Other date, boarding pass, leave kit, weekend map, tap instruments).

## Copy (third person)

- No search hints, no "As Saumy would know you", no "search your name again on another phone".
- Title / preview: "Saumy & Manorika are getting married 🚂".
- Picker lede: "Saumy & Manorika are getting married! Tap your side to board."
- Boarding pass quota: the relation in capitals (e.g. "QUOTA: LADKI KI SAKHIYAAN"), shrunk to fit.
- WhatsApp: no host number. The fallback link is `https://wa.me/?text=…` so the guest picks the chat.
- Leave email by relation: family and Mayra tabs say "a family wedding"; Dost and Sakhiyaan say
  "my close friend <Saumy|Manorika>'s wedding"; family friends say "a close family friend's wedding".
- "Ticket counter is closed" errors point to "the family member who sent you this invite".
- Mock mode (no Apps Script URL yet, or `?mock=1`) shows a small "Preview: replies aren't saved yet"
  ribbon, so nobody mistakes a demo for a saved reply.

## Data

Payload (validated identically in `shaadi/js/logic.js` and `apps-script-shaadi/Code.gs`):

```
{ action:'rsvp', id:'s-xxxxxxxx', relation:'ladke-dost', label:'<passenger 1>',
  guests:[{ name, status, gender:'M'|'F'|'', age:0..120, added?:true }],   // 1 to 6
  travel:{ mode, from, arrive:{date,slot}, depart:{date,slot}, via:{hub,onward} } | null (everyone regrets),
  note, filled_by, client:{ts,ua} }
```

Sheet tabs (setup creates them; nothing else is needed in the Sheet):

- **Responses:** ts, id, relation, label, payload_json (every submission, edits included).
- **People:** id, side, relation, label, person, gender, age, status, mode, from, hub, onward,
  arrive_date, arrive_slot, depart_date, depart_slot, note, filled_by, updated_at, added
  (one row per guest; a ticket's rows are replaced when it is edited).
- **Summary** (formulas only): people by relation and status (8 rows, side subtotals, total);
  ages of confirmed + waitlisted guests (0–5, 6–12, 13–17, 18–59, 60+) by side; locals; tickets and
  submissions; nights in Bhilwara; arrival and departure grids; arrivals by hub; pickup list (with
  relation and age); everyone who replied, grouped by relation; notes.

## Testing

- Unit tests (`tests/shaadi.*.test.mjs`): relations, age parsing, payload build/validate (6-guest cap,
  ages, relation), leave email wording, storage-key separation, mock API.
- Apps Script: the shaadi `validatePayload_` agrees with `logic.validatePayload` on a shared corpus;
  saving on fake sheets writes Responses and People (upsert on edit); Summary builds without errors.
- Browser QA in mock mode at phone width: picker, dance + confetti, 6 guests, ages, full journey,
  pass, regret, welcome back; and the friends edition still loads unchanged.
- `git diff friends-v1.0 -- index.html css js apps-script assets` stays empty.
