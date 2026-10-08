# Setting up Save the Train

This guide connects the website to a private Google Sheet and puts it online. You don't need to write any code. It takes about 30 minutes.

**What you are setting up:**

- **A private Google Sheet.** It holds your guest list and every answer. Only you can open it.
- **A small script attached to that Sheet** (the "ticket counter"). The website talks to it to search names and save answers.
- **The website itself**, hosted free on GitHub Pages.

Until Part 5 is done, the website runs in **practice mode**. It shows 4 sample guests (Rahul Sharma, Mr & Mrs Agarwal, Ananya Iyer, Kabir Khan), and answers are kept only on that phone.

---

## How one common WhatsApp message becomes personal

You send **the same message and the same link to everyone**. The page personalises itself:

1. **The first screen asks "Who's boarding?"** The guest types 3 or more letters of their name and taps their name from the list. Names come from your private Guests tab. The page shows at most 5 matches, and only after 3 letters, so nobody can scroll through your whole list.
2. **From then on, the ticket is theirs.** Their name is printed on it. If you listed a plus-one's name, that card is already filled in. If a plus-one is invited but you didn't know the name, they get an **Add guest** button. People without a plus-one never see that button.
3. **Their phone remembers them.** Next time they open the link, it says "Welcome back, Rahul" with **View my pass** and **Edit my ticket**.
4. **Someone you forgot to list** can tap **Not on the list? Board anyway** and type their name. They show up in the Summary tab under **Unlisted guests**, so you can check them.

**Optional:** you can also give someone a **personal link** that skips the search and opens straight to their ticket (see Part 8). It's useful for a few people, like elders or very common names. You don't need it for everyone.

**A sample common message** (edit freely):

> 🚂 The Shaadi Express is boarding! Saumy & Manorika, 10–12 Dec, Bhilwara.
> Tap the link, find your name and grab your seat (takes a minute): <your website link>
> Train booking for 9 Dec opens on 10 Oct at 8 AM, so plan early!

---

## Part 1: Create the Sheet and paste the script

