import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nthWeekday, occurrence, expandMajorEvents, seasonFor, buildPricing, feedSignals } from "./demand.mjs";
import { extractJsonLdEvents } from "./fetch-events.mjs";

const major = JSON.parse(readFileSync(new URL("../major-events.json", import.meta.url))).events;
const cfg = JSON.parse(readFileSync(new URL("../config.json", import.meta.url)));
const byName = (n) => major.find((e) => e.name === n);

test("weekday rules", () => {
  assert.equal(nthWeekday(2026, 11, "thu", 4), "2026-11-26"); // Thanksgiving
  assert.equal(nthWeekday(2027, 5, "mon", -1), "2027-05-31"); // Memorial Day
  assert.equal(nthWeekday(2026, 8, "sat", 3), "2026-08-15"); // Rubber Ducky 2026
  assert.equal(nthWeekday(2027, 9, "mon", 1), "2027-09-06"); // Labor Day
});

test("major event rules reproduce known dates", () => {
  // Rules (not the confirmed overrides) should land on the published dates.
  const noDates = (n) => ({ ...byName(n), dates: undefined });
  assert.deepEqual(occurrence(noDates("Rubber Ducky Festival"), 2026), { start: "2026-08-15", end: "2026-08-15", confirmed: false });
  assert.equal(occurrence(noDates("National Morel Mushroom Festival"), 2026).start, "2026-05-14");
  assert.equal(occurrence(noDates("Charlevoix Venetian Festival"), 2026).end, "2026-07-25");
  assert.equal(occurrence(noDates("Gaylord Alpenfest"), 2027).start, "2027-07-13");
  assert.equal(occurrence(noDates("Elk Rapids Harbor Days"), 2027).start, "2027-08-04");
  assert.equal(occurrence(noDates("Bellaire Harvest Festival"), 2026).start, "2026-09-26");
  assert.equal(occurrence(noDates("National Trout Festival"), 2026).start, "2026-04-22");
  // Bass Festival: Wednesday-Sunday after Memorial Day
  assert.deepEqual(occurrence(byName("Mancelona Bass Festival"), 2027), { start: "2027-06-02", end: "2027-06-06", confirmed: false });
  // Confirmed dates override the rule
  assert.deepEqual(occurrence(byName("National Cherry Festival"), 2027), { start: "2027-07-03", end: "2027-07-10", confirmed: true });
});

test("expand finds events across the year boundary", () => {
  const occ = expandMajorEvents(major, "2026-11-14", "2027-08-14");
  const names = occ.map((o) => o.name);
  assert.ok(names.includes("Firearm deer opener"));
  assert.ok(names.includes("National Cherry Festival"));
  assert.ok(!names.includes("Labor Day weekend"));
  assert.ok(occ.every((o, i) => i === 0 || occ[i - 1].start <= o.start));
});

test("seasons wrap the new year", () => {
  assert.equal(seasonFor("2026-12-28", cfg.pricing.seasons).name, "Holiday ski weeks");
  assert.equal(seasonFor("2027-01-01", cfg.pricing.seasons).name, "Holiday ski weeks");
  assert.equal(seasonFor("2027-07-20", cfg.pricing.seasons).name, "Summer peak");
});

test("pricing raises rates around events and clamps", () => {
  const p = { ...cfg.pricing, baseRate: 200, minRate: 150, maxRate: 400, weekendMultiplier: 1.2,
    seasons: [{ name: "Flat", from: "01-01", to: "12-31", multiplier: 1 }] };
  const occ = [{ name: "Big Fest", start: "2027-06-05", end: "2027-06-05", impact: 3, confirmed: true }];
  const nights = buildPricing(p, occ, "2027-06-01", 7); // Tue Jun 1 .. Mon Jun 7
  const get = (d) => nights.find((n) => n.date === d);
  assert.equal(get("2027-06-01").rate, 200); // plain Tuesday
  assert.equal(get("2027-06-04").rate, 350); // Fri, night before fest: 200*1.2*1.45 = 348 -> 350
  assert.equal(get("2027-06-04").minNights, 3);
  assert.equal(get("2027-06-04").level, "peak");
  assert.equal(get("2027-06-05").events[0].name, "Big Fest");
  assert.equal(get("2027-06-06").impact, 0); // Sunday after: back to normal
  const capped = buildPricing({ ...p, impactMultipliers: { 3: 3 } }, occ, "2027-06-05", 1);
  assert.equal(capped[0].rate, 400);
});

test("feed signals pick up festivals not already listed", () => {
  const occ = [{ name: "Rubber Ducky Festival" }];
  const sig = feedSignals(
    [
      { title: "39th Annual Rubber Ducky Festival Parade", start: "2027-08-21T15:00" },
      { title: "Torch Lake Blues Fest", start: "2027-07-24T12:00", end: "2027-07-25T22:00" },
      { title: "Library story time", start: "2027-07-24T10:00" },
    ],
    occ,
  );
  assert.deepEqual(sig.map((s) => [s.name, s.start, s.end]), [["Torch Lake Blues Fest", "2027-07-24", "2027-07-25"]]);
});

test("reads schema.org events embedded in chamber web pages", () => {
  const html = `<html><head>
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},
   {"@type":"Event","name":"Breakfast with Santa &amp; Friends","startDate":"2026-12-05T09:00:00-05:00",
    "endDate":"2026-12-05T11:00:00-05:00","url":"https://example.org/santa",
    "location":{"@type":"Place","name":"Mancelona Elementary","address":{"streetAddress":"201 W State St","addressLocality":"Mancelona","addressRegion":"MI"}}}]}</script>
  <script type="application/ld+json">[{"@type":"ItemList","itemListElement":[{"@type":"ListItem","item":
   {"@type":"MusicEvent","name":"Short's Live","startDate":"2026-12-12","image":["https://x/img.jpg"],"location":{"name":"Short's Brewing","geo":{"latitude":44.98,"longitude":-85.21}}}}]}]</script>
  <script type="application/ld+json">{ not json </script>
  </head></html>`;
  const [santa, shorts] = extractJsonLdEvents(html, "America/Detroit");
  assert.equal(santa.title, "Breakfast with Santa & Friends");
  assert.equal(santa.start, "2026-12-05T09:00");
  assert.equal(santa.end, "2026-12-05T11:00");
  assert.equal(santa.address, "201 W State St, Mancelona, MI");
  assert.equal(shorts.allDay, true);
  assert.equal(shorts.image, "https://x/img.jpg");
  assert.equal(shorts.lat, 44.98);
});
