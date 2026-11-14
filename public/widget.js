/*!
 * Stay Events widget: local events calendar for vacation rental websites.
 *
 * Usage (paste into any website "Embed HTML" block):
 *   <div data-stay-events data-src="https://YOUR-SITE/events.json"></div>
 *   <script src="https://YOUR-SITE/widget.js" defer></script>
 *
 * Options (data- attributes on the div):
 *   data-src        URL of events.json (default: events.json next to widget.js)
 *   data-accent     brand color, e.g. "#0f766e"
 *   data-title      heading text (default: "Things to do near {property}")
 *   data-page-size  events shown before "Show more" (default 12)
 *
 * Guests can be deep-linked to their stay dates: yourpage.html?checkin=2026-12-01&checkout=2026-12-05
 */
(function () {
  "use strict";

  var scriptSrc = (document.currentScript && document.currentScript.src) || "";
  var CATEGORY_ICONS = {
    Music: "🎵", Sports: "🏟️", "Arts & Theater": "🎭", "Food & Drink": "🍷",
    Family: "🧸", Outdoors: "🌲", Festivals: "🎪", Community: "🏘️",
  };

  var CSS = [
    ":host{--accent:#0f766e;--bg:#ffffff;--card:#ffffff;--text:#1c1917;--muted:#78716c;--line:#e7e5e4;--chip:#f5f5f4;",
    "display:block;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--text);line-height:1.4}",
    "*{box-sizing:border-box}",
    ".wrap{background:var(--bg);padding:20px 0;max-width:960px;margin:0 auto}",
    "h2{font-size:1.6rem;margin:0 0 4px;letter-spacing:-0.01em}",
    ".sub{color:var(--muted);font-size:.9rem;margin:0 0 16px}",
    ".bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}",
    ".seg{display:flex;flex-wrap:wrap;gap:6px}",
    "button{font:inherit;cursor:pointer}",
    ".pill{border:1px solid var(--line);background:var(--card);color:var(--text);padding:7px 12px;border-radius:999px;font-size:.88rem}",
    ".pill:hover{border-color:var(--accent)}",
    ".pill[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff}",
    ".stay{display:none;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 12px;background:var(--chip);border-radius:12px;margin-bottom:10px;font-size:.88rem}",
    ".stay.on{display:flex}",
    ".stay input{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:#fff}",
    ".search{flex:1 1 200px;min-width:0;font:inherit;padding:8px 12px;border:1px solid var(--line);border-radius:999px;font-size:.9rem}",
    ".search:focus,.stay input:focus{outline:2px solid var(--accent);outline-offset:1px}",
    ".cats{display:flex;gap:6px;overflow-x:auto;padding:2px 0 8px;margin-bottom:8px;scrollbar-width:thin}",
    ".cats .pill{white-space:nowrap;background:var(--chip);border-color:transparent}",
    ".cats .pill[aria-pressed=true]{background:var(--accent);color:#fff}",
    ".day{margin:18px 0 8px;font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);display:flex;gap:10px;align-items:center}",
    ".day:after{content:'';flex:1;height:1px;background:var(--line)}",
    ".card{display:grid;grid-template-columns:120px 1fr;gap:14px;padding:12px;border:1px solid var(--line);border-radius:14px;background:var(--card);margin-bottom:10px}",
    ".card.pick{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}",
    ".thumb{width:120px;height:90px;border-radius:10px;background:var(--chip) center/cover no-repeat;display:flex;align-items:center;justify-content:center;font-size:2rem}",
    ".meta{font-size:.82rem;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 10px}",
    ".title{font-weight:650;font-size:1.02rem;margin:2px 0 4px}",
    ".badge{display:inline-block;font-size:.7rem;font-weight:700;color:#fff;background:var(--accent);border-radius:6px;padding:2px 6px;margin-right:6px;vertical-align:2px}",
    ".desc{font-size:.85rem;color:var(--text);opacity:.85;margin:4px 0 0}",
    ".actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}",
    ".act{font-size:.8rem;padding:5px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--text);text-decoration:none}",
    ".act:hover{border-color:var(--accent);color:var(--accent)}",
    ".act.primary{background:var(--accent);color:#fff;border-color:var(--accent)}",
    ".act.primary:hover{color:#fff;opacity:.9}",
    ".empty{padding:32px 16px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:14px}",
    ".more{display:block;margin:14px auto 0}",
    ".foot{font-size:.75rem;color:var(--muted);margin-top:16px;text-align:center}",
    "@media (max-width:560px){.card{grid-template-columns:72px 1fr;gap:10px}.thumb{width:72px;height:72px;font-size:1.5rem}h2{font-size:1.3rem}}",
  ].join("");

  // ---------- date helpers (all dates are local "YYYY-MM-DD" strings) ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addDays(s, n) { var d = parseDay(s); d.setDate(d.getDate() + n); return ymd(d); }
  function parseDay(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function todayIn(tz) {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
    catch (e) { return ymd(new Date()); }
  }
  function dayLabel(s, today) {
    if (s === today) return "Today";
    if (s === addDays(today, 1)) return "Tomorrow";
    return parseDay(s).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  }
  function timeLabel(e) {
    if (e.allDay) return "All day";
    var p = e.start.slice(11, 16).split(":");
    var d = new Date(2000, 0, 1, +p[0], +p[1]);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function weekendRange(today) {
    var dow = parseDay(today).getDay(); // 0 Sun .. 6 Sat
    if (dow === 0) return [today, today];
    var fri = addDays(today, (5 - dow + 7) % 7);
    if (dow === 6) fri = addDays(today, -1);
    return [fri < today ? today : fri, addDays(fri, 2)];
  }

  // ---------- .ics export ----------
  function icsStamp(local) { return local.replace(/[-:]/g, "").slice(0, 13) + "00"; }
  function icsEscape(s) { return String(s || "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n"); }
  function downloadIcs(e, tz) {
    var start = e.start, end = e.end;
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Stay Events//EN", "BEGIN:VEVENT",
      "UID:stay-events-" + e.id + "-" + start.replace(/\D/g, "") + "@stay-events",
      "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z"];
    if (e.allDay) {
      lines.push("DTSTART;VALUE=DATE:" + start.slice(0, 10).replace(/-/g, ""));
      lines.push("DTEND;VALUE=DATE:" + addDays(start.slice(0, 10), 1).replace(/-/g, ""));
    } else {
      if (!end) {
        var d = new Date(start); d.setHours(d.getHours() + 2);
        end = ymd(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
      }
      lines.push("DTSTART;TZID=" + tz + ":" + icsStamp(start));
      lines.push("DTEND;TZID=" + tz + ":" + icsStamp(end));
    }
    lines.push("SUMMARY:" + icsEscape(e.title));
    if (e.address || e.venue) lines.push("LOCATION:" + icsEscape([e.venue, e.address].filter(Boolean).join(", ")));
    if (e.url) lines.push("URL:" + e.url);
    if (e.description) lines.push("DESCRIPTION:" + icsEscape(e.description));
    lines.push("END:VEVENT", "END:VCALENDAR");
    var blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = e.title.replace(/[^\w]+/g, "-").slice(0, 40) + ".ics";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---------- rendering ----------
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "text") el.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) el.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : null; }

  function mount(host) {
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    var style = h("style"); style.textContent = CSS; root.appendChild(style);
    if (host.dataset.accent) host.style.setProperty("--accent", host.dataset.accent);
    var wrap = h("div", { class: "wrap" }); root.appendChild(wrap);
    wrap.appendChild(h("p", { class: "sub", text: "Loading local events…" }));

    var src = host.dataset.src || (scriptSrc ? scriptSrc.replace(/[^/]*$/, "events.json") : "events.json");
    fetch(src, { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { render(host, wrap, data); })
      .catch(function () {
        wrap.innerHTML = "";
        wrap.appendChild(h("div", { class: "empty", text: "Local events are unavailable right now. Please check back soon." }));
      });
  }

  function render(host, wrap, data) {
    var prop = data.property || {};
    var tz = prop.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    var today = todayIn(tz);
    var events = (data.events || []).filter(function (e) { return (e.end || e.start).slice(0, 10) >= today; });
    var pageSize = +host.dataset.pageSize || 12;

    var params = new URLSearchParams(location.search);
    var state = {
      range: params.get("checkin") ? "stay" : "week",
      checkin: params.get("checkin") || today,
      checkout: params.get("checkout") || addDays(today, 3),
      cat: "All",
      q: "",
      shown: pageSize,
    };

    wrap.innerHTML = "";
    wrap.appendChild(h("h2", { text: host.dataset.title || ("Things to do near " + (prop.name || "your stay")) }));
    wrap.appendChild(h("p", { class: "sub", text: "Concerts, festivals, games and more within " + (prop.radiusMiles || "a short drive of") + " miles. Updated daily." }));

    var ranges = [["weekend", "This weekend"], ["week", "Next 7 days"], ["month", "Next 30 days"], ["stay", "During my stay"], ["all", "All upcoming"]];
    var rangeBtns = ranges.map(function (r) {
      return h("button", { class: "pill", "data-r": r[0], onclick: function () { state.range = r[0]; state.shown = pageSize; update(); }, text: r[1] });
    });
    var search = h("input", { class: "search", type: "search", placeholder: "Search events or venues", "aria-label": "Search events",
      oninput: function (ev) { state.q = ev.target.value.toLowerCase(); state.shown = pageSize; update(); } });
    wrap.appendChild(h("div", { class: "bar" }, [h("div", { class: "seg", role: "group", "aria-label": "Date range" }, rangeBtns), search]));

    var inEl = h("input", { type: "date", value: state.checkin, min: today, onchange: function (ev) {
      state.checkin = ev.target.value; if (state.checkout < state.checkin) { state.checkout = state.checkin; outEl.value = state.checkout; } update(); } });
    var outEl = h("input", { type: "date", value: state.checkout, min: today, onchange: function (ev) { state.checkout = ev.target.value; update(); } });
    var stay = h("div", { class: "stay" }, [h("label", {}, ["Check-in ", inEl]), h("label", {}, ["Check-out ", outEl])]);
    wrap.appendChild(stay);

    var cats = ["All"];
    events.forEach(function (e) { if (cats.indexOf(e.category) < 0) cats.push(e.category); });
    var catBtns = cats.map(function (c) {
      return h("button", { class: "pill", "data-c": c, onclick: function () { state.cat = c; state.shown = pageSize; update(); },
        text: (c === "All" ? "✨ " : (CATEGORY_ICONS[c] || "📍") + " ") + c });
    });
    wrap.appendChild(h("div", { class: "cats", role: "group", "aria-label": "Category" }, catBtns));

    var list = h("div", { "aria-live": "polite" });
    wrap.appendChild(list);
    var updated = data.generatedAt ? new Date(data.generatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
    wrap.appendChild(h("p", { class: "foot", text: "Event details come from the organizers. Please confirm times before you go." + (updated ? " Last updated " + updated + "." : "") }));

    function window_() {
      switch (state.range) {
        case "weekend": return weekendRange(today);
        case "week": return [today, addDays(today, 6)];
        case "month": return [today, addDays(today, 29)];
        case "stay": return [state.checkin, state.checkout];
        default: return [today, "9999-12-31"];
      }
    }

    function update() {
      rangeBtns.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.r === state.range)); });
      catBtns.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.c === state.cat)); });
      stay.classList.toggle("on", state.range === "stay");
      var w = window_();
      var matches = events.filter(function (e) {
        var s = e.start.slice(0, 10), en = (e.end || e.start).slice(0, 10);
        if (en < w[0] || s > w[1]) return false;
        if (state.cat !== "All" && e.category !== state.cat) return false;
        if (state.q && (e.title + " " + (e.venue || "") + " " + (e.address || "")).toLowerCase().indexOf(state.q) < 0) return false;
        return true;
      });
      list.innerHTML = "";
      if (!matches.length) {
        list.appendChild(h("div", { class: "empty", text: "No events match those filters. Try a wider date range or another category." }));
        return;
      }
      var lastDay = null;
      matches.slice(0, state.shown).forEach(function (e) {
        var d = e.start.slice(0, 10) < w[0] ? w[0] : e.start.slice(0, 10);
        if (d !== lastDay) { list.appendChild(h("div", { class: "day", text: dayLabel(d, today) })); lastDay = d; }
        list.appendChild(card(e, tz));
      });
      if (matches.length > state.shown) {
        list.appendChild(h("button", { class: "pill more", onclick: function () { state.shown += pageSize; update(); },
          text: "Show more (" + (matches.length - state.shown) + " left)" }));
      }
    }
    update();
  }

  function card(e, tz) {
    var img = safeUrl(e.image);
    var thumb = h("div", { class: "thumb", role: "img", "aria-label": e.category });
    if (img) thumb.style.backgroundImage = "url(\"" + img.replace(/"/g, "%22") + "\")";
    else thumb.textContent = CATEGORY_ICONS[e.category] || "📍";

    var meta = [timeLabel(e)];
    if (e.venue) meta.push(e.venue);
    if (typeof e.miles === "number") meta.push(e.miles < 1 ? "under 1 mi away" : e.miles + " mi away");

    var where = [e.venue, e.address].filter(Boolean).join(", ");
    var url = safeUrl(e.url);
    var actions = [
      url ? h("a", { class: "act primary", href: url, target: "_blank", rel: "noopener", text: e.source === "Ticketmaster" || e.source === "SeatGeek" ? "Tickets" : "Details" }) : null,
      h("button", { class: "act", onclick: function () { downloadIcs(e, tz); }, text: "Add to calendar" }),
      where ? h("a", { class: "act", target: "_blank", rel: "noopener",
        href: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(where), text: "Directions" }) : null,
    ];

    return h("article", { class: "card" + (e.pick ? " pick" : "") }, [
      thumb,
      h("div", {}, [
        h("div", { class: "meta" }, meta.map(function (m) { return h("span", { text: m }); })),
        h("div", { class: "title" }, [e.pick ? h("span", { class: "badge", text: "Host pick" }) : null, e.title]),
        e.description ? h("p", { class: "desc", text: e.description.length > 160 ? e.description.slice(0, 157) + "…" : e.description }) : null,
        h("div", { class: "actions" }, actions),
      ]),
    ]);
  }

  function init() {
    var hosts = document.querySelectorAll("[data-stay-events]");
    for (var i = 0; i < hosts.length; i++) if (!hosts[i].shadowRoot && !hosts[i].dataset.mounted) { hosts[i].dataset.mounted = "1"; mount(hosts[i]); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