1. Open [sheets.new](https://sheets.new) (or Google Drive → **New** → **Google Sheets**). Click **Untitled spreadsheet** at the top left and rename it **Save the Train RSVPs**.
2. In the Sheet's menu, click **Extensions** → **Apps Script**. A new tab opens with a code editor.
3. Click **Untitled project** at the top and rename it **Save the Train**.
4. In this repo, open `apps-script/Code.gs`. On GitHub, click the **Copy raw file** button (two overlapping squares) at the top right of the file.
5. Back in Apps Script, click inside the code area. Select everything (**Ctrl+A**, or **Cmd+A** on a Mac), delete it, then paste (**Ctrl+V** / **Cmd+V**).
6. Show the settings file. In the left sidebar, click the **gear icon (Project Settings)**. Tick **Show "appsscript.json" manifest file in editor**.
7. Click the **< > icon (Editor)** in the left sidebar. A file called **appsscript.json** now appears in the file list. Click it, select everything, delete it, and paste in the contents of `apps-script/appsscript.json` from this repo.
8. Click the **Save project** icon (a floppy disk) in the toolbar, or press **Ctrl+S** / **Cmd+S**.

## Part 2: Run setup once

9. Click **Code.gs** in the file list. In the toolbar, open the function dropdown next to **Debug**, choose **setup**, then click **Run**.
10. Google asks for permission the first time:
    1. **Authorization required** → click **Review permissions**.
    2. Choose your Google account.
    3. You will see **"Google hasn't verified this app"**. Click **Advanced**, then **Go to Save the Train (unsafe)**.
    4. Click **Allow**. If you see checkboxes instead, tick **Select all**, then click **Continue**.

    **Why this is safe:** it's your own script, running in your own Google account. Google shows this warning for any personal script that hasn't been through its app review. The script can only reach your spreadsheets, and it only ever opens this one.
11. Wait for **Execution completed** in the **Execution log** at the bottom.
12. Go back to the Sheet tab. You now have four tabs: **Summary**, **People**, **Guests** and **Responses**. Reload the page. A **Save the Train** menu appears next to **Help**. You can run the next steps from that menu.

## Part 3: Add your guests

13. Open the **Guests** tab. Add **one row per invite**, starting on row 2:

    | Column | What to put | Example |
    |---|---|---|
    | `id` | **Leave blank.** The script fills it in (step 14). | |
    | `label` | The name printed on the ticket, which is also what people search for | `Rahul Sharma`, `Mr & Mrs Agarwal` |
    | `names` | Each person's name, separated by a `\|` (the key above Enter; press **Shift + \\**). You can leave it empty; the label is then used as the first guest. | `Rahul Sharma\|Priya Sharma` |
    | `max_guests` | `1` = just them. `2` = plus-one invited. | `2` |
    | `notes` | Anything for yourself. It never appears on the website. | `college gang` |

    How to fill in your list:
    - **Plus-one invited, name known:** label `Rahul Sharma`, names `Rahul Sharma|Priya Sharma`, max_guests `2`. Priya's card is pre-filled.
    - **Plus-one invited, name unknown:** label `Kabir Khan`, names `Kabir Khan`, max_guests `2`. Kabir gets an **Add guest** button.
    - **No plus-one:** label `Ananya Iyer`, names `Ananya Iyer`, max_guests `1`.
    - **Couple, first names unknown:** label `Mr & Mrs Agarwal`, names `Mr Agarwal|Mrs Agarwal`, max_guests `2`.

    Search matches the **start of any word** in `label` or `names`. So with names `Rohit Agarwal|Sneha Agarwal`, typing "roh", "sne" or "agar" all find the Agarwals.

    **Importing from a CSV instead:** `tools/guests-template.csv` shows the format. Open the Guests tab, then **File** → **Import** → **Upload** and pick your file. Set **Import location** to **Replace current sheet**, **untick** "Convert text to numbers, dates, and formulas", then click **Import data**. Afterwards delete the 4 sample rows, and run **Save the Train** → **Set up / repair tabs**. That run is safe and never deletes answers.

    > **Privacy:** keep your real guest list **only in this Sheet**. Never add it to the GitHub repo, which has to be public for free GitHub Pages hosting. The CSV in the repo has sample names only.

14. Click **Save the Train** → **Fill in missing guest ids**. Every row with a label gets a short id like `k7m2`. Run it again whenever you add guests. **Don't change an id after that guest has answered**, because their answers are filed under it.

## Part 4: Put the ticket counter online

15. In the Apps Script tab, click the blue **Deploy** button (top right) → **New deployment**.
16. Click the **gear icon** next to **Select type** and choose **Web app**. Fill in:
    - **Description:** `v1`
    - **Execute as:** **Me** (your email)
    - **Who has access:** **Anyone**. Choose plain **Anyone**, not "Anyone with Google account". Otherwise guests would have to sign in.
17. Click **Deploy**. If it asks you to **Authorize access**, repeat step 10.
18. Copy the **Web app URL**. It starts with `https://script.google.com/macros/s/` and ends with `/exec`.
19. **Check it works:** paste the URL into a new browser tab. You should see something like `{"ok":true,"service":"save-the-train",...}`. Then add `?action=find&q=rah` to the end of the URL (use 3 letters of a real guest's name). You should see that guest in `matches`.

## Part 5: Connect the website

20. In this repo on GitHub, open `js/config.js` and click the **pencil icon (Edit this file)**. Fill in these three lines, keeping the quotes and the comma at the end:

    ```js
    apiUrl: 'https://script.google.com/macros/s/AKfy...your-id.../exec',
    hostWhatsApp: '919812345678',   // your WhatsApp: 91 + 10-digit number, no + or spaces
    siteUrl: 'https://saumy-weds-manorika.github.io/',
    ```

    `hostWhatsApp` turns on the **Send it to Saumy on WhatsApp** button that guests see after they confirm (on phones that can't share the image directly). `siteUrl` is added to the text guests share and to their calendar reminders. Click **Commit changes…**, then **Commit changes**.
21. **Turn on GitHub Pages:** in the repo, click **Settings** → **Pages** (left sidebar). Under **Build and deployment**, set **Source** to **Deploy from a branch**, **Branch** to **main** and the folder to **/ (root)**, then click **Save**. After 1–2 minutes the page shows your address. This repo is called `saumy-weds-manorika.github.io`, so the address is `https://saumy-weds-manorika.github.io/`. GitHub's free plan needs the repo to be public. That's fine, because the repo holds no guest data.
22. **The WhatsApp preview card.** When you paste the link into WhatsApp, it shows a picture and a title. WhatsApp only finds the picture through a full web address, so `index.html` lists it in three lines near the top: `og:url`, `og:image` and `twitter:image`. They already point at `https://saumy-weds-manorika.github.io/`. **Only if your address is different**, edit those three lines to match (keep `assets/og.png` at the end of the two image lines).
23. **For personal links only:** `SITE_URL` at the top of `Code.gs` is already set to the same address. If your address is different, change it, save, then publish a new version (Part 7).

### Launch checklist

Tick these off before you send the common message:

- [ ] `apiUrl` in `js/config.js` is your `/exec` URL: searching your own name finds you, and the sample guests (Rahul Sharma and co.) no longer appear.
- [ ] `hostWhatsApp` is your number, digits only with `91` in front.
- [ ] `siteUrl` in `js/config.js` (and the three preview lines in `index.html`, and `SITE_URL` in `Code.gs`) match the address GitHub Pages shows.
- [ ] Opening `https://saumy-weds-manorika.github.io/assets/og.png` shows the ticket picture.
- [ ] You sent the link to yourself on WhatsApp and the preview shows the picture and title. WhatsApp remembers previews for a while, so if you fixed something, test with the link plus `?v=2` at the end.
- [ ] Part 6 below works end to end.

## Part 6: Test it end to end

24. Send the website link to yourself on WhatsApp and open it **from inside WhatsApp**. That's how guests will see it.
25. Search for your own name, choose **Confirmed**, add rough travel details, and tap **Confirm my seat**. Then check the Sheet:
    - **Responses** has a new row. This tab is a log, so every submission or edit adds a row.
    - **People** has one row per person on your ticket.
    - **Summary** counts have gone up.
26. Tap **Edit my ticket**, change something, and submit again. In **People**, your rows are **replaced**, not duplicated.
27. Clean up your test: right-click your row numbers in **People** and **Responses** → **Delete row**.

**Practice mode:** add `?mock=1` to the website address to try the whole journey without touching the Sheet. Add `?mock=1&mockfail=1` to see what guests see when the connection fails. Practice mode keeps its own memory on your phone, so it never mixes with (or replaces) your real ticket.

## Part 7: After any change to Code.gs (important)

The website keeps using the **old** script until you publish a new version:

28. **Deploy** → **Manage deployments** → select your deployment → **pencil icon (Edit)** → **Version**: **New version** → **Deploy**.

The URL stays the same. **Don't** use **New deployment** for updates, because that creates a new URL the website doesn't know about.

You **don't** need to redeploy when you edit the **Guests** tab. New guests and name fixes are live straight away. Just run **Fill in missing guest ids** for new rows.

## Part 8 (optional): Personal links

29. Click **Save the Train** → **Show personal links**. A box lists one line per guest, such as `Rahul Sharma: https://saumy-weds-manorika.github.io/?g=k7m2`. Copy a line into that person's chat. Their page skips the search and opens with their name.

You can also run **listPersonalLinks** from the Apps Script toolbar and read the list in the **Execution log**. `SITE_URL` (step 23) must match your address first.

## Part 9 (optional): Your photos as the bobblehead heads

Until you add photos, the couple appear as drawn caricature heads.

30. Make two **square PNG images with a transparent background**, about 512 × 512 pixels, of just the head (a cut-out face works best). Name them exactly `saumy-head.png` and `manorika-head.png`.
31. In the repo on GitHub, open the `assets/couple/` folder, click **Add file** → **Upload files**, drop both PNGs in, then **Commit changes**.
32. Open `index.html`, click the pencil icon, find `data-heads="svg"` on the `<body …>` line (near the top, after the `</head>` line) and change it to `data-heads="png"`. Commit.

The site, the bobbleheads and the boarding pass now use your photos. If a photo is missing, the drawn head is shown instead. (Step 32 is a switch so the site doesn't look for photos that aren't there yet.)

---

## Reading the Summary tab

The Summary tab updates by itself. Don't type in it. If it ever looks broken, run **Save the Train** → **Set up / repair tabs** to rebuild it.

- **Headcount:** people Confirmed / Waitlisted / Regret, tickets received, unlisted tickets, and invites not answered yet.
- **Nights in Bhilwara:** how many people sleep there each night, from 8 to 13 Dec. Use it for room planning. Someone counts for a night if they arrive on or before that date and leave after it. "Not sure yet" counts as arriving 9 Dec and leaving 12 Dec.
- **Arrivals / Departures:** people per date and time of day. Use them for pickups and drop-offs.
- **Pickup list:** everyone Confirmed or Waitlisted, sorted by arrival date and time of day, with where they're coming from and how.
- **To the right:** **Not replied yet** (handy for reminders), **Unlisted guests**, and **Notes from guests**.

Times of day: **Early morning** = before 8 AM · **Morning** = 8 AM–noon · **Afternoon** = noon–4 PM · **Evening** = 4–8 PM · **Night** = after 8 PM.

All travel answers are **tentative**. Guests can change them any time from the same phone, and their latest answer replaces the old one.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| The site says **"Couldn't reach the ticket counter"** | Check that `apiUrl` in `js/config.js` is the exact `/exec` URL. Check that **Who has access** is **Anyone**. If you edited Code.gs, publish a new version (Part 7). Open the `/exec` URL in a private/incognito window: if it asks you to sign in, access isn't set to Anyone. |
| **Search finds nobody** | The guest needs both a `label` and an `id` (run **Fill in missing guest ids**). Search needs 3+ letters and matches the start of words: "rah" finds Rahul, "hul" doesn't. |
| **"We couldn't find your name on the passenger list"** after submitting | That guest's `id` was changed or deleted in the Guests tab. Put it back. |
| **"This ticket has more passengers than your invite allows"** | Set that guest's `max_guests` to `2`. |
| The Summary tab shows **#REF!** or errors | Don't type inside Summary, and don't rename tabs or the header row of People/Responses. Run **Save the Train** → **Set up / repair tabs**. |
| You edited a row in **People** by hand and it changed back | People is rewritten whenever that guest updates their ticket. Keep your own notes in the Guests tab's `notes` column. |
| Answers stop saving after a very long time | As a spam guard, the script stops at 5,000 submissions. Archive old rows from **Responses** (copy them to another tab, then delete them). |

---

## For developers

Unit tests need Node 18 or newer and no installs: run `node --test "tests/*.test.mjs"` (or just `node --test`) from the repo root.
