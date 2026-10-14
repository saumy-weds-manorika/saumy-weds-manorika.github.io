# Save the Train · Saumy weds Manorika

RSVP pre-invites for Saumy & Manorika's wedding in Bhilwara, Rajasthan (10–11 December 2026), styled as a
Shaadi Express railway ticket. Guests say who's coming and roughly how and when they travel; the answers
land in a Google Sheet that plans the stays and pickups.

There are two editions. Each has its own link, its own Google Sheet and its own release.

| Edition | Link | For | Final release |
|---|---|---|---|
| **Friends** | https://saumy-weds-manorika.github.io/ | Saumy's friends. Guests find their name on a private guest list (forgiving search, personal links). | [`friends-v1.0`](https://github.com/saumy-weds-manorika/saumy-weds-manorika.github.io/releases/tag/friends-v1.0) |
| **Shaadi (family)** | https://saumy-weds-manorika.github.io/shaadi/ | Sent by the family to relatives and family friends on both sides. Guests pick their side (Ladke Wale, Mayra, Dost, Sakhiyaan, family friends…), add up to 6 people with their ages, no guest list. | [`shaadi-v1.0`](https://github.com/saumy-weds-manorika/saumy-weds-manorika.github.io/releases/tag/shaadi-v1.0) |

## Friends edition (site root)

- Site: `index.html`, `css/`, `js/`, shared art in `assets/`.
- Backend: `apps-script/Code.gs`, attached to the Sheet that holds the guest list.
- Setup guide: [`docs/SETUP.md`](docs/SETUP.md). Spec: [`docs/superpowers/specs/2026-10-08-save-the-train-design.md`](docs/superpowers/specs/2026-10-08-save-the-train-design.md) and its amendments.
- Highlights: name search with typos and nicknames, couples sharing one ticket, the runaway Regret button, a journey track with bobblehead riders, a downloadable boarding pass, a leave-email kit and a Rajasthan long-weekend map.

## Shaadi (family) edition (`shaadi/`)

- Site: `shaadi/` (a copy of the friends edition, changed for this edition; it loads the shared art from `../assets/`).
- Backend: `apps-script-shaadi/Code.gs` (generated from `Code.template.gs` by `python tools/build-shaadi-gs.py`), pasted into a new, empty Google Sheet.
- Setup guide: [`docs/SETUP-shaadi.md`](docs/SETUP-shaadi.md). Spec: [`docs/superpowers/specs/2026-10-14-shaadi-edition-design.md`](docs/superpowers/specs/2026-10-14-shaadi-edition-design.md).
- Highlights: "Which side are you from?" with Saumy's side in blue and Manorika's in pink under their bobbleheads (a dance and confetti on every pick), ages for everyone, up to 6 people per ticket, third-person copy, the side shown as the boarding pass's quota, and a Summary by relation, side and age group.

## Development

- No build step and no dependencies: plain HTML, CSS and ES modules, hosted on GitHub Pages.
- Try either edition locally with `python -m http.server 8080` and `?mock=1` (answers stay in the browser).
- Tests: `node --test "tests/*.test.mjs"` (the `shaadi.*` files cover the family edition).
- The guest list and photos never go in this public repo (`private/` and `photos/` are git-ignored).
