#!/usr/bin/env bash
set -euo pipefail

# ─── iCabbi Webhook Server — Cloudflare Workers Deploy Script ───
# Free tier: 100K requests/day, no credit card required

echo "=== iCabbi Webhook Server — Cloudflare Workers Deployment ==="
echo ""

# ─── 1. Check wrangler CLI ───
if ! npx wrangler --version &> /dev/null; then
  echo "ERROR: wrangler not found. Run: npm install"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── 2. Regenerate accounts data ───
echo "[1/4] Regenerating accounts data from CSV..."
node scripts/build-accounts.js

# ─── 3. Set webhook secret ───
echo ""
echo "[2/4] Setting webhook secret..."
echo "  (You'll be prompted to enter the secret value)"
npx wrangler secret put WEBHOOK_SECRET

# ─── 4. Deploy ───
echo ""
echo "[3/4] Deploying to Cloudflare Workers..."
npx wrangler deploy

# ─── 5. Get URL and print instructions ───
echo ""
echo "[4/4] Deployment complete!"
echo ""
echo "=== iCabbi Configuration ==="
echo "1. Set event trigger to: Booking completed"
echo "2. Set webhook URL to:   https://accountsbalances-webhook.<your-subdomain>.workers.dev/webhook/icabbi"
echo "3. Add header:           x-webhook-secret: <your-secret>"
echo "4. Remove any account ref filter — send ALL completed bookings"
echo ""
echo "=== Test Command ==="
echo "curl -X POST https://accountsbalances-webhook.<your-subdomain>.workers.dev/webhook/icabbi \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -H 'x-webhook-secret: <your-secret>' \\"
echo "  -d '{\"booking_id\":\"TEST001\",\"account_number\":\"202-002\",\"account_name\":\"AARON SALDANA\",\"date\":\"03/13/2026\",\"fare\":\"25.50\"}'"
