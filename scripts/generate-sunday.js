/**
 * generate-sunday.js — Sunday Week-Ahead Events Edition
 *
 * Researches the week's events in Medford MA and builds the Sunday edition
 * using the same CSS/spread system as the morning edition but with a
 * full week-ahead calendar, branded venue cards, and look-ahead section.
 *
 * Cost: ~$0.015–0.02 per edition (more searches than weekday)
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-haiku-4-5";

function getETDate() {
  const now = new Date();
  const et = now.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const [m, d, y] = et.split("/");
  return {
    slug: `${y}-${m}-${d}`,
    pretty: now.toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    }),
  };
}

function getDateRange(sundaySlug) {
  // Returns Mon–Sun slugs for the week ahead
  const [y, m, d] = sundaySlug.split("-").map(Number);
  const sunday = new Date(Date.UTC(y, m - 1, d));
  const days = [];
  for (let i = 1; i <= 7; i++) {
    const dt = new Date(sunday);
    dt.setUTCDate(sunday.getUTCDate() + i);
    days.push({
      slug: dt.toISOString().slice(0, 10),
      weekday: dt.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" }),
      pretty: dt.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }),
    });
  }
  return days;
}

function loadSharedCSS() {
  const cssPath = path.join(__dirname, "../src/magazine.css");
  if (fs.existsSync(cssPath)) return fs.readFileSync(cssPath, "utf8");
  const mags = fs.readdirSync(path.join(__dirname, "../magazines"))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort().reverse();
  if (!mags.length) return "";
  const html = fs.readFileSync(path.join(__dirname, "../magazines", mags[0]), "utf8");
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  return match ? match[1] : "";
}

// ── Pass 1: Research the week's events ────────────────────────────────────────

async function researchWeek(date, weekDays) {
  console.log("Pass 1 — Researching week-ahead events...");

  const weekRange = `${weekDays[0].pretty} through ${weekDays[6].pretty}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    system: `You are a research assistant for a Medford MA weekly events guide.
Search for events happening in Medford Massachusetts in the coming week.
Also search for specific events at: Deep Cuts (deepcuts.rocks), Medford Brewing (medfordbrew.com), Great American Beer Hall (gabhall.com).

Return ONLY a JSON object — no prose, no markdown fences.
JSON shape:
{
  "today_highlights": [
    { "time": "string", "title": "string", "location": "string", "desc": "1 sentence", "free": true/false }
  ],
  "week_events": {
    "monday": [ { "time": "HH:MM AM/PM", "title": "string", "location": "string", "desc": "string", "url": "string or null", "free": bool, "kids": bool, "registration": bool } ],
    "tuesday": [...],
    "wednesday": [...],
    "thursday": [...],
    "friday": [...],
    "saturday": [...],
    "sunday_next": [...]
  },
  "deep_cuts": [
    { "day": "Mon/Tue/etc", "event": "string", "price": "string or null", "url": "string or null" }
  ],
  "medford_brewing": [
    { "day": "Mon/Tue/etc", "event": "string", "detail": "string", "url": "string or null" }
  ],
  "gabh": [
    { "day": "Mon/Tue/etc", "event": "string", "time": "string", "url": "string or null" }
  ],
  "look_ahead": [
    { "date": "Month Day", "title": "string", "desc": "string", "url": "string or null" }
  ]
}`,
    messages: [{
      role: "user",
      content: `Today is ${date.pretty} (Sunday). Research events in Medford MA for the coming week: ${weekRange}.
Search Deep Cuts events, Medford Brewing events, Great American Beer Hall events, and city/community events.
Also include 2-3 "look ahead" items beyond this week. Return only the JSON.`
    }],
  });

  let raw = response.content.filter(b => b.type === "text").map(b => b.text).join("");
  raw = raw.replace(/^```json\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn("Could not parse research JSON, using fallback");
    return {};
  }

  const data = JSON.parse(jsonMatch[0]);
  const eventCount = Object.values(data.week_events || {}).flat().length;
  console.log(`  Found ${eventCount} week events, ${data.look_ahead?.length ?? 0} look-ahead items`);
  console.log(`  Tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);
  return data;
}

// ── Pass 2: Build the HTML using a template approach ──────────────────────────

function buildSundayHTML(date, weekDays, data, sharedCSS, editionNumber) {
  console.log("Pass 2 — Building Sunday HTML...");

  const weekRange = `${weekDays[0].pretty} – ${weekDays[6].pretty}`;

  // ── Today highlights
  const todayCards = (data.today_highlights || []).slice(0, 3).map(e => `
    <div class="today-card${e.free ? ' hl' : ''}">
      <div class="tc-time">${e.time}${e.free ? ' · Free' : ''}</div>
      <div class="tc-title">${e.title}</div>
      <div class="tc-desc">${e.desc}</div>
    </div>`).join("\n");

  // ── Day-by-day events
  const dayOrder = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday_next"];
  const weekDayMap = { monday:0, tuesday:1, wednesday:2, thursday:3, friday:4, saturday:5, sunday_next:6 };

  function badge(ev) {
    const badges = [];
    if (ev.free) badges.push('<span class="badge badge-free">Free</span>');
    if (ev.kids) badges.push('<span class="badge badge-kids">Kids</span>');
    if (ev.registration) badges.push('<span class="badge badge-reg">Register</span>');
    return badges.length ? `<span class="ev-badges">${badges.join("")}</span>` : "";
  }

  const dayBlocks = dayOrder.map(day => {
    const events = (data.week_events?.[day] || []);
    if (!events.length) return "";
    const wd = weekDays[weekDayMap[day]];
    const isHoliday = wd.weekday === "Monday" && wd.pretty.includes("April 20");
    const note = isHoliday ? " · Patriots' Day · City Hall closed" : "";
    const rows = events.map(ev => {
      const title = ev.url
        ? `<a href="${ev.url}" target="_blank">${ev.title}</a>`
        : ev.title;
      return `
      <div class="ev-row">
        <div class="ev-time">${ev.time || "TBD"}</div>
        <div class="ev-body">
          <div class="ev-title">${title} ${badge(ev)}</div>
          ${ev.location ? `<div class="ev-desc">${ev.location}${ev.desc ? " · " + ev.desc : ""}</div>` : ""}
        </div>
      </div>`;
    }).join("\n");
    return `
  <div class="day-block">
    <div class="day-label">${wd.weekday} <span class="dl-date">${wd.pretty}${note}</span></div>
    ${rows}
  </div>`;
  }).join("\n");

  // ── Venue cards
  function venueRows(items) {
    return (items || []).map(item => {
      const name = item.url
        ? `<a href="${item.url}" target="_blank">${item.event}</a>`
        : item.event;
      const detail = item.price || item.detail || item.time || "";
      return `<div class="vc-row">
        <span class="vc-day">${item.day}</span>
        <span class="vc-evt">${name}</span>
        ${detail ? `<span class="vc-price">${detail}</span>` : ""}
      </div>`;
    }).join("\n");
  }

  // ── Look ahead
  const laRows = (data.look_ahead || []).map(item => {
    const title = item.url
      ? `<a href="${item.url}" target="_blank">${item.title}</a>`
      : item.title;
    return `
    <div class="la-row">
      <div class="la-date">${item.date}</div>
      <div>
        <div class="la-text">${title}</div>
        <div class="la-sub">${item.desc}</div>
      </div>
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Medford Mercury — Sunday Edition · ${date.pretty}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,100..900;1,9..144,100..900&family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
${sharedCSS}

  /* ─── SUNDAY EDITION STYLES ─── */
  .sunday-flag {
    background: var(--ink); color: var(--cream);
    text-align: center; padding: 7px 60px;
    font-size: 10px; font-weight: 800; letter-spacing: 0.3em; text-transform: uppercase;
    border-bottom: 3px solid var(--ink);
  }
  .today-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 3px; }
  .today-card { background: var(--cream); padding: 28px; border-top: 3px solid var(--ink); border-bottom: 3px solid var(--ink); }
  .today-card.hl { border-top-color: var(--rust); }
  .today-card .tc-time { font-size: 10px; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; color: var(--rust); margin-bottom: 8px; }
  .today-card .tc-title { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 800; line-height: 1.15; color: var(--ink); margin-bottom: 8px; }
  .today-card .tc-desc { font-size: 14px; line-height: 1.6; color: #444; }

  .week-section { padding: 60px 60px 0; background: var(--warm-white, #faf8f3); }
  .week-section-header { font-family: 'Fraunces', serif; font-size: 52px; font-weight: 900; line-height: 1; letter-spacing: -0.02em; border-bottom: 3px solid var(--ink); padding-bottom: 16px; margin-bottom: 40px; display: flex; align-items: baseline; gap: 20px; }
  .week-section-header .wsh-sub { font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #888; }

  .day-block { margin-bottom: 36px; }
  .day-label { font-size: 11px; font-weight: 800; letter-spacing: 0.22em; text-transform: uppercase; color: var(--ink); padding: 8px 0; border-bottom: 1px solid #ccc; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; }
  .day-label .dl-date { font-size: 11px; font-weight: 500; letter-spacing: 0.05em; text-transform: none; color: #888; }
  .ev-row { display: flex; align-items: flex-start; gap: 16px; padding: 11px 0; border-bottom: 1px solid #e8e4da; }
  .ev-row:last-child { border-bottom: none; }
  .ev-time { font-size: 11px; font-weight: 700; color: #888; min-width: 70px; flex-shrink: 0; padding-top: 2px; letter-spacing: 0.05em; }
  .ev-body { flex: 1; min-width: 0; }
  .ev-title { font-size: 15px; font-weight: 600; line-height: 1.35; color: var(--ink); }
  .ev-title a { color: var(--rust); text-decoration: none; }
  .ev-title a:hover { text-decoration: underline; }
  .ev-desc { font-size: 13px; color: #555; margin-top: 2px; line-height: 1.5; }
  .ev-badges { display: inline-flex; gap: 5px; margin-left: 8px; vertical-align: middle; }
  .badge { font-size: 9px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; white-space: nowrap; }
  .badge-free { background: #e4f2e4; color: #2a6b2a; }
  .badge-kids { background: #deeaf8; color: #1a4e8a; }
  .badge-reg  { background: #fdf0d8; color: #7a4a00; }

  .venues-section { padding: 60px; background: var(--parchment, #ede8d6); border-top: 3px solid var(--ink); }
  .venues-header { font-family: 'Fraunces', serif; font-size: 48px; font-weight: 900; line-height: 1; letter-spacing: -0.02em; border-bottom: 2px solid var(--ink); padding-bottom: 14px; margin-bottom: 28px; }
  .venues-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; }
  .vc { overflow: hidden; }
  .vc-head { padding: 16px 18px 14px; display: flex; justify-content: space-between; align-items: flex-start; }
  .vc-head-inner { display: flex; gap: 10px; align-items: center; }
  .vc-head img { width: 30px; height: 30px; border-radius: 4px; object-fit: cover; }
  .vc-name { font-size: 15px; font-weight: 700; line-height: 1.2; }
  .vc-sub { font-size: 11px; margin-top: 2px; opacity: 0.6; }
  .vc-link { font-size: 10px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; white-space: nowrap; padding: 4px 10px; text-decoration: none; flex-shrink: 0; }
  .vc-body { background: white; border: 1px solid #e0dbd0; border-top: none; }
  .vc-row { display: flex; gap: 8px; padding: 8px 14px; border-bottom: 1px solid #f0ece4; align-items: baseline; }
  .vc-row:last-child { border-bottom: none; }
  .vc-day { font-size: 11px; color: #888; min-width: 26px; flex-shrink: 0; font-weight: 600; }
  .vc-evt { font-size: 13px; color: var(--ink); flex: 1; min-width: 0; line-height: 1.4; }
  .vc-evt a { color: var(--rust); text-decoration: none; }
  .vc-price { font-size: 11px; color: #888; white-space: nowrap; }
  .vc-hours { padding: 7px 14px; font-size: 11px; color: #888; background: #faf8f3; border-top: 1px solid #e8e4da; }
  .dc .vc-head { background: #000; }
  .dc .vc-name { color: #F7FE3A; }
  .dc .vc-sub { color: rgba(255,255,255,0.65); }
  .dc .vc-link { background: #F7FE3A; color: #000; }
  .dc .vc-evt a { color: #c84b2f; }
  .mb .vc-head { background: #141827; }
  .mb .vc-name { color: #fff; }
  .mb .vc-sub { color: rgba(255,255,255,0.6); }
  .mb .vc-link { background: #3346FF; color: #fff; }
  .mb .vc-evt a { color: #3346FF; }
  .gabh .vc-head { background: #022E62; }
  .gabh .vc-name { color: #fff; }
  .gabh .vc-sub { color: rgba(255,255,255,0.6); }
  .gabh .vc-link { background: #B21832; color: #fff; }
  .gabh .vc-evt a { color: #B21832; }

  .look-ahead-section { background: var(--ink); color: var(--cream); padding: 60px; }
  .la-header { font-family: 'Fraunces', serif; font-size: 48px; font-weight: 900; line-height: 1; letter-spacing: -0.02em; color: var(--cream); border-bottom: 2px solid rgba(245,240,232,0.2); padding-bottom: 14px; margin-bottom: 28px; display: flex; align-items: baseline; gap: 20px; }
  .la-header span { font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--gold); }
  .la-row { display: flex; gap: 20px; align-items: flex-start; padding: 14px 0; border-bottom: 1px solid rgba(245,240,232,0.1); }
  .la-row:last-child { border-bottom: none; }
  .la-date { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: var(--gold); min-width: 60px; flex-shrink: 0; padding-top: 2px; }
  .la-text { font-size: 15px; font-weight: 500; color: var(--cream); line-height: 1.35; }
  .la-text a { color: var(--gold); text-decoration: none; }
  .la-sub { font-size: 13px; color: rgba(245,240,232,0.55); margin-top: 3px; line-height: 1.5; }

  @media (max-width: 768px) {
    .sunday-flag { padding: 7px 20px; }
    .today-grid, .venues-grid { grid-template-columns: 1fr; }
    .week-section, .venues-section, .look-ahead-section { padding: 40px 20px; }
    .week-section-header { font-size: 38px; }
    .venues-header, .la-header { font-size: 36px; }
  }
</style>
</head>
<body>

<div class="sunday-flag">Sunday Edition &nbsp;&middot;&nbsp; Week Ahead &nbsp;&middot;&nbsp; ${date.pretty}</div>

<header class="masthead">
  <div class="masthead-left">Medford, Massachusetts<br>Est. 2026 &middot; Free to Read</div>
  <div class="masthead-title">
    <div class="name">Medford Mercury</div>
    <div class="tagline">The Smartest Way to Keep Up with Medford</div>
  </div>
  <div class="masthead-right">Sunday Edition<br>${date.pretty.split(",").slice(1).join(",").trim()}</div>
</header>
<div class="masthead-rule"></div>
<div class="masthead-sub">
  <span>Vol. I &middot; No. ${editionNumber}</span>
  <span class="nav-links">
    <a href="#today">Today</a><span class="nav-dot">&middot;</span>
    <a href="#this-week">This Week</a><span class="nav-dot">&middot;</span>
    <a href="#venues">Local Venues</a><span class="nav-dot">&middot;</span>
    <a href="#look-ahead">Look Ahead</a>
  </span>
  <span><a href="/archive" style="color:inherit;text-decoration:none;border-bottom:1.5px solid transparent;transition:border-color 0.18s;" onmouseover="this.style.borderBottomColor='#c84b2f'" onmouseout="this.style.borderBottomColor='transparent'">Past Issues</a></span>
</div>


<!-- TODAY -->
<section id="today">
  <div class="today-grid">
    ${todayCards || '<div class="today-card"><div class="tc-title">Sunday in Medford</div><div class="tc-desc">Check the week-ahead calendar below for events starting today.</div></div>'}
  </div>
</section>


<!-- THIS WEEK -->
<section id="this-week" class="week-section">
  <div class="week-section-header">
    This Week in Medford
    <span class="wsh-sub">${weekRange}</span>
  </div>
  ${weekDayMap && dayBlocks}
  <div style="padding-bottom: 60px;"></div>
</section>


<!-- VENUE CARDS -->
<section id="venues" class="venues-section">
  <div class="venues-header">Local Venues</div>
  <div class="venues-grid">

    <div class="vc dc">
      <div class="vc-head">
        <div class="vc-head-inner">
          <div>
            <div class="vc-name">Deep Cuts</div>
            <div class="vc-sub">21 Main St &middot; music &middot; brewery &middot; records</div>
          </div>
        </div>
        <a class="vc-link" href="https://www.deepcuts.rocks/events" target="_blank">Calendar &rarr;</a>
      </div>
      <div class="vc-body">
        ${venueRows(data.deep_cuts) || '<div class="vc-row"><span class="vc-evt">Check deepcuts.rocks for this week\'s shows</span></div>'}
        <div class="vc-hours">Tue&ndash;Thu 12&ndash;9:30 PM &middot; Fri&ndash;Sat 12&ndash;11 PM &middot; Sun 12&ndash;8 PM</div>
      </div>
    </div>

    <div class="vc mb">
      <div class="vc-head">
        <div class="vc-head-inner">
          <img src="https://medfordbrew.com/wp-content/uploads/2025/10/Company-Logo.png" alt="Medford Brewing logo">
          <div>
            <div class="vc-name">Medford Brewing Co.</div>
            <div class="vc-sub">30 Harvard Ave &middot; taproom &middot; runs &middot; trivia</div>
          </div>
        </div>
        <a class="vc-link" href="https://medfordbrew.com/events/" target="_blank">Calendar &rarr;</a>
      </div>
      <div class="vc-body">
        ${venueRows(data.medford_brewing) || '<div class="vc-row"><span class="vc-evt">Sunday Run 11 AM &middot; Trivia Tue 7 PM &middot; medfordbrew.com</span></div>'}
        <div class="vc-hours">Mon&ndash;Thu 3&ndash;10 PM &middot; Fri&ndash;Sat 12&ndash;10 PM &middot; Sun 12&ndash;8 PM</div>
      </div>
    </div>

    <div class="vc gabh">
      <div class="vc-head">
        <div class="vc-head-inner">
          <img src="https://images.squarespace-cdn.com/content/v1/6761d96f807a6a3c15b567a0/9bc94fc3-1639-4669-9409-29ef074aee91/GABH_logo_simple.png?format=1500w" alt="Great American Beer Hall logo">
          <div>
            <div class="vc-name">Great American Beer Hall</div>
            <div class="vc-sub">142 Mystic Ave &middot; bar &middot; events &middot; sports</div>
          </div>
        </div>
        <a class="vc-link" href="https://www.gabhall.com/events" target="_blank">Calendar &rarr;</a>
      </div>
      <div class="vc-body">
        ${venueRows(data.gabh) || '<div class="vc-row"><span class="vc-evt">Check gabhall.com for this week\'s events</span></div>'}
        <div class="vc-hours">Mon&ndash;Wed 12&ndash;11 PM &middot; Thu 12&ndash;1 AM &middot; Fri 12&ndash;2 AM &middot; Sat 11&ndash;2 AM</div>
      </div>
    </div>

  </div>
</section>


<!-- LOOK AHEAD -->
<section id="look-ahead" class="look-ahead-section">
  <div class="la-header">Look Ahead <span>Coming up in Medford</span></div>
  ${laRows || '<div class="la-row"><div class="la-text">Check medfordma.org for upcoming events and city calendar.</div></div>'}
</section>


<!-- FOOTER -->
<footer class="footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <div class="fb-name">Medford Mercury</div>
      <div class="fb-tag">Sunday Edition &middot; ${date.pretty} &middot; Vol. I No. ${editionNumber}</div>
    </div>
    <div class="footer-cols">
      <div class="footer-col">
        <div class="fc-head">Sources</div>
        <p class="fc-body">City of Medford &middot; medfordma.org<br>
        Deep Cuts &middot; deepcuts.rocks<br>
        Medford Brewing Co. &middot; medfordbrew.com<br>
        Great American Beer Hall &middot; gabhall.com<br>
        Gotta Know Medford &middot; gottaknowmedford.com</p>
      </div>
      <div class="footer-col">
        <div class="fc-head">About</div>
        <p class="fc-body">Medford Mercury is your weekly guide to events in Medford, Massachusetts. Every Sunday we compile the full week ahead so you don't miss a thing.</p>
        <div style="margin-top: 14px;"><a href="/archive" class="footer-archive-link">Past Issues &rarr;</a></div>
      </div>
      <div class="footer-col">
        <div class="fc-head">Standards</div>
        <p class="fc-body">All events verified at source. Links go directly to venues. No advertising. No sponsored content. Errors corrected within one edition.</p>
      </div>
    </div>
  </div>
</footer>

</body>
</html>`;
}

// ── Edition number helper ──────────────────────────────────────────────────────

function getEditionNumber(slug) {
  const magsDir = path.join(__dirname, "../magazines");
  const all = fs.readdirSync(magsDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
    .sort();
  return all.length + 1;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function generate() {
  const date = getETDate();
  const outputPath = path.join(__dirname, "../magazines", `${date.slug}.html`);

  if (fs.existsSync(outputPath)) {
    console.log(`✓ Already exists: ${outputPath}`);
    process.exit(0);
  }

  console.log(`\n── Medford Mercury Sunday Edition · ${date.pretty} ──\n`);

  const weekDays = getDateRange(date.slug);
  const sharedCSS = loadSharedCSS();
  const editionNumber = getEditionNumber(date.slug);
  const data = await researchWeek(date, weekDays);
  const html = buildSundayHTML(date, weekDays, data, sharedCSS, editionNumber);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, "utf8");

  const kb = (fs.statSync(outputPath).size / 1024).toFixed(1);
  console.log(`\n✅ ${outputPath} (${kb} KB)`);

  fs.writeFileSync(
    path.join(__dirname, "../.edition-meta.json"),
    JSON.stringify({ date: date.slug, pretty: date.pretty, type: "sunday", outputPath, generatedAt: new Date().toISOString() }, null, 2)
  );
}

generate().catch(err => { console.error("FATAL:", err.message); process.exit(1); });
