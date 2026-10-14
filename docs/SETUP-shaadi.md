# Setting up Save the Train: Shaadi (family) edition

This edition is for family members to send to relatives and family friends on both sides. It lives at
**https://saumy-weds-manorika.github.io/shaadi/** and saves answers into **its own, new Google Sheet**.
The friends edition (https://saumy-weds-manorika.github.io/), its guest list and its Sheet are separate
and stay exactly as they are.

You don't need to write any code. It takes about 15 minutes.

**What's different from the friends edition**

- **No guest list and no name search.** Guests first tap **which side they're from** (Ladke Wale, Mayra (Ladke Wale), Ladke Ke Dost, Ladke Ke Family Friends under Saumy; Ladki Wale, Mayra (Ladki Wale), Ladki Ki Sakhiyaan, Ladki Ke Family Friends under Manorika). The tapped side's bobblehead dances with confetti.
- **Everyone types their own names and ages.** A ticket starts with one passenger, and **Add guest** goes up to **6**. Age is required for everyone (0 for a baby); M/F is optional.
- **No personal links.** Everybody gets the same link. A phone remembers its own ticket, so the guest can come back and edit it from the same phone.
- **Third person copy:** "Saumy & Manorika are getting married". The **Send on WhatsApp** button has no number in it, so the guest picks the chat (for example, the family member who invited them).

Until Part 4 is done, the page runs in **preview mode**: a small ribbon says "Preview: replies aren't being saved yet", and answers stay on that phone only. **Don't send the link out until the ribbon is gone.**

---

## Part 1: Make a new Google Sheet

1. Open **https://sheets.new** while signed in to the Google account that should own the replies.
2. Name it, for example, **Shaadi RSVPs**. Leave it empty.

## Part 2: Paste the script

1. In the new Sheet, open **Extensions → Apps Script**.
2. Delete everything in **Code.gs**, then paste the whole of [`apps-script-shaadi/Code.gs`](../apps-script-shaadi/Code.gs) from this repo. (Not `Code.template.gs`, and not the friends edition's `apps-script/Code.gs`.)
3. Click **Project Settings** (the gear), tick **Show "appsscript.json" manifest file in editor**, go back to the editor, open **appsscript.json** and replace it with [`apps-script-shaadi/appsscript.json`](../apps-script-shaadi/appsscript.json).
4. Click **Save** (the disk icon).

## Part 3: Run setup once

1. In the toolbar's function list pick **setup**, then click **Run**.
2. Google asks for permission the first time: **Review permissions →** your account. On "Google hasn't verified this app" click **Advanced → Go to (project name) (unsafe)**, then **Allow**. If you see checkboxes instead, tick **Select all**, then click **Continue**. It asks to see and edit your Google Sheets (it only ever opens this one) and to run on a timer (for **Keep replies fast**).
3. Go back to the Sheet tab and reload it. You'll see three tabs, **Summary**, **People** and **Responses**, and a **Save the Train** menu next to Help. The empty "Sheet1" is removed.

## Part 4: Put it online and connect the website

1. In Apps Script click **Deploy → New deployment**. Click the gear next to "Select type" and choose **Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
3. Check it: open that URL with `?action=ping` added to the end. You should see `"version":"shaadi-v1"`.
   If you see "Page not found", remove any `/u/1/` (or other number) from the address: that happens when several Google accounts are signed in.
4. Send the URL to Claude (or put it in `shaadi/js/config.js` as `apiUrl`, commit and push). The preview ribbon disappears once it's live.
5. Optional but recommended: in the Sheet, run **Save the Train → Keep replies fast**, so the first reply of the day doesn't wait for Google to wake the script up.

### Test it once

Open the link on your phone, pick a side, fill one ticket and confirm. Within a few seconds the **Responses** and **People** tabs show it, and **Summary** counts it. To clear the test afterwards, delete its rows in **Responses** (row 2 onwards), then run **Save the Train → Rebuild People from Responses**. Your phone still remembers the test ticket: open the link again and tap **Someone else? Start a new ticket** to forget it.

## After any change to Code.gs

Paste the new Code.gs, save, then **Deploy → Manage deployments → ✏️ (edit) → Version: New version → Deploy**. The `/exec` URL stays the same. Then run **Save the Train → Set up / repair tabs**.

---

## Reading the Summary tab

- **People by relation:** each of the 8 tabs by Confirmed / Waitlisted / Regret, with a total for each side and for everyone.
- **Also:** confirmed + waitlisted per side, **Locals** (Bhilwara is home), and **Tickets** (one per phone that replied).
- **Ages (confirmed + waitlisted):** 0–5, 6–12, 13–17, 18–59 and 60+ for each side, useful for food, rooms and seating.
- **Nights in Bhilwara**, **Arrivals / Departures** by date and time of day, and **Arrivals by hub** (airport or station) for pickups. Locals are left out of these.
- **Pickup list:** everyone travelling, sorted by arrival, with their age and relation.
- To the right: **Everyone who replied, by relation** (name, age, gender, status, mode, from, ticket) and **Notes from guests**.

**Duplicates:** with no guest list, someone who fills the form again on a different phone makes a second ticket. The **Ticket** column (passenger 1's name) and the times in **Responses** make that easy to spot; delete the older one's rows in Responses and run **Rebuild People from Responses**.

## For developers

- Site: `shaadi/` (a copy of the friends edition, changed for this edition; shared art comes from `../assets/`). Spec: [`docs/superpowers/specs/2026-10-14-shaadi-edition-design.md`](superpowers/specs/2026-10-14-shaadi-edition-design.md).
- Backend: edit `apps-script-shaadi/Code.template.gs`, then run `python tools/build-shaadi-gs.py`, which copies the shared helpers from `apps-script/Code.gs` into `apps-script-shaadi/Code.gs`.
- Tests: `node --test "tests/*.test.mjs"` (the `shaadi.*` files cover this edition). Try the page locally with `?mock=1`.
