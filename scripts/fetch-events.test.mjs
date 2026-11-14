import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIcs, milesBetween, dedupe, categorize, toLocal } from "./fetch-events.mjs";

test("parses iCal with folding, all-day, UTC and floating times", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "SUMMARY:Winter Beer\\, Wine & Cider Fest",
    "DTSTART;TZID=America/Detroit:20261205T150000",
    "DTEND;TZID=America/Detroit:20261205T190000",
    "LOCATION:Turtle Creek\\, 123 M-72",
    "DESCRIPTION:Line one\\nand a very long line that",
    "  continues here",
    "GEO:44.80;-85.50",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "SUMMARY:Holiday Parade",
    "DTSTART;VALUE=DATE:20261128",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "SUMMARY:Library Talk",
    "DTSTART:20261201T000000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const [fest, parade, talk] = parseIcs(ics, "America/Detroit");
  assert.equal(fest.title, "Winter Beer, Wine & Cider Fest");
  assert.equal(fest.start, "2026-12-05T15:00");
  assert.equal(fest.end, "2026-12-05T19:00");
  assert.equal(fest.venue, "Turtle Creek");
  assert.match(fest.description, /and a very long line that continues here/);
  assert.equal(fest.lat, 44.8);
  assert.equal(parade.allDay, true);
  assert.equal(parade.start, "2026-11-28T00:00");
  assert.equal(talk.start, "2026-11-30T19:00"); // midnight UTC = 7pm Eastern
});

test("distance, timezone and categories", () => {
  assert.ok(Math.abs(milesBetween(40.7128, -74.006, 34.0522, -118.2437) - 2445) < 10);
  assert.equal(toLocal(new Date("2026-07-04T16:00:00Z"), "America/Chicago"), "2026-07-04T11:00");
  assert.equal(categorize("Holiday Lights Festival"), "Festivals");
  assert.equal(categorize("Guided Snowshoe Hike"), "Outdoors");
  assert.equal(categorize("Quarterly town meeting"), "Community");
});

test("dedupe keeps owner picks and richer records", () => {
  const out = dedupe([
    { title: "Jazz Night!", start: "2026-12-01T19:00", source: "SeatGeek" },
    { title: "jazz night", start: "2026-12-01T20:00", image: "x.jpg", source: "Ticketmaster" },
    { title: "Jazz Night", start: "2026-12-02T19:00" },
    { title: "Market", start: "2026-12-05T08:00" },
    { title: "Market", start: "2026-12-05T08:00", pick: true },
  ]);
  assert.equal(out.length, 3);
  assert.equal(out.find((e) => e.title.startsWith("jazz")).image, "x.jpg");
  assert.equal(out.find((e) => e.title === "Market").pick, true);
});
