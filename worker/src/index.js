import { refToName, icabbiIdToRef, nameToRef } from './accounts.js';
import { normalizeNameKey } from './normalizeNameKey.js';
import {
  accountDocPath,
  getDocument,
  queryByAccountId,
  updateDocument,
  fromFirestoreFields,
  toFirestoreValue,
} from './firestore.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    if (request.method === 'POST' && url.pathname === '/webhook/icabbi') {
      return handleWebhook(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },
};

/**
 * Build the Firestore document ID for a given name + ref.
 */
function buildDocId(name, ref) {
  return `client_${normalizeNameKey(name)}_${ref}`;
}

/**
 * Match an incoming webhook payload to a Firestore account document.
 * Returns { docId, clientName, accountId } or null.
 */
async function matchAccount(payload) {
  const accountNumber = (payload.account_number || '').trim();
  const accountName = (payload.account_name || '').trim();

  // 1. Direct REF match (account_number = "202-002")
  if (accountNumber && refToName[accountNumber]) {
    const name = refToName[accountNumber];
    return { docId: buildDocId(name, accountNumber), clientName: name, accountId: accountNumber };
  }

  // 2. iCabbi numeric ID match (account_number = "80102906")
  if (accountNumber && icabbiIdToRef[accountNumber]) {
    const ref = icabbiIdToRef[accountNumber];
    const name = refToName[ref];
    return { docId: buildDocId(name, ref), clientName: name, accountId: ref };
  }

  // 3. Name fallback
  if (accountName) {
    const normalized = normalizeNameKey(accountName);
    const ref = nameToRef[normalized];
    if (ref) {
      const name = refToName[ref];
      return { docId: buildDocId(name, ref), clientName: name, accountId: ref };
    }
  }

  // 4. Firestore query fallback
  if (accountNumber) {
    const result = await queryByAccountId(accountNumber);
    if (result) {
      const data = fromFirestoreFields(result.fields);
      return { docId: result.docId, clientName: data.clientName, accountId: data.accountId };
    }
  }

  return null;
}

/**
 * Add a transaction to the matched account's budgetData in Firestore.
 * Returns { status, message }.
 */
async function addTransaction(docId, bookingData) {
  const docPath = accountDocPath(docId);
  const doc = await getDocument(docPath);

  if (!doc) {
    return { status: 'error', message: `Account document ${docId} not found in Firestore` };
  }

  const account = fromFirestoreFields(doc.fields);
  const budgetData = Array.isArray(account.budgetData) ? [...account.budgetData] : [];

  // Parse the booking date
  const bookingDate = new Date(bookingData.date);
  if (isNaN(bookingDate.getTime())) {
    return { status: 'error', message: `Invalid date: ${bookingData.date}` };
  }

  const txMonth = bookingDate.getMonth();
  const txYear = bookingDate.getFullYear();
  const formattedDate = `${txYear}-${String(txMonth + 1).padStart(2, '0')}-${String(bookingDate.getDate()).padStart(2, '0')}`;

  // Find matching budget month
  let bIdx = budgetData.findIndex((b) => {
    const d = new Date(b.monthLabel);
    return d.getMonth() === txMonth && d.getFullYear() === txYear;
  });

  // Auto-create budget entry if none exists for this month
  if (bIdx === -1) {
    budgetData.push({
      monthLabel: `${txMonth + 1}/1/${txYear}`,
      monthlyLimit: 600,
      totalSpent: 0,
      remainingBudget: 600,
      transactions: [],
    });
    bIdx = budgetData.length - 1;
  }

  const budget = budgetData[bIdx];
  const transactions = Array.isArray(budget.transactions) ? budget.transactions : [];

  // Duplicate check: skip if booking_id already recorded
  const bookingId = bookingData.booking_id || '';
  if (bookingId && transactions.some((tx) => tx.id && tx.id.includes(bookingId))) {
    return { status: 'duplicate', message: `Booking ${bookingId} already recorded` };
  }

  // Build transaction
  const amount = parseFloat(bookingData.fare) || 0;
  const newTx = {
    id: `wh_${bookingId}_${Date.now()}`,
    date: formattedDate,
    description: `iCabbi #${bookingId}`,
    amount,
  };

  // Append and recalculate
  budget.transactions = [...transactions, newTx];
  budget.totalSpent = budget.transactions
    .filter((tx) => tx.description !== 'Monthly Limit' && tx.date !== 'Monthly Limit')
    .reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
  budget.remainingBudget = (budget.monthlyLimit || 600) - budget.totalSpent;

  budgetData[bIdx] = budget;

  await updateDocument(docPath, {
    budgetData: toFirestoreValue(budgetData),
    lastUpdated: toFirestoreValue(new Date().toISOString()),
  });

  return { status: 'created', message: `Transaction ${newTx.id} added to ${docId}` };
}

/**
 * Handle POST /webhook/icabbi
 */
async function handleWebhook(request, env) {
  // 1. Validate webhook secret
  const secret = request.headers.get('x-webhook-secret');
  if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
    console.warn('[webhook] Unauthorized request — invalid or missing x-webhook-secret');
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { booking_id, account_number, account_name, date, fare } = body;

  // 2. Validate required fields
  if (!account_number) {
    return Response.json({ error: 'Missing required field: account_number' }, { status: 400 });
  }
  if (!fare && fare !== 0) {
    return Response.json({ error: 'Missing required field: fare' }, { status: 400 });
  }
  if (!date) {
    return Response.json({ error: 'Missing required field: date' }, { status: 400 });
  }

  console.log(`[webhook] Received booking ${booking_id} for account ${account_number} (${account_name})`);

  try {
    // 3. Match to Firebase account
    const match = await matchAccount(body);
    if (!match) {
      console.warn(`[webhook] No matching account for: ${account_number} / ${account_name}`);
      return Response.json(
        { error: 'Account not found', account_number, account_name },
        { status: 404 }
      );
    }

    console.log(`[webhook] Matched to ${match.docId} (${match.clientName})`);

    // 4. Write transaction
    const result = await addTransaction(match.docId, body);

    if (result.status === 'duplicate') {
      console.log(`[webhook] Duplicate: ${result.message}`);
      return Response.json({ status: 'duplicate', bookingId: booking_id });
    }

    if (result.status === 'error') {
      console.error(`[webhook] Write error: ${result.message}`);
      return Response.json({ error: result.message }, { status: 500 });
    }

    console.log(`[webhook] Success: ${result.message}`);
    return Response.json({ status: 'ok', docId: match.docId, bookingId: booking_id });
  } catch (err) {
    console.error(`[webhook] Unhandled error:`, err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
