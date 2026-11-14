#!/usr/bin/env node
// Collects local events around the rental and writes:
//   public/events.json         public "things to do" calendar for guests
//   public/owner/pricing.json  9-month demand calendar with suggested nightly rates
//
// Sources (all free): local iCal feeds and event web pages (chambers, resorts, tourism
// bureaus), major-events.json, manual-events.json, and optionally Ticketmaster/SeatGeek
// when TICKETMASTER_API_KEY / SEATGEEK_CLIENT_ID are set. No npm dependencies (Node 18+).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, buildPricing, daysBetween, expandMajorEvents, feedSignals } from "./demand.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "events.json");

// ---------- helpers ----------

export function milesBetween(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Format a Date as local "YYYY-MM-DDTHH:mm" in the given IANA time zone. */
export function toLocal(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

const CATEGORY_RULES = [
  ["Music", /concert|music|band|jazz|symphony|orchestra|live at|tour|dj |bluegrass|open mic/i],
  ["Sports", /sports|game|vs\.?|hockey|baseball|football|basketball|soccer|race|marathon|5k|golf|tournament/i],
  ["Arts & Theater", /theat|play|musical|ballet|comedy|art |arts|gallery|museum|film|cinema|dance|opera/i],
  ["Food & Drink", /food|wine|beer|brew|tasting|dinner|market|culinary|cider|distiller|chili|bbq/i],
  ["Family", /family|kids|children|story ?time|puppet|zoo|santa|easter|halloween|trick/i],
  ["Outdoors", /hike|trail|kayak|paddle|nature|garden|beach|fishing|bike|ski|snowshoe|park/i],
  ["Festivals", /festival|fest\b|fair|parade|carnival|celebration|holiday/i],
];

export function categorize(text, fallback = "Community") {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  return fallback;
}

function mapSegment(segment, text) {
  const s = (segment || "").toLowerCase();
  if (s.includes("music") || s === "concert") return "Music";
  if (s.includes("sport")) return "Sports";
  if (s.includes("art") || s.includes("theat") || s.includes("comedy") || s.includes("film")) return "Arts & Theater";
  if (s.includes("family")) return "Family";
  return categorize(text);
}

const normTitle = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function dedupe(events) {
  const seen = new Map();
  for (const e of events) {
    const key = `${normTitle(e.title)}|${e.start.slice(0, 10)}`;
    const prev = seen.get(key);
    // keep the richer record (owner picks always win)
    if (!prev || e.pick || (!prev.pick && !prev.image && e.image)) seen.set(key, e);
  }
  return [...seen.values()];
}

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "rental-events-widget" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ---------- sources ----------

async function fromTicketmaster(cfg, startUtc, endUtc) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) return skip("Ticketmaster", "TICKETMASTER_API_KEY not set");
  const out = [];
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  for (let page = 0; page < 5; page++) {
    const qs = new URLSearchParams({
      apikey: key,
      latlong: `${cfg.latitude},${cfg.longitude}`,
      radius: String(cfg.radiusMiles),
      unit: "miles",
      startDateTime: iso(startUtc),
      endDateTime: iso(endUtc),
      size: "200",
      sort: "date,asc",
      page: String(page),
    });
    const data = await getJson(`https://app.ticketmaster.com/discovery/v2/events.json?${qs}`);
    for (const ev of data._embedded?.events ?? []) {
      const v = ev._embedded?.venues?.[0] ?? {};
      const s = ev.dates?.start ?? {};
      const start = s.dateTime
        ? toLocal(new Date(s.dateTime), cfg.timezone)
        : s.localDate
          ? `${s.localDate}T${(s.localTime || "00:00").slice(0, 5)}`
          : null;
      if (!start) continue;
      const img = [...(ev.images ?? [])]
        .filter((i) => i.ratio === "16_9")
        .sort((a, b) => a.width - b.width)
        .find((i) => i.width >= 500);
      out.push({
        title: ev.name,
        start,
        allDay: !s.dateTime && !s.localTime,
        venue: v.name || "",
        address: [v.address?.line1, v.city?.name].filter(Boolean).join(", "),
        lat: num(v.location?.latitude),
        lon: num(v.location?.longitude),
        category: mapSegment(ev.classifications?.[0]?.segment?.name, ev.name),
        url: ev.url,
        image: img?.url,
        source: "Ticketmaster",
      });
    }
    const pages = data.page?.totalPages ?? 1;
    if (page + 1 >= pages) break;
    await sleep(250); // stay under 5 req/s
  }
  return ok("Ticketmaster", out);
}

