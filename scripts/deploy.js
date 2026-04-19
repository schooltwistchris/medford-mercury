/**
 * deploy.js
 * Reads the generated edition + all past editions,
 * builds the /tmp/site directory, and deploys to Cloudflare Pages.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAGAZINES_DIR = path.join(__dirname, "../magazines");
const SITE_DIR = "/tmp/medford-site";
const PROJECT_NAME = "medford-mercury";

function run(cmd) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { stdio: "inherit" });
}

function buildSite() {
  // Clean + recreate site dir
  if (fs.existsSync(SITE_DIR)) {
    fs.rmSync(SITE_DIR, { recursive: true });
  }
  fs.mkdirSync(SITE_DIR, { recursive: true });

  // Get all edition HTML files, sorted newest-first
  const editions = fs
    .readdirSync(MAGAZINES_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
    .sort()
    .reverse();

  if (editions.length === 0) {
    console.error("No editions found in magazines/");
    process.exit(1);
  }

  console.log(`Found ${editions.length} edition(s)`);

  // Latest edition → homepage (root index.html)
  const latest = editions[0];
  const latestSlug = latest.replace(".html", "");
  fs.copyFileSync(
    path.join(MAGAZINES_DIR, latest),
    path.join(SITE_DIR, "index.html")
  );
  console.log(`  Homepage → ${latest}`);

  // Each edition → /YYYY-MM-DD/index.html (permanent permalink)
  for (const edition of editions) {
    const slug = edition.replace(".html", "");
    const dir = path.join(SITE_DIR, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(
      path.join(MAGAZINES_DIR, edition),
      path.join(dir, "index.html")
    );
  }
  console.log(`  Permalinks created for all editions`);

  // Build archive page listing all editions
  const archiveRows = editions
    .map((e) => {
      const slug = e.replace(".html", "");
      const dateObj = new Date(`${slug}T12:00:00`);
      const dow = dateObj.getUTCDay(); // 0 = Sunday
      const editionType = dow === 0 ? "Sunday Edition" : "Morning Edition";
      const pretty = dateObj.toLocaleDateString("en-US", {
        timeZone: "UTC",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      return `<li><a href="/${slug}">
        <span class="ed-label">${editionType}</span>
        <span class="ed-date">${pretty}</span>
        <span class="ed-arrow">→</span>
      </a></li>`;
    })
    .join("\n      ");

  const archiveHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Archive — Medford Mercury</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@900&family=Inter:wght@300;400;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; background: #f5f0e8; color: #0e0d0b;
           max-width: 720px; margin: 0 auto; padding: 80px 24px; }
    header { border-bottom: 3px solid #0e0d0b; padding-bottom: 24px; margin-bottom: 48px; }
    h1 { font-family: 'Fraunces', serif; font-size: clamp(48px, 10vw, 80px);
         font-weight: 900; line-height: 0.9; letter-spacing: -0.02em; }
    .sub { font-size: 11px; font-weight: 700; letter-spacing: 0.2em;
           text-transform: uppercase; color: #888; margin-top: 10px; }
    ul { list-style: none; }
    li a { display: flex; justify-content: space-between; align-items: center;
           padding: 18px 0; border-bottom: 1px solid #d0cbbf;
           text-decoration: none; color: #0e0d0b;
           transition: padding-left 0.15s; }
    li a:hover { padding-left: 10px; color: #c84b2f; }
    li a:hover .ed-arrow { color: #c84b2f; }
    .ed-label { font-size: 10px; font-weight: 800; letter-spacing: 0.2em;
                text-transform: uppercase; color: #888; min-width: 110px; flex-shrink: 0; }
    .ed-date { font-size: 17px; font-weight: 500; flex: 1; }
    .ed-arrow { font-size: 16px; color: #ccc; flex-shrink: 0; }
    .back { margin-top: 40px; font-size: 12px; font-weight: 700;
            letter-spacing: 0.15em; text-transform: uppercase; }
    .back a { color: #c84b2f; text-decoration: none; }
  </style>
</head>
<body>
  <header>
    <h1>Medford Mercury</h1>
    <div class="sub">All Editions — Archive</div>
  </header>
  <ul>
      ${archiveRows}
  </ul>
  <p class="back"><a href="/">← Latest Edition</a></p>
</body>
</html>`;

  fs.writeFileSync(path.join(SITE_DIR, "archive.html"), archiveHTML);

  // Also serve archive at /archive/
  fs.mkdirSync(path.join(SITE_DIR, "archive"), { recursive: true });
  fs.writeFileSync(
    path.join(SITE_DIR, "archive", "index.html"),
    archiveHTML
  );

  console.log(`  Archive page built (${editions.length} editions)`);
  return { latest: latestSlug, count: editions.length };
}

async function deploy() {
  console.log("── Building site ──");
  const { latest, count } = buildSite();

  // Verify wrangler is available
  try {
    execSync("npx wrangler --version", { stdio: "pipe" });
  } catch {
    console.log("Installing wrangler...");
    execSync("npm install -g wrangler", { stdio: "inherit" });
  }

  console.log(`\n── Deploying to Cloudflare Pages (${count} editions) ──`);
  run(
    `npx wrangler pages deploy ${SITE_DIR} --project-name=${PROJECT_NAME} --branch=main --commit-message="Morning Edition ${latest}"`
  );

  console.log(`\n✅ Published: https://medford-mercury.pages.dev`);
  console.log(`   Today:    https://medford-mercury.pages.dev/${latest}`);
  console.log(`   Archive:  https://medford-mercury.pages.dev/archive`);
}

deploy().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
