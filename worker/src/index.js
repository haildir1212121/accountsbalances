/**
 * Cloudflare Worker — iCabbi completed-trip webhook receiver.
 *
 * Endpoints:
 *   POST /webhook/icabbi        — single completed trip
 *   POST /webhook/icabbi/batch  — multiple completed trips
 *   GET  /webhook/stats         — account + activity summary
 *   GET  /health                — health check
 *
 * Environment variables (set via wrangler secret):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, WEBHOOK_SECRET
 */

import { createClient } from './supabase.js';

// ─── Helpers ────────────────────────────────────────────────────────────────────

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getAccountGroup(ref) {
  if (!ref) return null;
  const dash = String(ref).indexOf('-');
  return dash > 0 ? String(ref).substring(0, dash) : null;
}

/**
 * Look up an account in Supabase by ref, icabbi_id, or name.
 * Returns the account row or null.
 */
async function findAccount(db, accountNumber, accountName) {
  const num = String(accountNumber || '').trim();
  const name = String(accountName || '').trim();

  // 1. Try direct ref match (e.g. "202-002")
  if (num) {
    const rows = await db.query('accounts', { filters: { ref: num } });
    if (rows.length > 0) return rows[0];
  }

  // 2. Try iCabbi numeric ID match (e.g. "80102906")
  if (num) {
    const rows = await db.query('accounts', { filters: { icabbi_id: num } });
    if (rows.length > 0) return rows[0];
  }

  // 3. Try case-insensitive name match
  if (name) {
    const rows = await db.query('accounts', { filters: { name: name.toUpperCase() } });
    if (rows.length > 0) return rows[0];
  }

  return null;
}

/**
 * Process one completed-trip payload.
 * Returns { status, statusCode, body }.
 */
async function processSingleTrip(db, payload) {
  const { booking_id, account_number, account_name, date, fare } = payload || {};

  // Validate required fields
  if (!account_number) {
    return { statusCode: 400, body: { error: 'Missing required field: account_number' } };
  }
  if (!fare && fare !== 0) {
    return { statusCode: 400, body: { error: 'Missing required field: fare' } };
  }
  if (!date) {
    return { statusCode: 400, body: { error: 'Missing required field: date' } };
  }

  // Match account from Supabase
  const account = await findAccount(db, account_number, account_name);

  if (!account) {
    console.log(`[webhook] Dropping booking ${booking_id} — account ${account_number} not found`);
    return {
      statusCode: 200,
      body: { status: 'dropped', reason: 'account_not_matched', account_number, booking_id },
    };
  }

  // Parse trip date
  const tripDate = new Date(date);
  if (isNaN(tripDate.getTime())) {
    return { statusCode: 400, body: { error: `Invalid date: ${date}` } };
  }
  const formattedDate = tripDate.toISOString().split('T')[0]; // YYYY-MM-DD

  const fareNum = parseFloat(fare) || 0;

  // Insert trip — unique constraint on (booking_id, account_ref) prevents duplicates
  try {
    await db.insert('trips', {
      booking_id: String(booking_id || `auto_${Date.now()}`),
      account_ref: account.ref,
      account_name: account.name,
      account_group: account.account_group,
      fare: fareNum,
      trip_date: formattedDate,
      raw_payload: payload,
    });
  } catch (err) {
    // Check for unique constraint violation (duplicate booking)
    if (err.message && err.message.includes('409')) {
      console.log(`[webhook] Duplicate booking ${booking_id} for ${account.ref}`);
      return {
        statusCode: 200,
        body: { status: 'duplicate', booking_id, account_ref: account.ref },
      };
    }
    if (err.message && err.message.includes('23505')) {
      console.log(`[webhook] Duplicate booking ${booking_id} for ${account.ref}`);
      return {
        statusCode: 200,
        body: { status: 'duplicate', booking_id, account_ref: account.ref },
      };
    }
    throw err;
  }

  console.log(`[webhook] Logged booking ${booking_id} → ${account.ref} (${account.name}) [${account.account_group}] $${fareNum}`);

  return {
    statusCode: 200,
    body: {
      status: 'ok',
      booking_id,
      account_ref: account.ref,
      account_name: account.name,
      account_group: account.account_group,
      fare: fareNum,
    },
  };
}

