/**
 * Lightweight Supabase REST client for Cloudflare Workers.
 * Uses fetch directly — no SDK dependency needed.
 */

export function createClient(url, serviceKey) {
  const baseUrl = url.replace(/\/$/, '');

  async function query(table, { select = '*', filters = {}, single = false } = {}) {
    const params = new URLSearchParams();
    params.set('select', select);

    for (const [col, val] of Object.entries(filters)) {
      params.set(col, `eq.${val}`);
    }

    const headers = {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    };
    if (single) {
      headers['Accept'] = 'application/vnd.pgrst.object+json';
    }

    const res = await fetch(`${baseUrl}/rest/v1/${table}?${params}`, { headers });

    if (res.status === 406 && single) return null;   // no rows
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase query ${table} failed: ${res.status} ${text}`);
    }

    return res.json();
  }

  async function insert(table, rows, { onConflict, returning = 'minimal' } = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Prefer': returning === 'representation' ? 'return=representation' : 'return=minimal',
    };
    if (onConflict) {
      headers['Prefer'] += `,resolution=merge-duplicates`;
    }

    let url = `${baseUrl}/rest/v1/${table}`;
    if (onConflict) {
      url += `?on_conflict=${onConflict}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase insert ${table} failed: ${res.status} ${text}`);
    }

    if (returning === 'representation') {
      return res.json();
    }
    return { ok: true };
  }

  async function rpc(fnName, params = {}) {
    const res = await fetch(`${baseUrl}/rest/v1/rpc/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase rpc ${fnName} failed: ${res.status} ${text}`);
    }

    return res.json();
  }

  return { query, insert, rpc };
}
