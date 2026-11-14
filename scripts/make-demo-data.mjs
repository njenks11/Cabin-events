#!/usr/bin/env node
// Writes realistic sample data to public/events.json so the widget can be previewed without API keys.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toLocal } from "./fetch-events.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(await readFile(join(ROOT, "config.json"), "utf8"));
const day = (n, time = "19:00") => toLocal(new Date(Date.now() + n * 86400000), cfg.timezone).slice(0, 10) + "T" + time;

const samples = [
  [0, "17:00", "Fish Fry & Euchre Night", "Mancelona American Legion", "Food & Drink", 0.6],
  [1, "10:00", "Holiday Craft Show", "Mancelona Elementary School", "Community", 0.4, true],
  [1, "19:00", "Live Music: The Cedar Swamp Band", "Short's Brewing Company, Bellaire", "Music", 11.8],
  [2, "13:00", "Snowshoe Nature Walk", "Grass River Natural Area", "Outdoors", 16.2],
  [5, "18:30", "Trivia Night", "Short's Pull Barn, Elk Rapids", "Food & Drink", 26.4],
  [7, "00:00", "Downtown Bellaire Light Parade", "Broad St, Bellaire", "Festivals", 11.6],
  [8, "09:00", "Breakfast with Santa", "Mancelona Elementary School", "Family", 0.4],
  [13, "16:00", "Opening Weekend: Lift-Served Skiing", "Schuss Mountain at Shanty Creek", "Outdoors", 9.5],
  [14, "11:00", "Kids Ski & Ride Day", "Boyne Mountain", "Family", 21.9],
  [21, "19:30", "Winter Concert", "Interlochen Center for the Arts", "Music", 38.5],
  [28, "20:00", "Torchlight Parade & Fireworks", "Schuss Mountain at Shanty Creek", "Festivals", 9.5],
];
const events = samples.map(([d, t, title, venue, category, miles, pick], i) => ({
  id: i + 1, title, start: day(d, t), allDay: t === "00:00", venue, address: "Antrim County, MI",
  category, miles, url: "https://example.com/event/" + (i + 1), pick: pick || undefined,
  description: pick ? "Host pick: hand-made gifts from local makers, two minutes from the cabin." : undefined,
  source: pick ? "Owner picks" : "Demo",
}));
const payload = {
  property: { name: cfg.propertyName, latitude: cfg.latitude, longitude: cfg.longitude, radiusMiles: cfg.radiusMiles, timezone: cfg.timezone },
  generatedAt: new Date().toISOString(),
  sources: [{ name: "Demo", status: `${events.length} sample events` }],
  events,
};
await writeFile(join(ROOT, "public", "events.json"), JSON.stringify(payload, null, 1));
console.log(`Wrote ${events.length} demo events`);
