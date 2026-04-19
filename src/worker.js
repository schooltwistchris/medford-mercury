/**
 * Medford Mercury — Cloudflare Worker
 *
 * Routes:
 *   GET /                      → latest edition (redirects to today's date slug)
 *   GET /YYYY-MM-DD            → specific edition from KV
 *   GET /archive               → list of all published editions
 *   GET /health                → health check (useful for CI)
 *
 * KV namespace: EDITIONS
 *   Keys:    "edition:YYYY-MM-DD"   → raw HTML string
 *            "index"                → JSON array of { date, title, slug } newest-first
 */

const SITE_NAME = "Medford Mercury";
const SITE_TAGLINE = "The Smartest Way to Keep Up with Medford";

// ─── helpers ──────────────────────────────────────────────────────────────────

function todaySlug() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD" UTC
}

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html;charset=UTF-8",
      "Cache-Control": "public, max-age=300", // 5-min edge cache
    },
  });
}

function notFound(date) {
  return htmlResponse(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Not Found — ${SITE_NAME}</title>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@900&family=Inter:wght@400;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background: #f5f0e8; color: #0e0d0b;
           display: flex; flex-direction: column; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; text-align: center; padding: 40px; }
    h1 { font-family: 'Fraunces', serif; font-size: clamp(60px, 10vw, 120px);
         font-weight: 900; line-height: 0.9; margin-bottom: 24px; }
    p  { font-size: 20px; color: #555; max-width: 420px; line-height: 1.6; }
    a  { color: #c84b2f; font-weight: 700; }
  </style>
</head>
<body>
  <h1>No edition<br>for ${date}</h1>
  <p>That date hasn't been published yet — or the slug is wrong.<br>
     <a href="/">Go to the latest edition →</a></p>
</body>
</html>`,
    404
  );
}

// ─── archive page ─────────────────────────────────────────────────────────────

async function archivePage(env) {
  const raw = await env.EDITIONS.get("index");
  const editions = raw ? JSON.parse(raw) : [];

  const rows = editions.length
    ? editions
        .map(
          (e) =>
            `<li><a href="/${e.date}">${e.date} — ${e.title || "Morning Edition"}</a></li>`
        )
        .join("\n        ")
    : "<li>No editions published yet.</li>";

  return htmlResponse(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Archive — ${SITE_NAME}</title>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@900&family=Inter:wght@300;400;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; background: #f5f0e8; color: #0e0d0b;
           max-width: 760px; margin: 0 auto; padding: 80px 40px; }
    header { border-bottom: 3px solid #0e0d0b; padding-bottom: 24px; margin-bottom: 48px; }
    h1 { font-family: 'Fraunces', serif; font-size: 72px; font-weight: 900;
         line-height: 0.9; letter-spacing: -0.02em; }
    .sub { font-size: 12px; font-weight: 700; letter-spacing: 0.2em;
           text-transform: uppercase; color: #888; margin-top: 12px; }
    ul { list-style: none; }
    li { border-bottom: 1px solid #d0cbbf; }
    a { display: block; padding: 18px 0; font-size: 18px; font-weight: 500;
        color: #0e0d0b; text-decoration: none;
        transition: color 0.15s, padding-left 0.15s; }
    a:hover { color: #c84b2f; padding-left: 12px; }
    .back { margin-top: 48px; font-size: 13px; font-weight: 700;
            letter-spacing: 0.15em; text-transform: uppercase; }
    .back a { display: inline; padding: 0; color: #c84b2f; font-size: 13px; }
  </style>
</head>
<body>
  <header>
    <h1>${SITE_NAME}</h1>
    <div class="sub">Archive — All Editions</div>
  </header>
  <ul>
        ${rows}
  </ul>
  <p class="back"><a href="/">← Latest Edition</a></p>
</body>
</html>`);
}

// ─── main handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    // Health check
    if (path === "/health") {
      return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Archive index
    if (path === "/archive") {
      return archivePage(env);
    }

    // Root → redirect to today (or latest available)
    if (path === "/") {
      const today = todaySlug();
      // Try today first; fall back to latest in index
      const exists = await env.EDITIONS.get(`edition:${today}`);
      if (exists) {
        return Response.redirect(`${url.origin}/${today}`, 302);
      }
      // Fall back to most recent in index
      const raw = await env.EDITIONS.get("index");
      const editions = raw ? JSON.parse(raw) : [];
      if (editions.length > 0) {
        return Response.redirect(`${url.origin}/${editions[0].date}`, 302);
      }
      return notFound(today);
    }

    // Date slug: /YYYY-MM-DD
    const dateMatch = path.match(/^\/(\d{4}-\d{2}-\d{2})$/);
    if (dateMatch) {
      const date = dateMatch[1];
      const html = await env.EDITIONS.get(`edition:${date}`);
      if (!html) return notFound(date);
      return htmlResponse(html);
    }

    // Fallthrough 404
    return notFound(path);
  },
};
