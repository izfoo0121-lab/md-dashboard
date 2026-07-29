// ── GistSync Module (Supabase-backed) ─────────────────────────────────
/**
 * MIRACLE-奇迹 MD Dashboard — Data Sync Module
 *
 * NOTE ON NAME: This module is still called "GistSync" for backwards
 * compatibility with ~40+ call sites across 4 HTML files. The Gist
 * backend was retired in Apr 2026 after token expiry; all operations
 * now go to Supabase. The external API shape is identical to the
 * original Gist module, so no caller changes were needed.
 *
 * Backend: Supabase (rqitgmydcbyiygqjssrb.supabase.co)
 * Tables:  claims, flags, kpi_scores, kpi_manual, audit_log
 *
 * Public API (all files):
 *   isConfigured()  → boolean (always true now)
 *   getConfig()     → {gist_id, token, backend}
 *   getCache()      → object (localStorage cache)
 *   getCacheAge()   → seconds since last sync
 *   syncToLocal(m)  → pulls month data from Supabase into localStorage
 *
 * Claims (sales_dashboard.html, management.html):
 *   saveClaim(month, agent, campId, debtorCode, claimData)
 *   removeClaim(month, agent, campId, debtorCode)
 *
 * Flags (management.html):
 *   saveFlags(month, agent, flagsObj)
 *
 * KPI (accounts.html, management.html):
 *   saveKPIScores(month, scoresObj)
 *
 * Low-level (admin.html + management.html):
 *   pull(fileKey)  → object      e.g. pull('claims_Apr26')
 *   push(fileKey, data) → bool   e.g. push('flags_Apr26', {...})
 *
 * Also: setup(), createGist(), saveConfig() — all no-op shims for
 * back-compat with old admin.html setup flows.
 */