// ─── Route handlers ─────────────────────────────────────────────────────────────

async function handleSingleTrip(db, request) {
  const payload = await request.json();
  const result = await processSingleTrip(db, payload);
  return json(result.body, result.statusCode);
}

async function handleBatchTrips(db, request) {
  const body = await request.json();
  const trips = body?.trips;

  if (!Array.isArray(trips) || trips.length === 0) {
    return json({ error: 'Request body must contain a non-empty "trips" array' }, 400);
  }

  console.log(`[webhook/batch] Received ${trips.length} trips`);

  const results = [];
  for (const trip of trips) {
    try {
      const result = await processSingleTrip(db, trip);
      results.push({ booking_id: trip.booking_id || null, ...result.body });
    } catch (err) {
      console.error(`[webhook/batch] Error processing ${trip.booking_id}:`, err.message);
      results.push({ booking_id: trip.booking_id || null, status: 'error', error: err.message });
    }
  }

  const summary = {
    total: results.length,
    ok: results.filter(r => r.status === 'ok').length,
    duplicate: results.filter(r => r.status === 'duplicate').length,
    dropped: results.filter(r => r.status === 'dropped').length,
    errors: results.filter(r => r.status === 'error').length,
  };

  console.log(`[webhook/batch] Done — ok:${summary.ok} dup:${summary.duplicate} dropped:${summary.dropped} err:${summary.errors}`);

  return json({ status: 'batch_complete', summary, results });
}

async function handleStats(db) {
  // Account counts per group
  const accounts = await db.query('accounts', { select: 'account_group' });
  const groupCounts = {};
  for (const a of accounts) {
    groupCounts[a.account_group] = (groupCounts[a.account_group] || 0) + 1;
  }

  // Trip counts per group (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const trips = await db.query('trips', { select: 'account_group,fare' });

  const tripStats = {};
  let totalFare = 0;
  for (const t of trips) {
    if (!tripStats[t.account_group]) {
      tripStats[t.account_group] = { count: 0, totalFare: 0 };
    }
    tripStats[t.account_group].count++;
    tripStats[t.account_group].totalFare += parseFloat(t.fare) || 0;
    totalFare += parseFloat(t.fare) || 0;
  }

  return json({
    accounts: {
      total: accounts.length,
      byGroup: groupCounts,
    },
    trips: {
      total: trips.length,
      totalFare: Math.round(totalFare * 100) / 100,
      byGroup: tripStats,
    },
  });
}

function handleHealth() {
  return json({ status: 'ok', runtime: 'cloudflare-worker', timestamp: new Date().toISOString() });
}

// ─── Main fetch handler ─────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // Health check — no auth required
    if (method === 'GET' && pathname === '/health') {
      return handleHealth();
    }

    // Stats — no webhook secret required (read-only)
    if (method === 'GET' && pathname === '/webhook/stats') {
      const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
      try {
        return await handleStats(db);
      } catch (err) {
        console.error('[stats] Error:', err.message);
        return json({ error: 'Failed to fetch stats' }, 500);
      }
    }

    // All webhook POST routes require secret
    if (method === 'POST' && pathname.startsWith('/webhook/')) {
      const secret = request.headers.get('x-webhook-secret');
      if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
        return json({ error: 'Unauthorized' }, 401);
      }

      const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

      try {
        if (pathname === '/webhook/icabbi') {
          return await handleSingleTrip(db, request);
        }
        if (pathname === '/webhook/icabbi/batch') {
          return await handleBatchTrips(db, request);
        }
      } catch (err) {
        console.error('[webhook] Unhandled error:', err.message);
        return json({ error: 'Internal server error' }, 500);
      }
    }

    return json({ error: 'Not found' }, 404);
  },
};
