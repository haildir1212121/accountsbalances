#!/usr/bin/env node

/**
 * Seed the Supabase `accounts` table from accounts.csv.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=ey... node scripts/seed-accounts.js
 *
 * Or create a .env file in the project root with those values.
 */

const fs = require('fs');
const path = require('path');

// Load .env if present
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
  // dotenv is optional for this script
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables.');
  process.exit(1);
}

function getAccountGroup(ref) {
  const dash = ref.indexOf('-');
  return dash > 0 ? ref.substring(0, dash) : null;
}

async function main() {
  const csvPath = path.join(__dirname, '..', 'accounts.csv');
  const raw = fs.readFileSync(csvPath, 'utf-8');

  const lines = raw.trim().split('\n');
  const header = lines[0].split(',').map(h => h.trim());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    if (cols.length < 3) continue;

    const id = cols[0];
    const ref = cols[1];
    const name = cols[2];
    const sc = cols[7] || '0.00%';
    const discPrice = cols[8] || '0.00%';
    const discCost = cols[9] || '0.00%';
    const bc = cols[10] || '0.00%';

    if (!ref || !name) continue;

    const group = getAccountGroup(ref);
    if (!group) continue;

    rows.push({
      icabbi_id: id || null,
      ref,
      name,
      account_group: group,
      active: true,
      sc,
      disc_price: discPrice,
      disc_cost: discCost,
      bc,
    });
  }

  console.log(`Parsed ${rows.length} accounts from CSV`);

  // Upsert in batches of 50 using Supabase REST API
  const batchSize = 50;
  let upserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates',   // upsert on unique constraints
      },
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Batch ${i}-${i + batch.length} failed: ${res.status} ${errText}`);
      process.exit(1);
    }

    upserted += batch.length;
    console.log(`  Upserted ${upserted}/${rows.length}`);
  }

  console.log(`Done. ${upserted} accounts seeded into Supabase.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
