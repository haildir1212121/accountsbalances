const API_KEY = 'AIzaSyB-P87cAnvDHpCoPocqhjHE9zGaDQXxe2U';
const PROJECT_ID = 'balance-t';
const APP_ID = 'balance-t-default';

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const IDENTITY_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`;

// Cache the auth token (anonymous tokens last ~1 hour)
let cachedToken = null;
let tokenExpiry = 0;

/**
 * Get an anonymous auth token via Google Identity Toolkit.
 */
async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch(IDENTITY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anonymous auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = data.idToken;
  // Refresh 5 minutes before expiry (tokens last 3600s)
  tokenExpiry = Date.now() + (parseInt(data.expiresIn, 10) - 300) * 1000;
  return cachedToken;
}

/**
 * Build the Firestore document path for an account.
 */
export function accountDocPath(docId) {
  return `artifacts/${APP_ID}/public/data/accounts/${docId}`;
}

/**
 * Get a Firestore document by path.
 * Returns the parsed fields as a plain JS object, or null if not found.
 */
export async function getDocument(docPath) {
  const token = await getToken();
  const url = `${FIRESTORE_BASE}/${docPath}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore GET failed (${res.status}): ${text}`);
  }

  const doc = await res.json();
  return { fields: doc.fields || {}, name: doc.name };
}

/**
 * Query Firestore for a document where accountId == value.
 * Returns { docId, fields } or null.
 */
export async function queryByAccountId(accountId) {
  const token = await getToken();
  const url = `${FIRESTORE_BASE}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'accounts' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'accountId' },
          op: 'EQUAL',
          value: { stringValue: accountId },
        },
      },
      limit: 1,
    },
  };

  // The parent path must include the full path to the parent of the collection
  const parentPath = `projects/${PROJECT_ID}/databases/(default)/documents/artifacts/${APP_ID}/public/data`;
  const res = await fetch(
    `https://firestore.googleapis.com/v1/${parentPath}:runQuery`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore query failed (${res.status}): ${text}`);
  }

  const results = await res.json();
  // Results is an array; first element may have .document or just .readTime
  if (!results || !results[0] || !results[0].document) return null;

  const doc = results[0].document;
  // Extract docId from name: .../accounts/docId
  const docId = doc.name.split('/').pop();
  return { docId, fields: doc.fields || {} };
}

/**
 * Update specific fields on a Firestore document.
 */
export async function updateDocument(docPath, fieldsToUpdate) {
  const token = await getToken();
  const fieldPaths = Object.keys(fieldsToUpdate);
  const mask = fieldPaths.map((f) => `updateMask.fieldPaths=${f}`).join('&');
  const url = `${FIRESTORE_BASE}/${docPath}?${mask}`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: fieldsToUpdate }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore PATCH failed (${res.status}): ${text}`);
  }

  return res.json();
}

// --- Firestore REST value helpers ---

export function toStringValue(s) {
  return { stringValue: String(s) };
}

export function toDoubleValue(n) {
  return { doubleValue: n };
}

export function toIntegerValue(n) {
  return { integerValue: String(n) };
}

export function toArrayValue(items) {
  return { arrayValue: { values: items } };
}

export function toMapValue(fields) {
  return { mapValue: { fields } };
}

/**
 * Convert a plain JS value to Firestore REST format.
 */
export function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

/**
 * Convert a Firestore REST value back to plain JS.
 */
export function fromFirestoreValue(val) {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in val) {
    const obj = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      obj[k] = fromFirestoreValue(v);
    }
    return obj;
  }
  return null;
}

/**
 * Convert all fields in a Firestore document to plain JS object.
 */
export function fromFirestoreFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields || {})) {
    obj[k] = fromFirestoreValue(v);
  }
  return obj;
}
