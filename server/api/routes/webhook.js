const express = require('express');
const { WEBHOOK_SECRET } = require('../config');
const { matchAccount, isKnownAccount, getAccountGroup, getAccountStats } = require('../services/accountMatcher');
const { addTransaction } = require('../services/transactionWriter');

const router = express.Router();

// In-memory webhook activity counters (reset on cold start)
const webhookStats = {
  totalReceived: 0,
  totalProcessed: 0,
  totalSkipped: 0,
  totalErrors: 0,
  byGroup: {},    // "202": { received: 5, processed: 4, errors: 1 }
  lastActivity: null,
};

function trackActivity(group, outcome) {
  webhookStats.totalReceived++;
  webhookStats.lastActivity = new Date().toISOString();

  const key = group || 'unknown';
  if (!webhookStats.byGroup[key]) {
    webhookStats.byGroup[key] = { received: 0, processed: 0, skipped: 0, errors: 0 };
  }
  webhookStats.byGroup[key].received++;

  if (outcome === 'processed') {
    webhookStats.totalProcessed++;
    webhookStats.byGroup[key].processed++;
  } else if (outcome === 'skipped') {
    webhookStats.totalSkipped++;
    webhookStats.byGroup[key].skipped++;
  } else if (outcome === 'error') {
    webhookStats.totalErrors++;
    webhookStats.byGroup[key].errors++;
  }
}

/**
 * Validate the webhook secret header.
 * Returns true if valid, sends 401 response and returns false otherwise.
 */
function validateSecret(req, res) {
  const secret = req.headers['x-webhook-secret'];
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    console.warn('[webhook] Unauthorized request — invalid or missing x-webhook-secret');
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

/**
 * Process a single completed-trip payload.
 * Returns { status, statusCode, body } for the caller to use.
 */
async function processSingleTrip(payload) {
  const { booking_id, account_number, account_name, date, fare } = payload;

  // Validate required fields
  if (!account_number) {
    return { status: 'error', statusCode: 400, body: { error: 'Missing required field: account_number' } };
  }
  if (!fare && fare !== 0) {
    return { status: 'error', statusCode: 400, body: { error: 'Missing required field: fare' } };
  }
  if (!date) {
    return { status: 'error', statusCode: 400, body: { error: 'Missing required field: date' } };
  }

  // Check if this account is in our CSV — skip silently if not recognized
  if (!isKnownAccount(account_number)) {
    const group = getAccountGroup(String(account_number));
    console.log(`[webhook] Skipping booking ${booking_id} — account ${account_number} not in accounts.csv`);
    trackActivity(group, 'skipped');
    return {
      status: 'skipped',
      statusCode: 200,
      body: { status: 'skipped', reason: 'account_not_in_filter', account_number, booking_id },
    };
  }

  console.log(`[webhook] Processing booking ${booking_id} for account ${account_number} (${account_name})`);

  try {
    // Match to Firebase account
    const match = await matchAccount(payload);
    if (!match) {
      console.warn(`[webhook] No Firestore match for: ${account_number} / ${account_name}`);
      trackActivity(getAccountGroup(String(account_number)), 'error');
      return {
        status: 'error',
        statusCode: 404,
        body: { error: 'Account not found in Firestore', account_number, account_name },
      };
    }

    const group = getAccountGroup(match.accountId);
    console.log(`[webhook] Matched → ${match.docId} (${match.clientName}) [group: ${group}]`);

    // Write transaction
    const result = await addTransaction(match.docId, payload);

    if (result.status === 'duplicate') {
      console.log(`[webhook] Duplicate: ${result.message} [group: ${group}]`);
      trackActivity(group, 'processed');
      return { status: 'duplicate', statusCode: 200, body: { status: 'duplicate', bookingId: booking_id } };
    }

    if (result.status === 'error') {
      console.error(`[webhook] Write error: ${result.message} [group: ${group}]`);
      trackActivity(group, 'error');
      return { status: 'error', statusCode: 500, body: { error: result.message } };
    }

    console.log(`[webhook] Success: ${result.message} [group: ${group}]`);
    trackActivity(group, 'processed');
    return {
      status: 'ok',
      statusCode: 200,
      body: { status: 'ok', docId: match.docId, bookingId: booking_id, accountGroup: group },
    };
  } catch (err) {
    console.error(`[webhook] Unhandled error for booking ${booking_id}:`, err);
    trackActivity(getAccountGroup(String(account_number)), 'error');
    return { status: 'error', statusCode: 500, body: { error: 'Internal server error' } };
  }
}

// ─── Single trip endpoint (backwards-compatible) ───────────────────────────────
router.post('/icabbi', async (req, res) => {
  if (!validateSecret(req, res)) return;

  const result = await processSingleTrip(req.body || {});
  return res.status(result.statusCode).json(result.body);
});

// ─── Batch endpoint: process multiple completed trips in one call ──────────────
router.post('/icabbi/batch', async (req, res) => {
  if (!validateSecret(req, res)) return;

  const trips = req.body?.trips;
  if (!Array.isArray(trips) || trips.length === 0) {
    return res.status(400).json({ error: 'Request body must contain a non-empty "trips" array' });
  }

  console.log(`[webhook/batch] Received ${trips.length} trips`);

  const results = [];
  for (const trip of trips) {
    const result = await processSingleTrip(trip);
    results.push({
      booking_id: trip.booking_id || null,
      account_number: trip.account_number || null,
      ...result.body,
    });
  }

  const summary = {
    total: results.length,
    ok: results.filter(r => r.status === 'ok').length,
    duplicate: results.filter(r => r.status === 'duplicate').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errors: results.filter(r => r.error).length,
  };

  console.log(`[webhook/batch] Done — ${summary.ok} ok, ${summary.duplicate} duplicate, ${summary.skipped} skipped, ${summary.errors} errors`);

  return res.status(200).json({ status: 'batch_complete', summary, results });
});

// ─── Stats endpoint: webhook activity + account group summary ──────────────────
router.get('/stats', (req, res) => {
  const accountInfo = getAccountStats();
  return res.json({
    webhook: webhookStats,
    accounts: accountInfo,
  });
});

module.exports = router;
