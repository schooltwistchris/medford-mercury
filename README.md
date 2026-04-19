# Medford Mercury

Daily local news magazine for Medford, Massachusetts.  
Auto-publishes every weekday at 5 AM ET via GitHub Actions → Claude API → Cloudflare Pages.

**Live site:** https://medford-mercury.pages.dev  
**Archive:** https://medford-mercury.pages.dev/archive

---

## How it works

```
5:00 AM ET (GitHub Actions cron)
  └─ scripts/generate.js
       └─ Claude API (claude-sonnet) + web_search
            └─ Searches Medford news sources
            └─ Writes complete HTML edition
            └─ Saves to magazines/YYYY-MM-DD.html
  └─ scripts/deploy.js
       └─ Builds /tmp/site with all editions + archive page
       └─ wrangler pages deploy → medford-mercury.pages.dev
  └─ git commit + push (edition saved to repo)
```

---

## One-time setup (15 minutes)

### 1. Create GitHub repo

```bash
cd medford-mercury
git init
git add .
git commit -m "Initial commit"
gh repo create medford-mercury --private --push --source=.
# or: git remote add origin https://github.com/YOUR_USER/medford-mercury.git && git push -u origin main
```

### 2. Add GitHub Secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|-------------|-------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key from console.anthropic.com |
| `CLOUDFLARE_API_TOKEN` | `cfut_dlVLand...` (your existing token) |
| `CLOUDFLARE_ACCOUNT_ID` | `6317521301097e53b0133749c9753dd0` |

### 3. Allow Actions to push commits

Go to repo → **Settings → Actions → General → Workflow permissions**  
Select: **Read and write permissions** ✓

### 4. Test it manually

Go to repo → **Actions → Daily Morning Edition → Run workflow**

Watch it run. First execution takes ~3 minutes (npm install + Claude API call + deploy).

---

## Daily schedule

The cron runs **Monday–Friday at 10:00 UTC** (= 5–6 AM ET depending on daylight saving).

To change the time, edit `.github/workflows/publish.yml`:
```yaml
- cron: '0 10 * * 1-5'   # UTC time, Mon-Fri
```

To add weekends:
```yaml
- cron: '0 10 * * *'     # every day
```

---

## Manual publish

```bash
# Generate + deploy today's edition
npm run publish

# Just generate (no deploy)
npm run generate

# Just deploy (uses existing magazines/)
npm run deploy
```

---

## Costs

| Service | Cost |
|---------|------|
| GitHub Actions | Free (2,000 min/month on free tier — you'll use ~150) |
| Cloudflare Pages | Free |
| Claude API (Sonnet) | ~$0.10–0.30 per edition |
| **Monthly total** | ~$3–6/month |

---

## File structure

```
medford-mercury/
├── .github/
│   └── workflows/
│       └── publish.yml        # GitHub Actions cron
├── magazines/
│   ├── 2026-04-14.html        # Past editions (committed to repo)
│   ├── 2026-04-15.html
│   └── YYYY-MM-DD.html        # New one added each morning
├── scripts/
│   ├── generate.js            # Calls Claude API → writes HTML
│   └── deploy.js              # Builds site dir + wrangler deploy
├── src/
│   └── worker.js              # (Legacy Workers script — not used by Pages)
├── package.json
├── wrangler.toml
└── README.md
```
