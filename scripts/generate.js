/**
 * generate.js — Cost-optimised two-pass generator
 *
 * Pass 1 · Research (Haiku + web_search)
 *   Search Medford news → extract structured JSON of stories + events
 *   ~800–1200 input tokens, ~400 output tokens  ≈ $0.001
 *
 * Pass 2 · Write (Haiku, no tools)
 *   Turn JSON research into complete HTML using shared CSS template
 *   ~2000–3000 input tokens, ~4000 output tokens  ≈ $0.005
 *
 * Total per edition: ~$0.006–0.01  (vs ~$0.25 with Sonnet + big prompt)
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getEventsForDay } from "./recurring-events.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-haiku-4-5";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function getYesterdaySlug(slug) {
  const [y, m, d] = slug.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

// ── Shared CSS template (loaded once, never re-generated) ─────────────────────

function loadSharedCSS() {
  const cssPath = path.join(__dirname, "../src/magazine.css");
  if (fs.existsSync(cssPath)) return fs.readFileSync(cssPath, "utf8");
  // Fallback: extract CSS from most recent edition
  const mags = fs.readdirSync(path.join(__dirname, "../magazines"))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort().reverse();
  if (!mags.length) return "";
  const html = fs.readFileSync(path.join(__dirname, "../magazines", mags[0]), "utf8");
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  return match ? match[1] : "";
}

// ── Pass 1: Research ──────────────────────────────────────────────────────────

async function research(date, yesterday) {
  console.log("Pass 1 — Researching Medford news...");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    system: `You are a research assistant for a local Medford MA news publication.
Search for today's news and return ONLY a JSON object — no prose, no markdown fences.
JSON shape:
{
  "stories": [
    { "category": "City Government|Schools|Public Safety|Business|Community",
      "headline": "string", "summary": "2-3 sentences", "source": "url or site name",
      "why_it_matters": "1 sentence (lead story only, else null)" }
  ],
  "events": [
    { "time": "string", "title": "string", "location": "string", "desc": "1 sentence" }
  ]
}
Include 4–6 stories and all events happening today. Prioritise real news over fluff.`,
    messages: [{
      role: "user",
      content: `Today is ${date.pretty} (${date.slug}). Search for Medford Massachusetts local news, city hall meetings, school updates, and community events for today. Return only the JSON.`
    }],
  });

  // Find the text block
  let raw = response.content.filter(b => b.type === "text").map(b => b.text).join("");
  raw = raw.replace(/^```json\s*/i, "").replace(/\s*```\s*$/, "").trim();

  // Extract JSON object even if there's surrounding text
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn("Could not parse research JSON, using fallback");
    return { stories: [], events: [] };
  }

  const data = JSON.parse(jsonMatch[0]);
  console.log(`  Found ${data.stories?.length ?? 0} stories, ${data.events?.length ?? 0} events`);
  console.log(`  Tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);
  return data;
}

// ── Pass 2: Write HTML ────────────────────────────────────────────────────────

