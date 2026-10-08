# Setting up Save the Train

This guide connects the website to your own guest list (`Wedding Invites.xlsx`) in Google Sheets and puts the site online. You don't need to write any code. It takes about 30 minutes.

**What you are setting up:**

- **Your guest list as a private Google Sheet.** `Wedding Invites.xlsx` goes into your Google Drive and becomes a Google Sheet. Its **First List** and **Second List** tabs stay as they are. The script adds an ID column and three tabs for the answers. Only you can open it.
- **A small script attached to that Sheet** (the "ticket counter"). The website talks to it to search names and save answers.
- **The website itself**, hosted free on GitHub Pages.

Until Part 5 is done, the website runs in **practice mode**. It shows 6 made-up guests (Rahul Sharma & Priya Sharma, Arjun Mehra & Tara, Mr & Mrs Kabir Khan, Ananya Iyer, Isha Agarwal and Rohan Mehta), and answers are kept only on that phone.

---

## How one common WhatsApp message becomes personal

You send **the same message and the same link to everyone**. The page personalises itself:

1. **The first screen asks "Who's boarding?"** The guest types their first or full name and taps it in the list. Search is forgiving: a first name is enough, small spelling slips are fine ("Agrawal" finds "Agarwal"), an extra middle name is fine, and anything in your **Nicknames** column works too. It shows at most 5 matches, and only after 3 letters, so nobody can scroll through your whole list.
2. **From then on, the ticket is theirs.** The names from your list are already on it. If Guest 2 on your list is just `Mrs`, `Mr` or `Ms`, they type their partner's name. Anyone can tap **Add guest** (up to 4 people per ticket). Added people are marked in the **People** tab and listed in **Summary** under **Extra guests added**, so you'll always see them.
3. **Couples share one ticket.** When **Both Primary?** is `Y`, either of them can open the link. If one has already booked, the other sees that ticket ("Priya already booked seats for you both…") and can check or change it. The latest answer wins, and a phone that saved an older copy picks up the newer one before showing it. Notes to you stay private: whoever opens the ticket sees the passengers and travel plan, but not the note, and the note is kept unless they write a new one.
4. **Friends from Bhilwara** tap **Bhilwara is home** and skip all the travel questions. Summary counts them as **Locals** and leaves them out of the stay and pickup tables.
   **Everyone else** picks Train, Bus, Car or Flight, says roughly where they're coming from, and picks rough arrival and departure dates. Flight guests can also say where they'll land (Udaipur, Kishangarh, Jaipur or Ahmedabad), and train guests where they'll get off (Bhilwara itself or a nearby junction), plus how they'll go on to Bhilwara from there. Both questions are optional and "Not sure yet" is always there. A fold-out **Getting to Bhilwara** panel lists the nearest airports and junctions, nearest first, with road distances. At the end of the journey they get one handy line for their mode: when train bookings open, how far their airport is by road, the bus routes or the highway.
5. **Their phone remembers them.** Next time they open the link, it says "Welcome back, Rahul" with **View my pass** and **Edit my ticket**.
6. **Someone you forgot to list** can tap **Not on the list? Board anyway** and type their name. They show up in Summary under **Unlisted guests**, so you can check them.

**Personal messages:** the script can also write a personal link and a ready-to-send WhatsApp message for every guest (see Part 8), if you'd rather message people one by one.

**A sample common message** (edit freely):

> 🚂 The Shaadi Express is boarding! Saumy & Manorika · 10–11 Dec 2026 · Bhilwara.
> Tap the link, type your name and grab your seat (it takes a minute): <your website link>
> Train, bus, car or flight, every route ends at Bhilwara:
> ✈️ Flying? Udaipur and Kishangarh airports are each about 2½ hours away by road.
> 🚌 🚗 Bus or car? Bhilwara is just off NH48, with buses from Jaipur, Udaipur and Kota.
> 🎟️ Train? Bookings for Wed 9 Dec open Sat 10 Oct, 8 AM.
> It's a Thursday and Friday, so stay on and make it a Rajasthan long weekend!

