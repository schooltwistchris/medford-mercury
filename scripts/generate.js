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
Produce a complete HTML page using the spread CSS classes already defined in the stylesheet.

RULES:
- Output ONLY raw HTML starting with <!DOCTYPE html>. No markdown, no explanation.
- Use <link rel="stylesheet" href="/magazine.css"> in the <head> — do NOT write any <style> tags
- Use Google Fonts in <head>: <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,100..900;1,9..144,100..900&family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
- Each story gets its own <section> using these exact spread classes: spread-hero, spread-midnight, spread-alert, spread-terminal, spread-academic, spread-stat
- Lead story uses spread-hero with: .kicker, .headline, .dek, .body-para, .why callout div
- spread-midnight has two child divs separated by <div class="divider"></div>
- spread-alert uses .alert-stamp and .timeline with .t-event/.t-date rows
- spread-terminal uses .sys-header, .t-headline, .t-body, .zone-cell
- spread-stat uses .stat-number, .stat-label, .race-row, .race-detail
- spread-events uses .event-card, .ev-time, .ev-title
- Masthead: <header class="masthead"> with .masthead-left, .masthead-title (.name + .tagline), .masthead-right
- Below masthead: <div class="masthead-rule"> then <div class="masthead-sub"> with .nav-links anchors
- Lead story gets a "Why it matters" dark callout box: <div class="why">...</div>
- Nav bar: <a href="#section-id"> links for each section
- Footer: class="footer" with .footer-inner, .footer-brand (.fb-name + .fb-tag), .footer-cols with 3x .footer-col
- Footer links to yesterday: /${yesterday}
- Vol. I No. [N] — calculate N as weekdays since April 14 2026`,
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

  let html = response.content.filter(b => b.type === "text").map(b => b.text).join("");
  html = html.replace(/^```html\s*/i, "").replace(/\s*```\s*$/, "").trim();

  // Inject the real CSS inline, replacing the placeholder link tag
  html = html.replace(
    /<link[^>]+href=["']\/magazine\.css["'][^>]*>/i,
    `<style>\n${sharedCSS}\n</style>`
  );

  // Fallback: if no <style> tag ended up in the doc, inject before </head>
  if (!html.includes("<style>")) {
    html = html.replace("</head>", `<style>\n${sharedCSS}\n</style>\n</head>`);
  }

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
