# Cabin Events: local events calendar + rate planner (Mancelona, MI 49659)

Two free tools for a short-term rental in northern Michigan, refreshed automatically every morning:

1. **Things-to-do calendar for guests** (embed on the rental website). Hyper-local events from the Mancelona, Bellaire,
   Elk Rapids, East Jordan, Boyne and Gaylord chambers, Shanty Creek, Paddle Antrim and the like, within 40 miles.
   Guests can filter to **their stay dates**, by category, or search, and add events to their calendar or get directions.
2. **Rate planner for the owner** (`/owner/`). 9 months of suggested nightly rates and minimum stays, raised for
   the big local weekends: deer opener, Mancelona Bass Festival, Cherry Festival, Fourth of July on Torch Lake,
   Rubber Ducky Festival, ski holidays and more. Flags the ones to price **now**, before cheap early bookings fill them.

**Cost: $0.** GitHub Actions runs the update daily and GitHub Pages hosts it.

---

## Where the events come from

| Source | File | Notes |
|---|---|---|
| Local calendar feeds (iCal) | `config.json` → `icalFeeds` | Shanty Creek, Paddle Antrim, East Jordan Chamber, Gaylord tourism. Any WordPress "The Events Calendar" site works: add `?ical=1` to its events page. |
| Local event web pages | `config.json` → `eventPages` | Mancelona, Bellaire, Elk Rapids and Boyne chambers, Petoskey, Traverse City, Eventbrite. Reads the event data these sites publish for Google (schema.org). Paste in any events page URL; the daily log shows how many events each one gave. |
| Big annual events | `major-events.json` | Drives pricing 6–9 months out, before local calendars post anything. Each event has a rule ("3rd Saturday of August") plus confirmed dates as they're announced. |
| Owner picks | `manual-events.json` | His own recommendations, shown with a **Host pick** badge. |
| Ticketmaster / SeatGeek | optional | Off unless API keys are added. Mostly large ticketed shows, so not needed for this area. |

To see which sources are working, open the latest run under **Actions** in GitHub. Each source prints
`N events`, `skipped`, or `failed (reason)`. If a site doesn't give anything, remove it or swap in a better URL.

**Adding more local sources** (the more, the better): look on a town, venue, brewery or winery website for "Subscribe",
"iCal", "Export" or "Add to Google Calendar", and add that link to `icalFeeds`. A public Google Calendar's
"Public address in iCal format" works too. Facebook events can't be pulled automatically (Facebook blocks it).
For those, add the important ones to `manual-events.json` or `major-events.json`.

## How the suggested rates work

`rate = base rate × season × weekend × event bump`, rounded to $5 and kept between `minRate` and `maxRate`.

- **Seasons** (in `config.json`): holiday ski weeks, ski season, spring mud season, late spring, summer peak,
  late summer, fall color and late fall. Change the dates and multipliers to match his booking history.
- **Event impact** (in `major-events.json`): 1 = busier (+10%), 2 = high demand (+25%, 2-night min),
  3 = sells out (+45%, 3-night min). Prices rise from the night before an event through its last night.
- **Festivals spotted in the local feeds** (names with festival, fair, tournament, race, regatta and so on) automatically add a +10% bump.
- "Est." means the date is projected from past years. When an organizer announces the date, add it under `dates`
  in `major-events.json`.

The planner suggests rates; it doesn't change them anywhere. Copy them into Airbnb/VRBO (or upload the CSV to a
pricing tool) and use judgment. If a weekend is already booked solid at a lower price, that's a sign to push higher next year.

## One-time setup (about 15 minutes)

1. **`config.json`**: set the cabin's exact `latitude`/`longitude` (right-click the cabin in Google Maps and click the numbers to
   copy them), `propertyName`, and the pricing numbers (`baseRate`, `minRate`, `maxRate`). The placeholders are $250 / $175 / $650.
2. **Turn on Pages**: in this repository go to **Settings → Pages → Source: GitHub Actions**.
3. **Run it**: **Actions → Update events and rates → Run workflow**. After this it runs every morning by itself.
   - Guest calendar: `https://<github-username>.github.io/<repo-name>/`
   - Rate planner: `https://<github-username>.github.io/<repo-name>/owner/`

> The rate planner page isn't linked anywhere and is hidden from Google, but anyone with the exact link can open it.
> (Free GitHub Pages sites are public. A private site needs a paid GitHub plan.)

## Putting the calendar on the rental website

Paste into an "Embed code" / "Custom HTML" block (Wix, Squarespace, WordPress, Webflow, Lodgify, Hostaway, OwnerRez sites):

```html
<div data-stay-events data-accent="#0f766e"></div>
<script src="https://<github-username>.github.io/<repo-name>/widget.js" defer></script>
```

- `data-accent`: brand color · `data-title`: custom heading · `data-page-size`: events per page (default 12)
- If the site builder only allows iframes, embed `https://<github-username>.github.io/<repo-name>/` instead.
- **In booking confirmation emails**, link guests to their dates and the calendar opens on "During my stay":
  `https://his-site.com/things-to-do?checkin=2027-07-02&checkout=2027-07-06`

## Commands (optional, for running on a computer)

```bash
npm test          # tests for date rules, pricing and feed parsing
npm run fetch     # fetch events + build rates (what the daily job runs)
npm run demo      # sample guest events, for previewing the look
npm run preview   # view at http://localhost:3000
```

## Known limits

- Repeating events in iCal feeds (for example "every Thursday") show only their first date.
- Events without coordinates (most local feeds) are assumed to be nearby, since the source itself is local.
- The same event from two sources is merged when the titles match on the same day.