async function fromSeatGeek(cfg, startUtc, endUtc) {
  const id = process.env.SEATGEEK_CLIENT_ID;
  if (!id) return skip("SeatGeek", "SEATGEEK_CLIENT_ID not set");
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const qs = new URLSearchParams({
      client_id: id,
      lat: String(cfg.latitude),
      lon: String(cfg.longitude),
      range: `${cfg.radiusMiles}mi`,
      "datetime_utc.gte": startUtc.toISOString().slice(0, 19),
      "datetime_utc.lte": endUtc.toISOString().slice(0, 19),
      per_page: "100",
      page: String(page),
      sort: "datetime_utc.asc",
    });
    const data = await getJson(`https://api.seatgeek.com/2/events?${qs}`);
    for (const ev of data.events ?? []) {
      const v = ev.venue ?? {};
      out.push({
        title: ev.title,
        start: ev.datetime_local.slice(0, 16),
        allDay: Boolean(ev.time_tbd),
        venue: v.name || "",
        address: [v.address, v.city].filter(Boolean).join(", "),
        lat: num(v.location?.lat),
        lon: num(v.location?.lon),
        category: mapSegment(ev.type, ev.title),
        url: ev.url,
        image: ev.performers?.[0]?.image || undefined,
        source: "SeatGeek",
      });
    }
    const total = data.meta?.total ?? 0;
    if (page * 100 >= total) break;
  }
  return ok("SeatGeek", out);
}

// --- iCal ---

function unescapeIcs(s) {
  return s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

/** Parse an iCal DTSTART/DTEND value into local "YYYY-MM-DDTHH:mm". */
function icsDate(value, params, timeZone) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (!h || params.includes("VALUE=DATE")) return { start: `${y}-${mo}-${d}T00:00`, allDay: true };
  if (z) return { start: toLocal(new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)), timeZone), allDay: false };
  // TZID or floating: assume it is already local to the property
  return { start: `${y}-${mo}-${d}T${h}:${mi}`, allDay: false };
}

// iCal all-day DTEND is exclusive: a Fri-Sun festival ends "Monday". Keep it only if multi-day.
function allDayEnd(start, endExclusive) {
  const last = addDays(endExclusive.slice(0, 10), -1);
  return last > start.slice(0, 10) ? `${last}T00:00` : undefined;
}

export function parseIcs(text, timeZone) {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") {
      if (cur) events.push(cur);
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const [name, ...params] = line.slice(0, idx).split(";");
      cur[name.toUpperCase()] = { value: line.slice(idx + 1), params: params.join(";").toUpperCase() };
    }
  }
  return events
    .map((e) => {
      const st = e.DTSTART && icsDate(e.DTSTART.value, e.DTSTART.params, timeZone);
      if (!st || !e.SUMMARY) return null;
      const en = e.DTEND && icsDate(e.DTEND.value, e.DTEND.params, timeZone);
      const [lat, lon] = (e.GEO?.value ?? "").split(";").map(num);
      return {
        title: unescapeIcs(e.SUMMARY.value),
        start: st.start,
        end: en ? (st.allDay ? allDayEnd(st.start, en.start) : en.start) : undefined,
        allDay: st.allDay,
        venue: e.LOCATION ? unescapeIcs(e.LOCATION.value).split(",")[0] : "",
        address: e.LOCATION ? unescapeIcs(e.LOCATION.value) : "",
        description: e.DESCRIPTION ? unescapeIcs(e.DESCRIPTION.value).replace(/<[^>]+>/g, "").slice(0, 300) : "",
        url: e.URL?.value,
        lat,
        lon,
        recurring: Boolean(e.RRULE),
      };
    })
    .filter(Boolean);
}