const GistSync = (() => {

  // ── Configuration ────────────────────────────────────────────────────
  const SUPABASE_URL = 'https://rqitgmydcbyiygqjssrb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_8xb7ZaHyr3OF3WNEqufuDg_67spOIFw';

  const CACHE_KEY    = 'md_gist_cache';     // kept same key name for back-compat
  const CACHE_TS_KEY = 'md_gist_cache_ts';

  // ── Helpers ──────────────────────────────────────────────────────────
  function _headers(extra) {
    return Object.assign({
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }, extra || {});
  }

  function _slug(month) { return (month || '').replace(' ',''); }

  // Convert slug like "Apr26" back to "Apr 26" for Supabase queries
  function _monthFromSlug(slug) {
    const m = /^([A-Za-z]{3})(\d+)$/.exec(slug || '');
    if (m) return `${m[1]} ${m[2]}`;
    return slug;
  }

  async function _rest(path, opts) {
    opts = opts || {};
    const url = `${SUPABASE_URL}/rest/v1/${path}`;
    try {
      const r = await fetch(url, {
        method: opts.method || 'GET',
        headers: _headers(opts.headers),
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
      if (!r.ok) {
        console.warn(`[SupabaseSync] ${opts.method||'GET'} ${path} → ${r.status}`);
        return { ok:false, status:r.status };
      }
      if (r.status === 204) return { ok:true, data:null };
      const data = await r.json();
      return { ok:true, data };
    } catch (e) {
      console.warn('[SupabaseSync] network error', e);
      return { ok:false, error:e };
    }
  }

  // Paginated GET: bypasses Supabase's 1000-row default cap via Range header.
  // Stops when server returns fewer rows than requested.
  async function _restAll(path, pageSize) {
    pageSize = pageSize || 1000;
    const MAX_PAGES = 50;        // hard safety cap = 50,000 rows
    const all = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * pageSize;
      const to   = from + pageSize - 1;
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
          method: 'GET',
          headers: _headers({
            'Range-Unit': 'items',
            'Range': `${from}-${to}`,
            'Prefer': 'count=none'
          })
        });
        if (!r.ok) {
          console.warn(`[SupabaseSync] paged GET ${path} page ${page} → ${r.status}`);
          break;
        }
        const chunk = await r.json();
        if (!Array.isArray(chunk) || chunk.length === 0) break;
        all.push(...chunk);
        if (chunk.length < pageSize) break;   // last page
      } catch (e) {
        console.warn('[SupabaseSync] paged GET error', e);
        break;
      }
    }
    return { ok:true, data: all };
  }

  // ── Public: always "configured" — no token rotation needed ───────────
  function isConfigured() { return true; }

  function getConfig() {
    return { gist_id: 'supabase', token: 'supabase', backend: 'supabase' };
  }

  function saveConfig() { /* no-op — kept for back-compat */ }

  // ── Cache helpers (kept so existing UI code works) ───────────────────
  function getCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
    catch { return {}; }
  }

  function getCacheAge() {
    const ts = localStorage.getItem(CACHE_TS_KEY);
    return ts ? (Date.now() - parseInt(ts)) / 1000 : 9999;
  }

  function _setCacheBucket(fileKey, obj) {
    const cache = getCache();
    cache[fileKey] = obj;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
    localStorage.setItem(CACHE_TS_KEY, Date.now().toString());
  }

  // ── Low-level pull/push (admin.html + management.html) ───────────────
  // Keeps Gist-style file keys like "claims_Apr26", "flags_Apr26", "kpi_scores"
  async function pull(fileKey) {
    if (!fileKey) return null;

    if (fileKey.startsWith('claims_')) {
      const month = _monthFromSlug(fileKey.replace('claims_',''));
      const r = await _restAll(`claims?select=*&month=eq.${encodeURIComponent(month)}&stage=eq.1`);
      if (!r.ok) return null;
      const out = {};
      (r.data||[]).forEach(row => {
        const k = `${row.agent}_${row.camp_id}_${row.debtor_code}`;
        out[k] = {
          ts     : row.ts,
          remark : row.remark || '',
          bulk   : !!row.bulk,
          status : row.status || 'delivered',
          actor  : row.actor || 'agent'
        };
      });
      _setCacheBucket(fileKey, out);
      return out;
    }

    if (fileKey.startsWith('flags_')) {
      const month = _monthFromSlug(fileKey.replace('flags_',''));
      const r = await _restAll(`flags?select=*&month=eq.${encodeURIComponent(month)}`);
      if (!r.ok) return null;
      const byAgent = {};
      (r.data||[]).forEach(row => {
        if (!byAgent[row.agent]) byAgent[row.agent] = {};
        byAgent[row.agent][row.debtor_code] = {
          reason: row.reason || '',
          ts    : row.ts
        };
      });
      _setCacheBucket(fileKey, byAgent);
      return byAgent;
    }

    if (fileKey === 'kpi_scores') {
      const r = await _restAll(`kpi_scores?select=*`);
      if (!r.ok) return null;
      const byMonth = {};
      (r.data||[]).forEach(row => {
        if (!byMonth[row.month]) byMonth[row.month] = {};
        byMonth[row.month][row.agent] = row.scores || {};
      });
      _setCacheBucket(fileKey, byMonth);
      return byMonth;
    }

    return null;
  }

  async function push(fileKey, data) {
    if (!fileKey) return false;

    if (fileKey.startsWith('claims_')) {
      const month = _monthFromSlug(fileKey.replace('claims_',''));
      const rows = Object.entries(data || {}).map(([compKey, v]) => {
        const parts = compKey.split('_');
        const agent = parts[0];
        const debtorCode = parts[parts.length - 1];
        const campId = parts.slice(1, -1).join('_');
        return {
          month, agent, camp_id: campId, debtor_code: debtorCode,
          status: v.status || 'delivered',
          remark: v.remark || '',
          bulk  : !!v.bulk,
          actor : v.actor || 'agent',
          ts    : v.ts || new Date().toISOString(),
          stage : Number.isFinite(Number(v.stage)) ? Number(v.stage) : 1
        };
      });
      if (!rows.length) return true;
      const r = await _rest('claims?on_conflict=month,agent,camp_id,debtor_code,stage', {
        method: 'POST', headers: { 'Prefer': 'resolution=merge-duplicates' }, body: rows
      });
      _setCacheBucket(fileKey, data);
      return r.ok;
    }

    if (fileKey.startsWith('flags_')) {
      const month = _monthFromSlug(fileKey.replace('flags_',''));
      const rows = [];
      Object.entries(data || {}).forEach(([agent, flagsObj]) => {
        Object.entries(flagsObj || {}).forEach(([debtorCode, v]) => {
          rows.push({
            month, agent, debtor_code: debtorCode,
            reason: (v && v.reason) || '',
            ts    : (v && v.ts) || new Date().toISOString()
          });
        });
      });
      if (!rows.length) return true;
      const r = await _rest('flags?on_conflict=month,agent,debtor_code', {
        method:'POST', headers:{'Prefer':'resolution=merge-duplicates'}, body: rows
      });
      _setCacheBucket(fileKey, data);
      return r.ok;
    }

    if (fileKey === 'kpi_scores') {
      const rows = [];
      Object.entries(data || {}).forEach(([month, agents]) => {
        Object.entries(agents || {}).forEach(([agent, scoresObj]) => {
          rows.push({ month, agent, scores: scoresObj || {}, updated_at: new Date().toISOString() });
        });
      });
      if (!rows.length) return true;
      const r = await _rest('kpi_scores?on_conflict=month,agent', {
        method:'POST', headers:{'Prefer':'resolution=merge-duplicates'}, body: rows
      });
      _setCacheBucket(fileKey, data);
      return r.ok;
    }

    return false;
  }

  // ── Single-claim upsert (sales_dashboard.html main path) ─────────────
  async function saveClaim(month, agent, campId, debtorCode, claimData) {
    const slug  = _slug(month);
    const key   = `${agent}_${campId}_${debtorCode}`;
    const lsKey = `camp_claim_${slug}_${key}`;

    // Fire-and-forget localStorage first (instant UX)
    const payload = { ...claimData, stage: 1 };
    localStorage.setItem(lsKey, JSON.stringify(payload));

    // Upsert to Supabase
    const row = {
      month, agent, camp_id: campId, debtor_code: debtorCode,
      status: claimData.status || 'delivered',
      remark: claimData.remark || '',
      bulk  : !!claimData.bulk,
      actor : claimData.actor || 'agent',
      ts    : claimData.ts || new Date().toISOString(),
      stage : 1
    };
    _rest('claims?on_conflict=month,agent,camp_id,debtor_code,stage', {
      method:'POST', headers:{'Prefer':'resolution=merge-duplicates'}, body:[row]
    }).catch(()=>{});

    // Update cache bucket
    const cache = getCache();
    const fk = `claims_${slug}`;
    if (!cache[fk]) cache[fk] = {};
    cache[fk][key] = payload;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
  }

  async function removeClaim(month, agent, campId, debtorCode) {
    const slug = _slug(month);
    const key  = `${agent}_${campId}_${debtorCode}`;
    localStorage.removeItem(`camp_claim_${slug}_${key}`);

    _rest(`claims?month=eq.${encodeURIComponent(month)}&agent=eq.${encodeURIComponent(agent)}&camp_id=eq.${encodeURIComponent(campId)}&debtor_code=eq.${encodeURIComponent(debtorCode)}&stage=eq.1`, {
      method: 'DELETE'
    }).catch(()=>{});

    const cache = getCache();
    const fk = `claims_${slug}`;
    if (cache[fk]) {
      delete cache[fk][key];
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
    }
  }

  // ── Flags (per-agent bulk write) ─────────────────────────────────────
  async function saveFlags(month, agent, flags) {
    const slug = _slug(month);
    localStorage.setItem(`touro_debtor_flags_${agent}`, JSON.stringify(flags));

    // Replace all flags for this agent+month: delete existing, then insert
    await _rest(`flags?month=eq.${encodeURIComponent(month)}&agent=eq.${encodeURIComponent(agent)}`, { method:'DELETE' });

    const rows = Object.entries(flags || {}).map(([debtorCode, v]) => ({
      month, agent, debtor_code: debtorCode,
      reason: (v && v.reason) || '',
      ts    : (v && v.ts) || new Date().toISOString()
    }));
    if (rows.length) {
      await _rest('flags', { method:'POST', body: rows });
    }

    const cache = getCache();
    const fk = `flags_${slug}`;
    if (!cache[fk]) cache[fk] = {};
    cache[fk][agent] = flags;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
  }

  // ── KPI scores (by month + agent) ────────────────────────────────────
  async function saveKPIScores(month, scores) {
    const slug = _slug(month);
    localStorage.setItem(`md_scores_${slug}`, JSON.stringify(scores));

    // scores can be either { AGENT: {...}, AGENT2: {...}, ... } (multi-agent)
    // or { scoreKey: value, ... } (single agent — accounts.html pattern)
    // Detect shape: if values are objects, it's multi-agent; otherwise single.
    const entries = Object.entries(scores || {});
    const isMultiAgent = entries.length > 0 &&
                         entries.every(([, v]) => v && typeof v === 'object' && !Array.isArray(v));

    let rows;
    if (isMultiAgent) {
      rows = entries.map(([agent, s]) => ({
        month, agent, scores: s || {}, updated_at: new Date().toISOString()
      }));
    } else {
      // Single-agent shape — caller didn't wrap by agent.
      // This path shouldn't trigger in current code; log for visibility.
      console.warn('[SupabaseSync] saveKPIScores called with non-multi-agent shape; skipping upsert', scores);
      rows = [];
    }

    if (rows.length) {
      const r = await _rest('kpi_scores?on_conflict=month,agent', {
        method:'POST', headers:{'Prefer':'resolution=merge-duplicates'}, body: rows
      });
      if (r.ok) console.log(`[SupabaseSync] KPI scores for ${month} saved ✓`);
    }

    const cache = getCache();
    if (!cache.kpi_scores) cache.kpi_scores = {};
    cache.kpi_scores[month] = scores;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
  }

  // ── Bulk sync from Supabase → localStorage (called on page load) ─────
  async function syncToLocal(month, opts) {
    opts = opts || {};
    const slug = _slug(month);
    if (!slug) return { ok:false, reason:'no_month' };

    try {
      const [claimsRes, flagsRes, kpiRes] = await Promise.all([
        _restAll(`claims?select=*&month=eq.${encodeURIComponent(month)}&stage=eq.1`),
        _restAll(`flags?select=*&month=eq.${encodeURIComponent(month)}`),
        _restAll(`kpi_scores?select=*&month=eq.${encodeURIComponent(month)}`)
      ]);

      if (!claimsRes.ok) return { ok:false, reason:'claims_fetch_failed' };

      // Populate camp_claim_* keys for back-compat readers
      let claimCount = 0;
      const claimsObj = {};
      (claimsRes.data || []).forEach(row => {
        const compKey = `${row.agent}_${row.camp_id}_${row.debtor_code}`;
        const lsKey   = `camp_claim_${slug}_${compKey}`;
        const val = {
          ts     : row.ts,
          remark : row.remark || '',
          bulk   : !!row.bulk,
          status : row.status || 'delivered',
          actor  : row.actor || 'agent'
        };
        localStorage.setItem(lsKey, JSON.stringify(val));
        claimsObj[compKey] = val;
        claimCount++;
      });

      // Flags per agent
      let flagCount = 0;
      const flagsByAgent = {};
      (flagsRes.data || []).forEach(row => {
        if (!flagsByAgent[row.agent]) flagsByAgent[row.agent] = {};
        flagsByAgent[row.agent][row.debtor_code] = {
          reason: row.reason || '',
          ts    : row.ts
        };
      });
      Object.entries(flagsByAgent).forEach(([agent, flags]) => {
        localStorage.setItem(`touro_debtor_flags_${agent}`, JSON.stringify(flags));
        flagCount++;
      });

      // KPI scores
      const kpiByAgent = {};
      (kpiRes.data || []).forEach(row => {
        kpiByAgent[row.agent] = row.scores || {};
      });
      if (Object.keys(kpiByAgent).length) {
        localStorage.setItem(`md_scores_${slug}`, JSON.stringify(kpiByAgent));
      }

      // Refresh shared cache bucket
      const cache = getCache();
      cache[`claims_${slug}`] = claimsObj;
      cache[`flags_${slug}`]  = flagsByAgent;
      if (!cache.kpi_scores) cache.kpi_scores = {};
      cache.kpi_scores[month] = kpiByAgent;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
      localStorage.setItem(CACHE_TS_KEY, Date.now().toString());

      console.log(`[SupabaseSync] Pulled ${claimCount} claims, ${flagCount} agents' flags for ${month}`);
      return { ok:true, claimCount, flagCount };
    } catch (e) {
      console.warn('[SupabaseSync] syncToLocal error', e);
      return { ok:false, reason:'exception', error:e };
    }
  }

  // ── Back-compat: setup/createGist are no-ops now ─────────────────────
  async function setup() { return { ok:true, gist_id:'supabase', backend:'supabase' }; }
  async function createGist() { return { ok:true, gist_id:'supabase', url:SUPABASE_URL }; }

  // ── Realtime subscription (optional, caller opts in) ─────────────────
  // Returns an unsubscribe fn. Requires supabase-js CDN loaded on the page.
  let _realtimeClient = null;
  function subscribeClaims(month, cb) {
    try {
      if (typeof supabase === 'undefined' || !supabase.createClient) {
        console.warn('[SupabaseSync] realtime unavailable: supabase-js not loaded');
        return () => {};
      }
      if (!_realtimeClient) {
        _realtimeClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      }
      const channel = _realtimeClient
        .channel(`claims_${_slug(month)}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'claims', filter: `month=eq.${month}` },
          (payload) => { try { cb(payload); } catch(e){} }
        )
        .subscribe();
      return () => { try { _realtimeClient.removeChannel(channel); } catch(e){} };
    } catch (e) {
      console.warn('[SupabaseSync] subscribeClaims failed', e);
      return () => {};
    }
  }

  // ── Audit log (fire-and-forget) ──────────────────────────────────────
  function logAudit(actor, action, month, details) {
    _rest('audit_log', {
      method:'POST',
      body: [{ actor, action, month: month || null, details: details || {} }]
    }).catch(()=>{});
  }

  // ── Public API (same shape as original GistSync) ─────────────────────
  return {
    isConfigured, getConfig, saveConfig, setup, createGist,
    pull, push,
    saveClaim, removeClaim, saveFlags, saveKPIScores,
    syncToLocal, getCache, getCacheAge,
    subscribeClaims, logAudit,
    _backend: 'supabase'
  };
})();

// Back-compat export
if (typeof module !== 'undefined') module.exports = GistSync;