---

## Part 1: Put your guest list into Google Sheets

1. Open [drive.google.com](https://drive.google.com), signed in with the Google account that should own the answers. Click **New** → **File upload** and choose `Wedding Invites.xlsx`.
2. When the upload finishes, double-click the file. It opens in Google Sheets with a small **.XLSX** badge next to its name. Click **File** → **Save as Google Sheets**. A new tab opens with the Google Sheets copy (no badge). **Use this copy from now on.** The `.xlsx` can stay in Drive as a backup; the script never touches it.
3. Check the tabs at the bottom: **First List** (your Primary list) and **Second List** (your Secondary list). The script finds them by name. Case and spaces don't matter, and a tab whose name contains "first" or "primary" counts as Primary, "second" or "secondary" as Secondary. Other tabs are ignored.
4. Check row 1 of both tabs. These are the columns the script reads:

    | Column | Header | What to put | Examples (made up) |
    |---|---|---|---|
    | A | `Guest 1` | Your friend's full name | `Meera Kapoor` |
    | B | `Gender Guest 1` | `M` or `F` | `F` |
    | C | `Guest 2` | Their partner's name. Or `Mr`, `Mrs` or `Ms` when a partner is invited but you don't know the name. Or `NA` for no partner. | `Dev Malhotra`, `Tara`, `Mrs`, `NA` |
    | D | `Gender Guest 2` | `M`, `F` or `NA` | `M` |
    | E | `Both Primary?` | `Y`: both are your friends (a couple), and either can fill in the ticket. `N`: Guest 2 is Guest 1's partner. `NA`: there's no Guest 2. | `Y` |
    | F | `Nicknames` | Optional. Other names people might type, separated by commas. Setup adds this column if it's missing. | `Annu, Annie` |
    | G | `ID` | **Leave it.** Setup fills it in (Part 3). | `k7m2` |

    What each row puts on the ticket:
    - **Guest 2 is a name:** "Meera Kapoor & Dev Malhotra". Both names are already filled in.
    - **Guest 2 is `Mrs`, `Mr` or `Ms`** (`Mrs.`, `Smt` and `Miss` work too): "Mr & Mrs Kabir Khan". Kabir is filled in, plus a card where they type their partner's name. When Guest 1 is `F` and Guest 2 is `Mr`, the ticket says "Mrs Pooja Nair & Mr Nair" (the surname is taken from Guest 1). Any other pairing says "Neha Gupta & partner".
    - **Guest 2 is `NA`:** just "Ananya Iyer".
    - Every ticket can hold **up to 4 people** using **Add guest**, so you don't need to mark plus-ones anywhere.
    - `NA`, `N/A`, `N.A.`, `-`, `--` and empty cells all mean "nothing here". Rows with an empty **Guest 1** are skipped. One row is one invite, which is one ticket.

    `tools/guests-template.csv` in this repo shows the same layout with made-up names, in case you ever start a fresh tab.

> **Privacy:** keep your real guest list **only in your Google Drive and on your own computer**. Never add it to the GitHub repo, which has to be public for free GitHub Pages hosting. Everything in the repo uses made-up names only.

## Part 2: Paste the script

5. In the Sheet's menu, click **Extensions** → **Apps Script**. A new tab opens with a code editor.

   > **No Apps Script in the Extensions menu?** Your Sheet is probably still the `.xlsx` file (it has an **.XLSX** badge next to its name). Do step 2 (**File** → **Save as Google Sheets**) and use the new copy.

   > **Use the project attached to the Sheet.** The Apps Script project you open from the Sheet's **Extensions** → **Apps Script** is the main one. Paste every update into it, run setup from it, and deploy it. Only this project can add the **Save the Train** menu to the Sheet.
   >
   > **Already made a separate project at script.google.com?** It can still work: paste the code, then put your Sheet's ID inside the quotes of `const SPREADSHEET_ID = '';` near the top of Code.gs. The ID is the long part of the Sheet's address between `/d/` and `/edit`. A separate project never gets the **Save the Train** menu, so run its functions from the Apps Script toolbar instead. Don't keep both projects live, though. Move to the Sheet's own project: paste and deploy there (Part 4), put that project's `/exec` URL in `apiUrl` (Part 5), then in the separate project click **Deploy** → **Manage deployments** → **Archive**. Otherwise an old copy of the script can keep writing to your Sheet in an old column layout.
6. Click **Untitled project** at the top and rename it **Save the Train**.
7. In this repo, open `apps-script/Code.gs`. On GitHub, click the **Copy raw file** button (two overlapping squares) at the top right of the file.
8. Back in Apps Script, click inside the code area. Select everything (**Ctrl+A**, or **Cmd+A** on a Mac), delete it, then paste (**Ctrl+V** / **Cmd+V**).
9. Show the settings file. In the left sidebar, click the **gear icon (Project Settings)**. Tick **Show "appsscript.json" manifest file in editor**.
10. Click the **< > icon (Editor)** in the left sidebar. A file called **appsscript.json** now appears in the file list. Click it, select everything, delete it, and paste in the contents of `apps-script/appsscript.json` from this repo.
11. Click the **Save project** icon (a floppy disk) in the toolbar, or press **Ctrl+S** / **Cmd+S**.

## Part 3: Run setup once

12. Click **Code.gs** in the file list. In the toolbar, open the function dropdown next to **Debug**, choose **setup**, then click **Run**.
13. Google asks for permission the first time:
    1. **Authorization required** → click **Review permissions**.
    2. Choose your Google account.
    3. You will see **"Google hasn't verified this app"**. Click **Advanced**, then **Go to Save the Train (unsafe)**.
    4. Click **Allow**. If you see checkboxes instead, tick **Select all**, then click **Continue**.

    **Why this is safe:** it's your own script, running in your own Google account. Google shows this warning for any personal script that hasn't been through its app review. The script can only reach your spreadsheets, and it only ever opens this one.
14. Wait for **Execution completed** in the **Execution log** at the bottom. Setup has now:
    - added the **Nicknames** and **ID** headers to both list tabs, if they were missing (in columns F and G when those are empty, otherwise after your last column). It never moves or changes your names;
    - given every row a short **ID** like `k7m2`, unique across both tabs;
    - added three tabs at the end: **Summary**, **People** and **Responses**.
15. Go back to the Sheet tab and reload the page. A **Save the Train** menu appears next to **Help**. You can run everything else from that menu.

**About IDs:** answers are filed under the ID, so **don't change or delete an ID after that guest has replied.** When you add guests later, add their rows (anywhere in either tab), then click **Save the Train** → **Fill in missing guest ids**. To move someone between the two tabs, cut and paste the whole row, ID included.

## Part 4: Put the ticket counter online

16. In the Apps Script tab, click the blue **Deploy** button (top right) → **New deployment**.
17. Click the **gear icon** next to **Select type** and choose **Web app**. Fill in:
    - **Description:** `v4`
    - **Execute as:** **Me** (your email)
    - **Who has access:** **Anyone**. Choose plain **Anyone**, not "Anyone with Google account". Otherwise guests would have to sign in.
18. Click **Deploy**. If it asks you to **Authorize access**, repeat step 13.
19. Copy the **Web app URL**. It starts with `https://script.google.com/macros/s/` and ends with `/exec`.
20. **Check it works:** paste the URL into a new browser tab. You should see something like `{"ok":true,"service":"save-the-train","version":"v4",...}`. Then add `?action=find&q=` and a first name from your list to the end of the URL (for example `?action=find&q=meera`). You should see that guest in `matches`.

## Part 5: Connect the website

21. In this repo on GitHub, open `js/config.js` and click the **pencil icon (Edit this file)**. Fill in `apiUrl`, keeping the quotes and the comma at the end, and check the other two lines:

    ```js
    apiUrl: 'https://script.google.com/macros/s/AKfy...your-id.../exec',
    hostWhatsApp: '919414087162', // already set: 91 + your 10-digit number, no + or spaces
    siteUrl: 'https://saumy-weds-manorika.github.io/',
    ```

    `hostWhatsApp` turns on the **Send it to Saumy on WhatsApp** button that guests see after they confirm (on phones that can't share the image directly). `siteUrl` is added to the text guests share. Click **Commit changes…**, then **Commit changes**.
22. **Turn on GitHub Pages:** in the repo, click **Settings** → **Pages** (left sidebar). Under **Build and deployment**, set **Source** to **Deploy from a branch**, **Branch** to **main** and the folder to **/ (root)**, then click **Save**. After 1–2 minutes the page shows your address. This repo is called `saumy-weds-manorika.github.io`, so the address is `https://saumy-weds-manorika.github.io/`. GitHub's free plan needs the repo to be public. That's fine, because the repo holds no guest data.
23. **The WhatsApp preview card.** When you paste the link into WhatsApp, it shows a picture and a title. WhatsApp only finds the picture through a full web address, so `index.html` lists it in three lines near the top: `og:url`, `og:image` and `twitter:image`. They already point at `https://saumy-weds-manorika.github.io/`. **Only if your address is different**, edit those three lines to match (keep `assets/og.png` at the end of the two image lines).
24. **For personal links only:** `SITE_URL` at the top of `Code.gs` is already set to the same address. If your address is different, change it, save, then publish a new version (Part 7).

### Launch checklist

Tick these off before you send the common message:

- [ ] `apiUrl` in `js/config.js` is your `/exec` URL: searching a first name from your list finds them, and the made-up practice guests (Rahul Sharma and co.) no longer appear.
- [ ] `hostWhatsApp` is your number, digits only with `91` in front.
- [ ] `siteUrl` in `js/config.js` (and the three preview lines in `index.html`, and `SITE_URL` in `Code.gs`) match the address GitHub Pages shows.
- [ ] Opening `https://saumy-weds-manorika.github.io/assets/og.png` shows the ticket picture.
- [ ] You sent the link to yourself on WhatsApp and the preview shows the picture and title. WhatsApp remembers previews for a while, so if you fixed something, test with the link plus `?v=2` at the end.
- [ ] Part 6 below works end to end.

## Part 6: Test it end to end

25. Add a test row to **First List**: Guest 1 `Test Passenger`, Gender `M`, Guest 2 `Mrs`, the rest `NA`. Click **Save the Train** → **Fill in missing guest ids**.
26. Send the website link to yourself on WhatsApp and open it **from inside WhatsApp**. That's how guests will see it.
27. Search "test", pick **Mr & Mrs Test Passenger**, type a partner name, choose **Confirmed**, add rough travel details, and tap **Confirm my seat**. Then check the Sheet:
    - **Responses** has a new row. This tab is a log, so every submission or edit adds a row.
    - **People** has one row per person on the ticket.
    - **Summary** counts have gone up, and the test invite has left **Not replied yet**.
28. Open the link on **another phone** (or a private browser window) and search "test" again. It shows the ticket you already booked. Change something (try **Bhilwara is home**) and submit. In **People**, the rows are **replaced**, not duplicated, and Summary moves you to **Locals**.
29. Clean up: delete the test row from **First List**, and its rows in **People** and **Responses** (right-click the row numbers → **Delete row**).

**Practice mode:** add `?mock=1` to the website address to try the whole journey without touching the Sheet. Add `?mock=1&mockfail=1` to see what guests see when the connection fails. Practice mode keeps its own memory on your phone, so it never mixes with (or replaces) your real ticket.

## Part 7: After any change to Code.gs (important)

The website keeps using the **old** script until you publish a new version:

30. **Deploy** → **Manage deployments** → select your deployment → **pencil icon (Edit)** → **Version**: **New version** → **Deploy**.

The URL stays the same. **Don't** use **New deployment** for updates, because that creates a new URL the website doesn't know about. The `/exec` URL's `"version"` tells you which script is live.

The **Save the Train** menu (and anything you run from the toolbar) always uses the newest *saved* code, but guests' answers go through the *published* version. That's why this step matters even when the menu already seems to work.

### Updating to v4 (where guests land or get off)

v4 adds two People columns, `hub` and `onward`, and an **Arrivals by hub** table in Summary. Saving the new code isn't enough: you need to paste it **and** publish a **New version**. Do these in order:

1. Open your Sheet, then **Extensions** → **Apps Script** (the Sheet's own project, see Part 2). Click **Code.gs**, select everything, delete it, paste the new `apps-script/Code.gs`, and click **Save project**.
2. **Deploy** → **Manage deployments** → select your deployment → **pencil icon (Edit)** → **Version**: **New version** → **Deploy**.
3. Reload the Sheet, then click **Save the Train** → **Set up / repair tabs**. This adds **hub** and **onward** to People, right after **from**, and keeps every row you already have. Older answers just leave the two new cells blank. It also rebuilds Summary.
4. Open the `/exec` URL. It should show `"version":"v4"`.

- **Publish (step 2) before running setup (step 3).** Until step 2, guests' answers still go through the v3 script, and v3 doesn't know about the new columns. If you ran setup first and someone answered in between, click **Save the Train** → **Rebuild People from Responses**. It rewrites People in the new layout from the Responses log.
- **Forgot step 3?** The v4 script adds the two People columns by itself on the next answer, but Summary only gets the new table when you run **Set up / repair tabs**.
- **Publish the v4 script before, or together with, the v4 website.** The v3 script accepts answers from the v4 website, but it drops the hub and onward answers.

### Updating for "Other date" (typed-in days)

The v4 script you've already published saves typed-in days as they are, so guests can use **Other date** as soon as the website is updated. The new code also double-checks each typed-in day the way the website does (arriving 1–11 Dec, leaving 10–31 Dec). Only the Summary tab needs it, to show the **Other dates** rows and the two extra rows in **Nights in Bhilwara**:

1. Paste the new `apps-script/Code.gs` over the old one and click **Save project**, as in step 1 above.
2. Publish a **New version**, as in step 2 above, so the published script matches the saved code. The `/exec` URL still shows `"version":"v4"`.
3. Reload the Sheet, then click **Save the Train** → **Set up / repair tabs**. This rebuilds Summary with the new rows. Answers already in People and Responses stay as they are, and typed-in days saved before this are counted straight away.

You **don't** need to redeploy when you edit **First List** or **Second List**. New guests, name fixes and nicknames are live straight away: editing a list tab clears the script's memory of the list. Just run **Fill in missing guest ids** for new rows. (If an edit ever doesn't show up in search, run **Set up / repair tabs**.)

**Keep search fast (recommended while invites are out):** Google puts an unused script to sleep, and the first search after that can take 10–20 seconds. Click **Save the Train** → **Keep search fast (wake every 5 minutes)** once. Google asks for one extra permission (to run on a timer). Turn it off later with **Stop keeping search fast**.

## Part 8: Personal links and ready-to-send messages

31. Click **Save the Train** → **Fill personal links & messages** (setup and **Fill in missing guest ids** do this too). Every guest row with an ID gets three columns:
    - **H: Personal link**, e.g. `https://saumy-weds-manorika.github.io/?g=z8q4`. It opens straight to that guest's ticket, with no search needed.
    - **I: Invite message**, a WhatsApp invite in your voice with their link: "Hi Kabir! 🚂 Manorika and I are getting married on 10–11 December 2026…". Couples marked **Both Primary? = Y** are greeted together ("Hi Meera & Dev!"). Named partners are mentioned ("you and Tara"), and unnamed partners become "you both". Until 8 AM on Sat 10 Oct the message includes the train-booking date; after that it just says bookings are open.
    - **J: Send on WhatsApp**: tap it on your phone or computer and WhatsApp opens with the message already typed. Pick the contact and send.
32. To copy a message instead: **double-click** the cell in column I, select all, copy. Copying the cell itself makes Google Sheets wrap the text in quote marks. Messages show on one line in the Sheet; the full text is inside.
33. Messages are written when you run it. **Run Fill personal links & messages again** after adding guests (for example the Second List), after fixing a name, and once after 8 AM on Sat 10 Oct (so the train line updates). It refreshes H to J for everyone, so don't hand-edit those columns. If a row shows "Duplicate ID", give one of the two rows a new ID (clear it and run **Fill in missing guest ids**) before sending.
    The columns usually land in H, I and J. If you already use those columns, they go after your last column instead, and your own columns (even ones headed "WhatsApp" or "Message") are never touched.

You can still use **Show personal links** for a quick list of every link.

---

## Reading the Summary tab

The Summary tab updates by itself. Don't type in it. If it ever looks broken, run **Save the Train** → **Set up / repair tabs** to rebuild it.

- **People:** Confirmed / Waitlisted / Regret, split by list (**Primary**, **Secondary** and **Unlisted**), plus **Locals** (Bhilwara is home) and **Extra guests added** (people added with Add guest).
- **Invites:** for each list, how many invites (rows) there are, how many have replied, how many haven't, and rows still missing an ID.
- **Nights in Bhilwara:** how many travelling guests are in town each night (9, 10 and 11 Dec), for planning stays. Someone counts for a night if they arrive on or before that date and leave after it. Two more rows cover guests who come early or stay on: **Nights before 9 Dec** counts the people who arrive before 9 Dec, and **Nights from 12 Dec on** the people who leave after 12 Dec. These two count people, not nights: someone who arrives on 5 Dec counts once, not four times. "Not sure yet" counts as arriving 9 Dec and leaving 12 Dec. Locals aren't counted.
- **Arrivals / Departures:** travelling guests per date and time of day, for pickups and drop-offs. Guests pick a date chip, or tap **Other date** and type a day in December (arriving 1–11 Dec, leaving 10–31 Dec). A typed day that isn't one of the chips (say, arriving 7 Dec or leaving 14 Dec) is counted in the **Other dates** row, just above **Not sure yet**. The pickup list shows each of them with their exact dates.
- **Arrivals by hub:** Confirmed and Waitlisted travelling guests per hub, across all dates, for planning pickups. A hub is where a guest leaves the train or the plane: on the route page, flight guests pick the airport they'll land at (UDR Udaipur, KQH Kishangarh, JAI Jaipur, AMD Ahmedabad) and train guests the station they'll get off at (BHL Bhilwara itself, or the junctions COR Chittaurgarh, AII Ajmer, UDZ Udaipur City, KOTA Kota, JP Jaipur, RTM Ratlam). Flight guests (even if they're not sure yet where they'll land) and train guests who get off at a junction then say how they'll go on to Bhilwara: car/cab, train, bus or not sure yet (getting off at Bhilwara, or a train guest who isn't sure where, isn't asked). **Then by car/cab** counts the ones coming on by road in a car or cab, so you can see how many might need a ride. Both questions are optional: **Not sure yet** has its own row, and bus and car travellers, guests who skipped the question and answers saved before v4 are under **None given**. An **Other code** row catches anything hand-edited in People that isn't one of these hubs (normally 0).
- **Pickup list:** every travelling guest who is Confirmed or Waitlisted, sorted by arrival date and time of day (typed-in days included, in date order), with where they're coming from and how, plus **Via** (their hub) and **Then by** (how they get on to Bhilwara).
- **To the right:** **Not replied yet** for First List and for Second List (the invite names, ready for a reminder), **Unlisted guests**, **Extra guests added**, and **Notes from guests**.

The **People** tab has one row per person: their list, whether they're a couple, gender, status, travel (`arrive_date` and `depart_date` are always written like `2026-12-07`, or `unsure`, whether the guest tapped a chip or typed the day; plus `hub`, where they land or get off, and `onward`, how they get on to Bhilwara: `car`, `train`, `bus` or `unsure`), `filled_by` (who filled in the ticket), `added` (TRUE when added with Add guest) and `partner` (TRUE when it's the partner name typed in for a `Mrs` / `Mr` / `Ms` invite).

Times of day: **Early morning** = before 8 AM · **Morning** = 8 AM–noon · **Afternoon** = noon–4 PM · **Evening** = 4–8 PM · **Night** = after 8 PM.

All travel answers are **tentative**. Guests can change them any time, and their latest answer replaces the old one.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| The site says **"Couldn't reach the ticket counter"** | Check that `apiUrl` in `js/config.js` is the exact `/exec` URL. Check that **Who has access** is **Anyone**. If you edited Code.gs, publish a new version (Part 7). Open the `/exec` URL in a private/incognito window: if it asks you to sign in, access isn't set to Anyone. |
| setup says **"Could not find your guest list tabs"** | Name the tabs **First List** and **Second List** (the message lists the tab names it found), then run setup again. |
| **Search finds nobody** | The row needs a **Guest 1** name and an **ID** (run **Fill in missing guest ids**). Search needs 3+ letters. If you've just edited the list, wait a minute. |
| **Someone can't find themselves by a nickname** | Add it to their **Nicknames** cell. Separate several with commas. |
| **"We couldn't find your name on the passenger list"** after submitting | That invite's **ID** was changed or deleted. Put it back. |
| **"This ticket has more passengers than your invite allows"** | A ticket holds up to 4 people. Ask them to message you about the rest. |
| The Summary tab shows **#REF!** or errors | Don't type inside Summary, and don't rename the header rows of People or Responses. Run **Save the Train** → **Set up / repair tabs**. Run it again after renaming a list tab or moving its columns, too. |
| You edited a row in **People** by hand and it changed back | People is rewritten whenever that ticket is updated. Keep your own notes in an extra column of your list tabs, after **ID**. |
| **People** looks out of date or has the wrong columns | Run **Save the Train** → **Rebuild People from Responses**. It rewrites People from the Responses log and never changes Responses. |
| The `/exec` URL doesn't show `"version":"v4"` | The new script isn't live yet. Publish a new version (Part 7). |
| People has no **hub** / **onward** columns, or Summary has no **Arrivals by hub** | Run **Save the Train** → **Set up / repair tabs** (Part 7, "Updating to v4"). |
| Summary has no **Other dates** row, or no **Nights before 9 Dec** row | Paste the newest Code.gs, then run **Save the Train** → **Set up / repair tabs** (Part 7, "Updating for Other date"). |
| People values look shifted by two columns | An old version of the script saved an answer after setup added the new columns. Make sure the `/exec` URL shows `v4` and no separate script project is still deployed (Part 2), then run **Rebuild People from Responses**. |
| Answers stop saving after a very long time | As a spam guard, the script stops at 5,000 submissions. Archive old rows from **Responses** (copy them to another tab, then delete them). |

---

## For developers

Unit tests need Node 18 or newer and no installs: run `node --test "tests/*.test.mjs"` (or just `node --test`) from the repo root. `tests/apps-script.test.mjs` loads `apps-script/Code.gs` in a sandbox and checks that its search scores and payload checks (including `travel.via`) match `js/logic.js` exactly, that it reads the list tabs as described in Part 1, that a v3 People tab is upgraded in place without losing rows, and that every Summary formula points at the right People column. For the nights table and the arrivals and departures grids (including **Other dates**), it also works out what each count would show for a few fictional People rows. To check the script's syntax, copy it to a `.js` file and run `node --check` on the copy.