async function fromIcal(cfg) {
  const results = [];
  for (const feed of cfg.icalFeeds ?? []) {
    if (!feed.url) continue;
    try {
      const url = feed.url.replace("{start}", cfg._start).replace("{end}", cfg._end);
      const res = await fetch(url, { headers: { "User-Agent": "rental-events-widget" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const items = parseIcs(await res.text(), cfg.timezone).map((e) => ({
        ...e,
        category: categorize(`${e.title} ${e.description}`, feed.defaultCategory || "Community"),
        source: feed.name,
      }));
      results.push(ok(feed.name, items));
    } catch (err) {
      results.push(fail(feed.name, err));
    }
  }
  return results;
}

// --- Event data embedded in web pages (schema.org JSON-LD) ---
// Most chamber, tourism, Eventbrite and WordPress event pages publish this for Google.

function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function jsonLdDate(value, timeZone) {
  if (!value) return null;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { start: `${s}T00:00`, allDay: true };
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d) ? null : { start: toLocal(d, timeZone), allDay: false };
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? { start: `${m[1]}T${m[2]}`, allDay: false } : null;
}

function addressText(loc) {
  const a = loc?.address;
  if (!a) return "";
  if (typeof a === "string") return decodeEntities(a);
  return decodeEntities([a.streetAddress, a.addressLocality, a.addressRegion].filter(Boolean).join(", "));
}

export function extractJsonLdEvents(html, timeZone) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node["@graph"]) walk(node["@graph"]);
    if (node.itemListElement) walk(node.itemListElement);
    if (node.item) walk(node.item);
    const types = [].concat(node["@type"] ?? []);
    if (types.some((t) => /Event$/.test(String(t)))) found.push(node);
  };
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      walk(JSON.parse(m[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "").trim()));
    } catch {
      /* skip malformed blocks */
    }
  }
  return found
    .map((n) => {
      const st = jsonLdDate(n.startDate, timeZone);
      if (!st || !n.name) return null;
      const en = jsonLdDate(n.endDate, timeZone);
      const loc = Array.isArray(n.location) ? n.location[0] : n.location;
      const img = Array.isArray(n.image) ? n.image[0] : n.image;
      return {
        title: decodeEntities(n.name).trim(),
        start: st.start,
        end: en && en.start > st.start ? en.start : undefined,
        allDay: st.allDay,
        venue: decodeEntities(loc?.name ?? ""),
        address: addressText(loc),
        lat: num(loc?.geo?.latitude),
        lon: num(loc?.geo?.longitude),
        url: typeof n.url === "string" ? n.url : undefined,
        image: typeof img === "string" ? img : img?.url,
        description: decodeEntities(n.description ?? "").replace(/<[^>]+>/g, "").slice(0, 300),
      };
    })
    .filter(Boolean);
}

async function fromPages(cfg) {
  const results = [];
  for (const page of cfg.eventPages ?? []) {
    if (!page.url) continue;
    try {
      const res = await fetch(page.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; rental-events-widget)" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const items = extractJsonLdEvents(await res.text(), cfg.timezone).map((e) => ({
        ...e,
        category: categorize(`${e.title} ${e.description}`, page.defaultCategory || "Community"),
        source: page.name,
      }));
      results.push(ok(page.name, items));
    } catch (err) {
      results.push(fail(page.name, err));
    }
  }
  return results;
}

async function fromManual() {
  try {
    const items = JSON.parse(await readFile(join(ROOT, "manual-events.json"), "utf8"));
    return ok("Owner picks", items.map((e) => ({ category: "Community", ...e, source: "Owner picks" })));
  } catch (err) {
    return err.code === "ENOENT" ? skip("Owner picks", "no manual-events.json") : fail("Owner picks", err);
  }
}

// ---------- main ----------

const num = (x) => (x === undefined || x === null || x === "" || isNaN(+x) ? undefined : +x);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, events) => ({ name, events, status: `${events.length} events` });
const skip = (name, why) => ({ name, events: [], status: `skipped (${why})` });
const fail = (name, err) => ({ name, events: [], status: `failed (${err.message})` });
const safe = (name, p) => p.catch((err) => fail(name, err));

