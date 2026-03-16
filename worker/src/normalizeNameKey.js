/**
 * Ported from index.html:611-619 — must stay in sync.
 * Produces the deterministic key used in Firestore document IDs.
 */
export function normalizeNameKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\+\s*\d+\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '_');
}
