#!/usr/bin/env node

/**
 * Reads accounts.csv and generates src/accounts.js with embedded lookup maps.
 * Run: node scripts/build-accounts.js
 */

const fs = require('fs');
const path = require('path');

function normalizeNameKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\+\s*\d+\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '_');
}

const csvPath = path.join(__dirname, '..', '..', 'accounts.csv');
const raw = fs.readFileSync(csvPath, 'utf-8');
const lines = raw.trim().split('\n');
const header = lines[0].split(',');

const idIdx = header.indexOf('ID');
const refIdx = header.indexOf('REF');
const nameIdx = header.indexOf('NAME');

const refToName = {};
const icabbiIdToRef = {};
const nameToRef = {};

for (let i = 1; i < lines.length; i++) {
  // Simple CSV parse (no commas in values for this dataset)
  const cols = lines[i].split(',');
  const id = (cols[idIdx] || '').trim();
  const ref = (cols[refIdx] || '').trim();
  const name = (cols[nameIdx] || '').trim();

  if (!ref || !name) continue;

  refToName[ref] = name;
  if (id) icabbiIdToRef[id] = ref;
  nameToRef[normalizeNameKey(name)] = ref;
}

const output = `// Auto-generated from accounts.csv — do not edit manually.
// Regenerate with: npm run build-accounts

export const refToName = ${JSON.stringify(refToName, null, 2)};

export const icabbiIdToRef = ${JSON.stringify(icabbiIdToRef, null, 2)};

export const nameToRef = ${JSON.stringify(nameToRef, null, 2)};
`;

const outPath = path.join(__dirname, '..', 'src', 'accounts.js');
fs.writeFileSync(outPath, output, 'utf-8');
console.log(`[build-accounts] Generated ${outPath} with ${Object.keys(refToName).length} accounts`);