async function writeHTML(date, yesterday, researchData, sharedCSS, aroundTownHTML = "") {
  console.log("Pass 2 — Writing HTML edition...");

  const storiesJSON = JSON.stringify(researchData, null, 2);

  // CSS is NOT sent in the prompt — injected post-generation to save ~3000 tokens
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: `You are a magazine layout designer for the Medford Mercury, a daily local news magazine.
Output ONLY the story sections — the masthead and footer are added separately.

RULES:
- Output ONLY the <body> content between the masthead and footer — do NOT output <!DOCTYPE>, <html>, <head>, or <body> tags
- Do NOT write any masthead, header, nav, or footer — those are injected automatically
- Do NOT write any <style> tags or <link> tags
- Each story gets its own <section> using these exact spread classes: spread-hero, spread-midnight, spread-alert, spread-terminal, spread-academic, spread-stat
- Lead story uses spread-hero with: .kicker, .headline, .dek, .body-para, and <div class="why"> callout
- spread-midnight has two child divs separated by <div class="divider"></div>
- spread-alert uses .alert-stamp and .timeline with .t-event/.t-date rows
- spread-terminal uses .sys-header, .t-headline, .t-body, .zone-cell
- spread-stat uses .stat-number, .stat-label, .race-row, .race-detail
- spread-events uses .event-card, .ev-time, .ev-title
- Lead story gets a "Why it matters" dark callout box: <div class="why">...</div>
- Each section should have an id like id="section-topic" for nav linking
- Output ONLY the sections, nothing else`,
    messages: [{
      role: "user",
      content: `Date: ${date.pretty}
Slug: ${date.slug}
Yesterday: /${yesterday}

Research data:
${storiesJSON}

Write the complete HTML edition now. Use the CSS classes exactly as documented.

After the main stories and before the Today in Medford events section, insert this pre-built Around Town block exactly as-is (do not modify it):
${aroundTownHTML}`
    }],
  });

  let sections = response.content.filter(b => b.type === "text").map(b => b.text).join("");
  sections = sections.replace(/^```html\s*/i, "").replace(/\s*```\s*$/, "").trim();
  // Strip any accidental full-doc wrapper the model may have added
  if (/<body/i.test(sections)) {
  sections = sections.replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "").trim();
}
  // Calculate edition number (weekdays since Apr 14 2026 + Sundays)
  const startDate = new Date("2026-04-14T00:00:00Z");
  const thisDate = new Date(date.slug + "T00:00:00Z");
  const daysDiff = Math.round((thisDate - startDate) / 86400000);
  const editionNum = daysDiff + 1;

  // Build masthead with correct branding
  const mastheadDate = new Date(date.slug + "T12:00:00").toLocaleDateString("en-US", {
    timeZone: "UTC", month: "long", day: "numeric", year: "numeric"
  });
  const masthead = `<header class="masthead">
  <div class="masthead-left">Medford, Massachusetts<br>Est. 2026 &middot; Free to Read</div>
  <div class="masthead-title">
    <div class="name">Medford Mercury</div>
    <div class="tagline">The Smartest Way to Keep Up with Medford</div>
  </div>
  <div class="masthead-right">Morning Edition<br>${mastheadDate}</div>
</header>
<div class="masthead-rule"></div>
<div class="masthead-sub">
  <span>Vol. I &middot; No. ${editionNum}</span>
  <span class="nav-links">
    <a href="#section-community">Community</a><span class="nav-dot">&middot;</span>
    <a href="#section-politics">Politics</a><span class="nav-dot">&middot;</span>
    <a href="#section-environment">Environment</a><span class="nav-dot">&middot;</span>
    <a href="#section-events">Events</a>
  </span>
  <span><a href="/archive" style="color:inherit;text-decoration:none;border-bottom:1.5px solid transparent;transition:border-color 0.18s;" onmouseover="this.style.borderBottomColor='#c84b2f'" onmouseout="this.style.borderBottomColor='transparent'">Past Issues</a></span>
</div>`;

  // Build footer
  const footer = `<footer class="footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <div class="fb-name">Medford Mercury</div>
      <div class="fb-tag">Morning Edition &middot; ${date.pretty} &middot; Vol. I No. ${editionNum}</div>
    </div>
    <div class="footer-cols">
      <div class="footer-col">
        <div class="fc-head">Sources</div>
        <p class="fc-body">City of Medford &middot; medfordma.org<br>
        Gotta Know Medford &middot; gottaknowmedford.com<br>
        Deep Cuts &middot; deepcuts.rocks<br>
        Great American Beer Hall &middot; gabhall.com<br>
        Medford Brewing Co. &middot; medfordbrew.com</p>
      </div>
      <div class="footer-col">
        <div class="fc-head">About</div>
        <p class="fc-body">Medford Mercury is your daily guide to Medford, Massachusetts. We summarize in original language, verify at source, and always link back. Published Monday&ndash;Saturday plus Sunday.</p>
        <div style="margin-top: 14px;"><a href="/archive" class="footer-archive-link">Past Issues &rarr;</a></div>
      </div>
      <div class="footer-col">
        <div class="fc-head">Standards</div>
        <p class="fc-body">All content written in original language. No copied text from sources. Facts verified before publication. Corrections issued within one edition. No advertising. No sponsored content.</p>
      </div>
    </div>
  </div>
</footer>`;

  // Assemble full HTML document
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Medford Mercury &mdash; ${date.pretty}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,100..900;1,9..144,100..900&family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
\${sharedCSS}
</style>
</head>
<body>
\${masthead}
\${sections}
\${footer}
</body>
</html>`;

  console.log(`  Tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);
  return { html, usage: response.usage };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function buildAroundTown(events) {
  if (!events.length) return "";
  const cards = events.map(e => `
    <div class="at-card ${e.type}">
      <div class="at-tag">${e.tag}</div>
      <div class="at-name">${e.name}</div>
      <div class="at-cadence">${e.cadence}</div>
      <p class="at-desc">${e.desc}</p>
      <div class="at-addr">${e.addr}</div>
    </div>`).join("\n");

  return `
<!-- ═══ AROUND TOWN ═══ -->
<section class="spread-around-town">
  <div class="around-town-header">
    <h2>Around Town</h2>
    <span class="at-sub">Recurring · Every Week</span>
  </div>
  <div class="around-town-grid">
    ${cards}
  </div>
</section>`;
}

async function generate() {
  const date = getETDate();
  const yesterday = getYesterdaySlug(date.slug);
  const outputPath = path.join(__dirname, "../magazines", `${date.slug}.html`);

  if (fs.existsSync(outputPath)) {
    console.log(`✓ Already exists: ${outputPath}`);
    process.exit(0);
  }

  console.log(`\n── Medford Mercury · ${date.pretty} ──\n`);

  const sharedCSS = loadSharedCSS();
  const researchData = await research(date, yesterday);
  // Build recurring events HTML for today
  const dow = new Date(date.slug + "T12:00:00").getDay();
  const month = new Date(date.slug + "T12:00:00").getMonth();
  const recurringEvents = getEventsForDay(dow, month);
  const aroundTownHTML = buildAroundTown(recurringEvents);

  const { html, usage } = await writeHTML(date, yesterday, researchData, sharedCSS, aroundTownHTML);

  if (!html.startsWith("<!DOCTYPE") && !html.startsWith("<html")) {
    console.error("Bad HTML output — first 300 chars:");
    console.error(html.slice(0, 300));
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, "utf8");

  const kb = (fs.statSync(outputPath).size / 1024).toFixed(1);

  // Rough cost estimate (Haiku pricing: $0.80/$4.00 per M tokens in/out)
  const totalIn  = researchData._usage?.input  + usage.input_tokens  || usage.input_tokens;
  const totalOut = researchData._usage?.output + usage.output_tokens || usage.output_tokens;
  const costUSD  = ((totalIn * 0.0008 + totalOut * 0.004) / 1000).toFixed(4);

  console.log(`\n✅ ${outputPath} (${kb} KB)`);
  console.log(`   Est. cost: $${costUSD}`);

  fs.writeFileSync(
    path.join(__dirname, "../.edition-meta.json"),
    JSON.stringify({ date: date.slug, pretty: date.pretty, outputPath, yesterday, costUSD, generatedAt: new Date().toISOString() }, null, 2)
  );
}

generate().catch(err => { console.error("FATAL:", err.message); process.exit(1); });
