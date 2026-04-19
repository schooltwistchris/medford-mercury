#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# publish.sh — Upload a dated HTML edition to Cloudflare Workers KV
#
# Usage:
#   ./scripts/publish.sh magazines/2026-04-14.html
#   ./scripts/publish.sh magazines/2026-04-14.html "Custom title override"
#
# Requirements:
#   - wrangler installed: npm install -g wrangler
#   - logged in:         wrangler login
#   - KV id set in wrangler.toml
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

FILE="${1:-}"
TITLE_OVERRIDE="${2:-}"

if [[ -z "$FILE" ]]; then
  echo "Usage: $0 <path/to/YYYY-MM-DD.html> [optional title]"
  exit 1
fi

if [[ ! -f "$FILE" ]]; then
  echo "Error: file not found: $FILE"
  exit 1
fi

# Extract date from filename (expects YYYY-MM-DD.html)
BASENAME=$(basename "$FILE" .html)
if ! [[ "$BASENAME" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "Error: filename must be YYYY-MM-DD.html, got: $BASENAME"
  exit 1
fi

DATE="$BASENAME"
KV_KEY="edition:$DATE"

# ── 1. Write the HTML into KV ─────────────────────────────────────────────────
echo "→ Uploading $FILE to KV key '$KV_KEY' ..."
wrangler kv key put --binding=EDITIONS "$KV_KEY" --path="$FILE"
echo "  ✓ Edition stored."

# ── 2. Extract title from HTML <title> tag ────────────────────────────────────
if [[ -n "$TITLE_OVERRIDE" ]]; then
  TITLE="$TITLE_OVERRIDE"
else
  TITLE=$(grep -oP '(?<=<title>)[^<]+' "$FILE" | head -1 || echo "Morning Edition")
fi

# ── 3. Update the index (JSON array, newest-first) ───────────────────────────
echo "→ Updating edition index ..."

# Fetch existing index (may be empty)
EXISTING=$(wrangler kv key get --binding=EDITIONS "index" 2>/dev/null || echo "[]")

# Inject new entry at the front, deduplicate by date using Node inline script
UPDATED=$(node -e "
  const list = JSON.parse(process.argv[1]);
  const entry = { date: '${DATE}', title: \`${TITLE}\`, slug: '/${DATE}' };
  const deduped = [entry, ...list.filter(e => e.date !== '${DATE}')];
  console.log(JSON.stringify(deduped));
" "$EXISTING")

# Write index back
echo "$UPDATED" | wrangler kv key put --binding=EDITIONS "index" --stdin
echo "  ✓ Index updated ($(echo "$UPDATED" | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));console.log(d.length)') editions total)."

# ── 4. Done ───────────────────────────────────────────────────────────────────
echo ""
echo "✅ Published: /$DATE"
echo "   View at: https://medford-mercury.YOUR_SUBDOMAIN.workers.dev/$DATE"
