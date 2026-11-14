// Demand calendar + suggested nightly rates. Pure functions, no I/O.
// All dates are "YYYY-MM-DD" strings; date math is done in UTC so DST never shifts a day.

const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export const parseDay = (s) => new Date(`${s}T00:00:00Z`);
export const fmtDay = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => {
  const d = parseDay(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtDay(d);
};
export const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);

/** nth weekday of a month (n = 1..5, or -1 for the last). month is 1-12. */
export function nthWeekday(year, month, weekday, n) {
  const wd = typeof weekday === "string" ? WEEKDAYS[weekday.toLowerCase().slice(0, 3)] : weekday;
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const diff = (wd - first.getUTCDay() + 7) % 7;
    return fmtDay(new Date(Date.UTC(year, month - 1, 1 + diff + 7 * (n - 1))));
  }
  const last = new Date(Date.UTC(year, month, 0));
  const diff = (last.getUTCDay() - wd + 7) % 7;
  return fmtDay(new Date(Date.UTC(year, month - 1, last.getUTCDate() - diff)));
}

/** Event days for one year: { start, end, confirmed }. */
export function occurrence(ev, year) {
  const known = ev.dates?.[year];
  if (known) return { start: known[0], end: known[1] ?? known[0], confirmed: true };
  const r = ev.rule;
  if (!r) return null;
  const anchor =
    r.day !== undefined
      ? fmtDay(new Date(Date.UTC(year, r.month - 1, r.day)))
      : nthWeekday(year, r.month, r.weekday, r.n);
  const start = addDays(anchor, r.offset ?? 0);
  return { start, end: addDays(start, (r.days ?? 1) - 1), confirmed: Boolean(ev.certain) };
}

/** All occurrences of the major events whose dates overlap [from, to]. */
export function expandMajorEvents(events, from, to) {
  const out = [];
  const y0 = +from.slice(0, 4) - 1;
  const y1 = +to.slice(0, 4);
  for (const ev of events) {
    for (let y = y0; y <= y1; y++) {
      const occ = occurrence(ev, y);
      if (!occ || occ.end < from || occ.start > to) continue;
      out.push({ ...ev, ...occ, rule: undefined, dates: undefined });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function seasonFor(day, seasons) {
  const md = day.slice(5);
  return (
    seasons.find((s) => (s.from <= s.to ? md >= s.from && md <= s.to : md >= s.from || md <= s.to)) ?? {
      name: "Regular",
      multiplier: 1,
    }
  );
}

/**
 * Build a nightly pricing calendar.
 * @param pricing   config.pricing
 * @param occurrences  [{ name, start, end, impact, confirmed, town?, url? }] (event days)
 * @param from      first night ("YYYY-MM-DD")
 * @param nights    how many nights
 */
export function buildPricing(pricing, occurrences, from, nights) {
  const p = pricing;
  const days = [];
  for (let i = 0; i < nights; i++) {
    const date = addDays(from, i);
    const dow = parseDay(date).getUTCDay();
    const weekend = dow === 5 || dow === 6; // Friday and Saturday nights
    const season = seasonFor(date, p.seasons ?? []);
    // An event drives demand from the night before it starts through the night of its last day.
    const hits = occurrences.filter((o) => date >= addDays(o.start, -1) && date <= o.end);
    const impact = hits.reduce((m, o) => Math.max(m, o.impact ?? 1), 0);
    const eventMult = impact ? (p.impactMultipliers?.[impact] ?? 1) + Math.min(0.1, 0.05 * (hits.length - 1)) : 1;

    let rate = p.baseRate * season.multiplier * (weekend ? p.weekendMultiplier : 1) * eventMult;
    rate = Math.min(p.maxRate ?? Infinity, Math.max(p.minRate ?? 0, rate));
    rate = Math.round(rate / 5) * 5;

    const minNights = Math.max(p.minNights ?? 1, p.impactMinNights?.[impact] ?? 0);
    const ratio = rate / p.baseRate;
    const level = impact >= 3 || ratio >= 1.6 ? "peak" : impact >= 2 || ratio >= 1.2 ? "high" : ratio < 0.95 ? "low" : "normal";

    days.push({
      date,
      rate,
      minNights,
      level,
      season: season.name,
      weekend,
      impact,
      events: hits.map((o) => ({ name: o.name, town: o.town, impact: o.impact, confirmed: o.confirmed, url: o.url })),
    });
  }
  return days;
}

const BIG_EVENT = /festival|\bfest\b|\bfair\b|tournament|championship|regatta|derby|rodeo|\brace\b|marathon|triathlon|air ?show|car show|concert series|homecoming|reunion/i;

/** Treat large-sounding events found in the local feeds as extra demand signals (impact 1). */
export function feedSignals(events, majorOccurrences) {
  const known = majorOccurrences.map((o) => o.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  return events
    .filter((e) => BIG_EVENT.test(e.title))
    .filter((e) => !known.some((words) => words.length && words.every((w) => e.title.toLowerCase().includes(w))))
    .map((e) => ({
      name: e.title,
      town: e.venue || e.source,
      impact: 1,
      confirmed: true,
      url: e.url,
      start: e.start.slice(0, 10),
      end: (e.end ?? e.start).slice(0, 10),
      fromFeed: true,
    }));
}
