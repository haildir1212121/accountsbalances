#!/usr/bin/env bash
set -euo pipefail

# ─── iCabbi Webhook Server — Vercel Deploy Script ───
# Deploys the webhook server as a Vercel serverless function
# No Azure required — free tier available

echo "=== iCabbi Webhook Server — Vercel Deployment ==="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── 1. Check Vercel CLI ───
if ! command -v vercel &> /dev/null; then
  echo "Vercel CLI not found. Installing..."
  npm install -g vercel
fi

# ─── 2. Copy accounts.csv into server dir for bundling ───
ACCOUNTS_SRC="${SCRIPT_DIR}/../accounts.csv"
ACCOUNTS_DEST="${SCRIPT_DIR}/accounts.csv"

if [ -f "$ACCOUNTS_SRC" ]; then
  cp "$ACCOUNTS_SRC" "$ACCOUNTS_DEST"
  echo "[deploy] Copied accounts.csv into server directory for bundling"
else
  echo "ERROR: accounts.csv not found at ${ACCOUNTS_SRC}"
  exit 1
fi

# ─── 3. Prompt for webhook secret ───
read -rp "Webhook secret (shared with iCabbi): " WEBHOOK_SECRET

echo ""
echo "[deploy] Deploying to Vercel..."
echo ""

# ─── 4. Deploy with environment variable ───
cd "$SCRIPT_DIR"
vercel --prod \
  -e WEBHOOK_SECRET="$WEBHOOK_SECRET" \
  -e NODE_ENV=production

# ─── 5. Clean up copied CSV ───
rm -f "$ACCOUNTS_DEST"

echo ""
echo "=== DEPLOYMENT COMPLETE ==="
echo ""
echo "Your webhook URL will be shown above by Vercel."
echo "It will look like: https://your-project.vercel.app"
echo ""
echo "=== iCabbi Configuration ==="
echo "1. Set event trigger to: Booking completed"
echo "2. Set webhook URL to:   https://<your-project>.vercel.app/webhook/icabbi"
echo "3. Add header:           x-webhook-secret: <your-secret>"
echo "4. Remove any account ref filter — send ALL completed bookings"
echo ""
echo "=== Test Command ==="
echo "curl -X POST https://<your-project>.vercel.app/webhook/icabbi \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -H 'x-webhook-secret: <your-secret>' \\"
echo "  -d '{\"booking_id\":\"TEST001\",\"account_number\":\"202-002\",\"account_name\":\"AARON SALDANA\",\"date\":\"03/13/2026\",\"fare\":\"25.50\"}'"
echo ""
echo "=== Useful Commands ==="
echo "  vercel logs        — view recent function logs"
echo "  vercel env ls      — list environment variables"
echo "  vercel --prod      — redeploy to production"
