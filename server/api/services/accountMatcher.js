const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { collection, query, where, getDocs, limit } = require('firebase/firestore');
const normalizeNameKey = require('../utils/normalizeNameKey');
const { db, APP_ID } = require('../config');

// Lookup maps built from accounts.csv
let refToName = {};      // "202-002" → "AARON SALDANA"
let icabbiIdToRef = {};  // "80102906" → "202-002"
let nameToRef = {};      // "aaron_saldana" → "202-002"

// Account group index: "202" → ["202-002", "202-003", ...], "671" → [...], "542" → [...]
let accountGroups = {};

// Known account group prefixes (derived from CSV on load)
let knownPrefixes = new Set();

/**
 * Extract the account group prefix from a REF like "202-002" → "202"
 */
function getAccountGroup(ref) {
  if (!ref) return null;
  const dash = ref.indexOf('-');
  return dash > 0 ? ref.substring(0, dash) : null;
}

/**
 * Parse accounts.csv and build lookup maps.
 * CSV columns: ID, REF, NAME, ACTIVE, ...
 */
function loadCSV() {
  // Try multiple locations: server root, repo root (standalone), and Vercel bundle paths
  const candidates = [
    path.join(__dirname, '..', '..', 'accounts.csv'),          // server/accounts.csv (Vercel root dir = server)
    path.join(__dirname, '..', '..', '..', 'accounts.csv'),   // standalone: server/src/services -> repo root
    path.join(process.cwd(), 'accounts.csv'),                  // cwd fallback
  ];
  const csvPath = candidates.find(p => fs.existsSync(p));
  if (!csvPath) {
    throw new Error(`accounts.csv not found. Tried: ${candidates.join(', ')}`);
  }
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

  refToName = {};
  icabbiIdToRef = {};
  nameToRef = {};
  accountGroups = {};
  knownPrefixes = new Set();

  for (const row of records) {
    const id = (row.ID || '').trim();
    const ref = (row.REF || '').trim();
    const name = (row.NAME || '').trim();

    if (!ref || !name) continue;

    refToName[ref] = name;
    if (id) icabbiIdToRef[id] = ref;
    nameToRef[normalizeNameKey(name)] = ref;

    // Build account group index
    const group = getAccountGroup(ref);
    if (group) {
      knownPrefixes.add(group);
      if (!accountGroups[group]) accountGroups[group] = [];
      accountGroups[group].push(ref);
    }
  }

  const groupSummary = Object.entries(accountGroups)
    .map(([prefix, refs]) => `${prefix}: ${refs.length}`)
    .join(', ');
  console.log(`[accountMatcher] Loaded ${Object.keys(refToName).length} accounts from CSV (${groupSummary})`);
}

/**
 * Check whether a given account_number or resolved REF belongs to a known account in the CSV.
 * Returns true if the account is recognized, false otherwise.
 */
function isKnownAccount(accountNumber) {
  if (!accountNumber) return false;
  const num = String(accountNumber).trim();
  // Direct REF match
  if (refToName[num]) return true;
  // iCabbi ID match
  if (icabbiIdToRef[num]) return true;
  return false;
}

/**
 * Return summary stats about loaded accounts, grouped by prefix.
 */
function getAccountStats() {
  return {
    totalAccounts: Object.keys(refToName).length,
    groups: Object.fromEntries(
      Object.entries(accountGroups).map(([prefix, refs]) => [prefix, refs.length])
    ),
    knownPrefixes: [...knownPrefixes],
  };
}

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
    const colRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'accounts');
    const q = query(colRef, where('accountId', '==', accountNumber), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const docSnap = snap.docs[0];
      const data = docSnap.data();
      return { docId: docSnap.id, clientName: data.clientName, accountId: data.accountId };
    }
  }

  return null;
}

module.exports = { loadCSV, matchAccount, isKnownAccount, getAccountGroup, getAccountStats };
