#!/usr/bin/env bash
set -euo pipefail

# ─── iCabbi Webhook Server — Azure Deploy Script ───
# Automates: resource group, App Service, env vars, code deploy
# No Firebase service account needed — uses client SDK with anonymous auth

echo "=== iCabbi Webhook Server — Azure Deployment ==="
echo ""

# ─── 1. Gather configuration ───
read -rp "App name (globally unique, e.g. mycompany-webhook): " APP_NAME
read -rp "Resource group [accountsbalances-rg]: " RESOURCE_GROUP
RESOURCE_GROUP="${RESOURCE_GROUP:-accountsbalances-rg}"
read -rp "Azure region [eastus]: " LOCATION
LOCATION="${LOCATION:-eastus}"
read -rp "Webhook secret (shared with iCabbi): " WEBHOOK_SECRET

PLAN_NAME="${APP_NAME}-plan"

echo ""
echo "Configuration:"
echo "  App name:       $APP_NAME"
echo "  Resource group: $RESOURCE_GROUP"
echo "  Region:         $LOCATION"
echo "  Plan:           $PLAN_NAME"
echo ""
read -rp "Continue? (y/N): " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# ─── 2. Check Azure CLI ───
if ! command -v az &> /dev/null; then
  echo "ERROR: Azure CLI (az) not found. Install from https://learn.microsoft.com/en-us/cli/azure/install-azure-cli"
  exit 1
fi

echo ""
echo "[1/6] Creating resource group..."
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

echo "[2/6] Creating App Service plan (Linux, Free tier)..."
az appservice plan create \
  --name "$PLAN_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --sku F1 \
  --is-linux \
  --output none

echo "[3/6] Creating web app (Node.js 20)..."
az webapp create \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --plan "$PLAN_NAME" \
  --runtime "NODE:20-lts" \
  --output none

echo "[4/6] Setting environment variables..."
az webapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    WEBHOOK_SECRET="$WEBHOOK_SECRET" \
    PORT=8080 \
  --output none

az webapp config set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --startup-file "npm start" \
  --output none

echo "[5/6] Packaging and deploying server code..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ZIP="$(mktemp /tmp/deploy-XXXXXX.zip)"

# Zip from the server directory, excluding dev files
(cd "$SCRIPT_DIR" && zip -r "$DEPLOY_ZIP" . \
  -x "node_modules/*" \
  -x ".env" \
  -x "deploy.sh" \
  -x ".git/*" \
  -x "*.zip" \
  > /dev/null)

az webapp deploy \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --src-path "$DEPLOY_ZIP" \
  --type zip \
  --output none

rm -f "$DEPLOY_ZIP"

echo "[6/6] Verifying deployment..."
APP_URL="https://${APP_NAME}.azurewebsites.net"
sleep 10  # Give Azure a moment to start the app

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${APP_URL}/health" 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
  echo ""
  echo "=== DEPLOYMENT SUCCESSFUL ==="
else
  echo ""
  echo "=== WARNING: Health check returned HTTP $HTTP_STATUS ==="
  echo "The app may still be starting. Check logs with:"
  echo "  az webapp log tail --name $APP_NAME --resource-group $RESOURCE_GROUP"
fi

echo ""
echo "App URL:     $APP_URL"
echo "Webhook URL: ${APP_URL}/webhook/icabbi"
echo "Health:      ${APP_URL}/health"
echo ""
echo "=== iCabbi Configuration ==="
echo "1. Set event trigger to: Booking completed"
echo "2. Set webhook URL to:   ${APP_URL}/webhook/icabbi"
echo "3. Add header:           x-webhook-secret: $WEBHOOK_SECRET"
echo "4. Remove any account ref filter — send ALL completed bookings"
echo ""
echo "=== Test Command ==="
echo "curl -X POST ${APP_URL}/webhook/icabbi \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -H 'x-webhook-secret: $WEBHOOK_SECRET' \\"
echo "  -d '{\"booking_id\":\"TEST001\",\"account_number\":\"202-002\",\"account_name\":\"AARON SALDANA\",\"date\":\"03/13/2026\",\"fare\":\"25.50\",\"price\":\"25.50\"}'"
