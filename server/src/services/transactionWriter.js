const { db, APP_ID } = require('../config');

/**
 * Add a transaction to the matched account's budgetData in Firestore.
 * Replicates the portal logic from index.html:1386-1412.
 *
 * Returns { status: 'created' | 'duplicate' | 'error', message }
 */
async function addTransaction(docId, bookingData) {
  const docRef = db.collection('artifacts').doc(APP_ID)
    .collection('public').doc('data').collection('accounts').doc(docId);

  const snap = await docRef.get();
  if (!snap.exists) {
    return { status: 'error', message: `Account document ${docId} not found in Firestore` };
  }

  const account = snap.data();
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
  let bIdx = budgetData.findIndex(b => {
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
      transactions: []
    });
    bIdx = budgetData.length - 1;
  }

  const budget = budgetData[bIdx];
  const transactions = Array.isArray(budget.transactions) ? budget.transactions : [];

  // Duplicate check: skip if booking_id already recorded
  const bookingId = bookingData.booking_id || '';
  if (bookingId && transactions.some(tx => tx.id && tx.id.includes(bookingId))) {
    return { status: 'duplicate', message: `Booking ${bookingId} already recorded` };
  }

  // Build transaction
  const amount = parseFloat(bookingData.fare) || 0;
  const newTx = {
    id: `wh_${bookingId}_${Date.now()}`,
    date: formattedDate,
    description: `iCabbi #${bookingId}`,
    amount
  };

  // Append and recalculate
  budget.transactions = [...transactions, newTx];
  budget.totalSpent = budget.transactions
    .filter(tx => tx.description !== 'Monthly Limit' && tx.date !== 'Monthly Limit')
    .reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
  budget.remainingBudget = (budget.monthlyLimit || 600) - budget.totalSpent;

  budgetData[bIdx] = budget;

  await docRef.update({ budgetData, lastUpdated: new Date().toISOString() });

  return { status: 'created', message: `Transaction ${newTx.id} added to ${docId}` };
}

module.exports = { addTransaction };
