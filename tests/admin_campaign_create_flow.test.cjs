const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}`);
  assert(start >= 0, `${name} should exist`);
  const fnStart = html.slice(start - 6, start) === 'async ' ? start - 6 : start;
  const bodyStart = html.indexOf('{', html.indexOf(')', start));
  assert(bodyStart >= 0, `${name} should have a function body`);
  let depth = 0;
  for (let i = bodyStart; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(fnStart, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

function monthToIsoDate(label) {
  const [mon, yy] = String(label || '').split(' ');
  const idx = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(mon);
  return `${2000 + Number(yy)}-${String(idx + 1).padStart(2, '0')}-01`;
}

function createElement(value = '') {
  return { value, textContent: '', innerHTML: '', checked: false, style: {} };
}

function createContext(uploadRows) {
  const posts = [];
  const alerts = [];
  const elements = {
    'new-camp-name': createElement('June FOC'),
    'new-camp-type': createElement('free_sample'),
    'new-camp-desc': createElement('Agent claimable campaign'),
    'new-camp-deadline': createElement('2026-06-30'),
    'new-camp-promo': createElement(''),
    'new-camp-min-order': createElement(''),
    'new-camp-foc-item': createElement('SKNR'),
    'new-camp-foc-qty': createElement('2'),
    'new-camp-foc-unit': createElement('packs'),
    'new-camp-foc-note': createElement(''),
    'new-camp-festive': createElement(''),
    'new-camp-file': createElement(''),
    'new-camp-price-floor': createElement(''),
    'new-camp-reward-tiers': createElement(''),
    'camp-file-preview': createElement(''),
    'cat-rules-section': createElement(''),
    'cat-rules-list': createElement(''),
    'save-toast-camp': createElement(''),
  };

  const context = {
    _campFileDebtors: uploadRows,
    CAMPAIGNS_DATA: { campaigns: [] },
    CONFIG: { agents: { BEN: { active: true }, JACKY: { active: true } } },
    posts,
    alerts,
    console,
    window: null,
    MDAdminContext: { monthToIsoDate },
    getAdminWorkingMonth: () => 'Jun 26',
    document: {
      getElementById(id) {
        if (!elements[id]) elements[id] = createElement('');
        return elements[id];
      },
      querySelectorAll() {
        return [];
      },
    },
    alert(msg) { alerts.push(String(msg)); },
    setTimeout() {},
    readKpiNumerators: () => ['count'],
    validateCampaignMechanismBeforeSave: () => true,
    getCatRules: () => ({}),
    readBrandPenetrationAgentGroupMap: () => ({}),
    brandPenetrationDefaultGroup: () => '',
    readCampaignMechanism: () => ({ mechanism_type: 'delivery_gift' }),
    _campRuleToDb: (campaignId, catGroup, rule) => ({ campaign_id: campaignId, cat_group: catGroup, ...rule }),
    _campPostRows: async (table, rows) => { posts.push({ table, rows }); },
    _adminSupabaseFetch: async (table, opts) => {
      posts.push({ table, opts, body: opts.body ? JSON.parse(opts.body) : null });
      return { ok: true };
    },
    _campDeleteCampaign: async id => { posts.push({ table: 'campaigns_delete', id }); },
    saveCampaignsData() {},
    _campNumOrNull(value) {
      if (value === '' || value == null) return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    },
    _campTextOrNull(value) {
      const text = String(value || '').trim();
      return text || null;
    },
    normalizeFocUnit(value) {
      return String(value || '').trim();
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext([
    'var _campFileDebtors = globalThis._campFileDebtors;',
    'var CAMPAIGNS_DATA = globalThis.CAMPAIGNS_DATA;',
    'var CONFIG = globalThis.CONFIG;',
    extractFunction('_campCampaignToDb'),
    extractFunction('_campDebtorToDb'),
    extractFunction('_adminCurrentMonthDate'),
    extractFunction('prepareCampaignDebtorForSave'),
    extractFunction('campaignDebtorCode'),
    extractFunction('validateCampaignDebtorAgents'),
    extractFunction('createCampaign'),
  ].join('\n'), context);
  return context;
}

(async () => {
  const valid = createContext([{ code: '300-A001', name: 'SHOP A', agent: 'ben' }]);
  await valid.createCampaign();
  const campaignPost = valid.posts.find(post => post.table === 'campaigns');
  assert(campaignPost, 'createCampaign should post a campaign row to Supabase');
  assert.strictEqual(
    campaignPost.body.start_date,
    '2026-06-01',
    'Campaigns created from a working month should persist that month start date'
  );
  assert.strictEqual(
    valid.CAMPAIGNS_DATA.campaigns[0].start_date,
    '2026-06-01',
    'Local campaign state should keep the same working-month start date'
  );

  const missingAgent = createContext([{ code: '300-A002', name: 'SHOP B', agent: '' }]);
  await missingAgent.createCampaign();
  assert.strictEqual(missingAgent.posts.length, 0, 'Campaign creation should stop before Supabase when an agent is blank');
  assert(missingAgent.alerts.join('\n').includes('agent'), 'Blank agent validation should explain the agent problem');

  const unknownAgent = createContext([{ code: '300-A003', name: 'SHOP C', agent: 'ZZ' }]);
  await unknownAgent.createCampaign();
  assert.strictEqual(unknownAgent.posts.length, 0, 'Campaign creation should stop before Supabase when an agent is unknown');
  assert(unknownAgent.alerts.join('\n').includes('ZZ'), 'Unknown agent validation should name the bad agent code');

  console.log('admin_campaign_create_flow.test.cjs passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
