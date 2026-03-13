const express = require('express');
const { WEBHOOK_SECRET } = require('../config');
const { matchAccount } = require('../services/accountMatcher');
const { addTransaction } = require('../services/transactionWriter');

const router = express.Router();

router.post('/icabbi', async (req, res) => {
  // 1. Validate webhook secret
  const secret = req.headers['x-webhook-secret'];
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    console.warn('[webhook] Unauthorized request — invalid or missing x-webhook-secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body || {};
  const { booking_id, account_number, account_name, date, fare } = body;

  // 2. Validate required fields
  if (!account_number) {
    return res.status(400).json({ error: 'Missing required field: account_number' });
  }
  if (!fare && fare !== 0) {
    return res.status(400).json({ error: 'Missing required field: fare' });
  }
  if (!date) {
    return res.status(400).json({ error: 'Missing required field: date' });
  }

  console.log(`[webhook] Received booking ${booking_id} for account ${account_number} (${account_name})`);

  try {
    // 3. Match to Firebase account
    const match = await matchAccount(body);
    if (!match) {
      console.warn(`[webhook] No matching account for: ${account_number} / ${account_name}`);
      return res.status(404).json({ error: 'Account not found', account_number, account_name });
    }

    console.log(`[webhook] Matched to ${match.docId} (${match.clientName})`);

    // 4. Write transaction
    const result = await addTransaction(match.docId, body);

    if (result.status === 'duplicate') {
      console.log(`[webhook] Duplicate: ${result.message}`);
      return res.status(200).json({ status: 'duplicate', bookingId: booking_id });
    }

    if (result.status === 'error') {
      console.error(`[webhook] Write error: ${result.message}`);
      return res.status(500).json({ error: result.message });
    }

    console.log(`[webhook] Success: ${result.message}`);
    return res.status(200).json({ status: 'ok', docId: match.docId, bookingId: booking_id });

  } catch (err) {
    console.error(`[webhook] Unhandled error:`, err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
