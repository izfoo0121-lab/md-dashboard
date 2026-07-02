const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales_dashboard.html'), 'utf8');

function extractGistSync() {
  const marker = 'const GistSync = (() => {';
  const start = html.indexOf(marker);
  assert(start >= 0, 'GistSync should exist');
  const bodyStart = html.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const end = html.indexOf('})();', i);
        assert(end >= 0, 'GistSync IIFE should close');
        return html.slice(start, end + '})();'.length);
      }
    }
  }
  throw new Error('Could not extract GistSync');
}

const store = {};
const fetchCalls = [];
const context = {
  DATA: { is_future_view: true },
  console: { warn() {}, log() {}, error() {} },
  localStorage: {
    getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: key => { delete store[key]; },
  },
  blockFutureViewAction(opts = {}) {
    return !!(context.DATA.is_future_view && !opts.allowCampaignClaim);
  },
  fetch: async (url, opts = {}) => {
    fetchCalls.push({
      url,
      method: opts.method || 'GET',
      body: opts.body ? JSON.parse(opts.body) : null,
    });
    return {
      ok: true,
      status: opts.method === 'DELETE' ? 204 : 201,
      text: async () => '',
      json: async () => [],
    };
  },
};

vm.createContext(context);
vm.runInContext(`${extractGistSync()}\nglobalThis.GistSync = GistSync;`, context);

(async () => {
  await context.GistSync.saveClaim(
    'Aug 26',
    'BEN',
    'camp_future',
    '300-A001',
    { status: 'submitted', actor: 'agent', ts: '2026-08-03T00:00:00.000Z' },
    1
  );
  const upsert = fetchCalls.find(call => call.method === 'POST' && call.url.includes('/claims?on_conflict='));
  assert(upsert, 'Future-view campaign claim save should still upsert to Supabase');
  assert.strictEqual(upsert.body[0].agent, 'BEN');
  assert.strictEqual(upsert.body[0].camp_id, 'camp_future');
  assert.strictEqual(upsert.body[0].stage, 1);

  await context.GistSync.removeClaim('Aug 26', 'BEN', 'camp_future', '300-A001', 1);
  const removal = fetchCalls.find(call => call.method === 'DELETE' && call.url.includes('/claims?month=eq.Aug%2026'));
  assert(removal, 'Future-view campaign claim removal should still delete from Supabase');

  console.log('sales_future_claim_sync.test.cjs passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