async function main() {
  const cfg = JSON.parse(await readFile(join(ROOT, "config.json"), "utf8"));
  const now = new Date();
  const pricingDays = Math.round((cfg.pricing?.monthsAhead ?? 9) * 30.5);
  const fetchDays = Math.max(cfg.daysAhead, pricingDays);
  const end = new Date(now.getTime() + fetchDays * 86400000);
  const todayLocal = toLocal(now, cfg.timezone).slice(0, 10);
  const endLocal = toLocal(end, cfg.timezone).slice(0, 10);
  const guestEndLocal = addDays(todayLocal, cfg.daysAhead);
  cfg._start = todayLocal;
  cfg._end = endLocal;

  const results = [
    await safe("Ticketmaster", fromTicketmaster(cfg, now, end)),
    await safe("SeatGeek", fromSeatGeek(cfg, now, end)),
    ...(await fromIcal(cfg)),
    ...(await fromPages(cfg)),
    await fromManual(),
  ];
  for (const r of results) console.log(`  ${r.name}: ${r.status}`);

  let events = results.flatMap((r) => r.events);
  events = events
    .map((e) => {
      const hasGeo = e.lat !== undefined && e.lon !== undefined;
      const miles = hasGeo ? milesBetween(cfg.latitude, cfg.longitude, e.lat, e.lon) : undefined;
      return { ...e, miles: miles === undefined ? undefined : Math.round(miles * 10) / 10 };
    })
    .filter((e) => e.miles === undefined || e.miles <= cfg.radiusMiles)
    .filter((e) => (e.end ?? e.start).slice(0, 10) >= todayLocal && e.start.slice(0, 10) <= endLocal);

  events = dedupe(events);

  // ----- demand calendar + suggested rates (owner only) -----
  let major = [];
  try {
    major = JSON.parse(await readFile(join(ROOT, "major-events.json"), "utf8")).events;
  } catch (err) {
    console.warn(`  major-events.json: ${err.message}`);
  }
  const majorOcc = expandMajorEvents(major, todayLocal, endLocal);
  const signals = feedSignals(events, majorOcc);
  if (cfg.pricing) {
    const nights = buildPricing(cfg.pricing, [...majorOcc, ...signals], todayLocal, pricingDays);
    const upcoming = [...majorOcc, ...signals].map((o) => ({
      name: o.name,
      town: o.town,
      impact: o.impact,
      start: o.start,
      end: o.end,
      confirmed: o.confirmed,
      fromFeed: Boolean(o.fromFeed),
      url: o.url,
      daysAway: daysBetween(todayLocal, o.start),
    }));
    await mkdir(join(ROOT, "public", "owner"), { recursive: true });
    await writeFile(
      join(ROOT, "public", "owner", "pricing.json"),
      JSON.stringify(
        {
          property: cfg.propertyName,
          generatedAt: now.toISOString(),
          currency: cfg.pricing.currency,
          baseRate: cfg.pricing.baseRate,
          nights,
          upcoming,
        },
        null,
        1,
      ),
    );
    console.log(`Wrote ${nights.length} nights of suggested rates (${majorOcc.length} major events, ${signals.length} from feeds)`);
  }

  // Confirmed major events also appear on the public calendar.
  const majorForGuests = majorOcc
    .filter((o) => o.confirmed && o.showGuests !== false)
    .map((o) => ({
      title: o.name,
      start: `${o.start}T00:00`,
      end: o.end !== o.start ? `${o.end}T00:00` : undefined,
      allDay: true,
      venue: o.town,
      address: `${o.town}, MI`,
      category: o.category ?? "Festivals",
      url: o.url,
      source: "Major events",
    }));

  events = dedupe([...events, ...majorForGuests])
    .filter((e) => e.start.slice(0, 10) <= guestEndLocal)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, cfg.maxEvents ?? 400)
    .map((e, i) => ({ id: i + 1, ...e, lat: undefined, lon: undefined }));

  const payload = {
    property: {
      name: cfg.propertyName,
      latitude: cfg.latitude,
      longitude: cfg.longitude,
      radiusMiles: cfg.radiusMiles,
      timezone: cfg.timezone,
    },
    generatedAt: now.toISOString(),
    sources: results.map(({ name, status }) => ({ name, status })),
    events,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 1));
  console.log(`Wrote ${events.length} events to ${OUT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
