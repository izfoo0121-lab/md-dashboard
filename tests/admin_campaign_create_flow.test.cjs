const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const engineAdmin = require('../campaign_engine/admin_campaign_adapter.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

function extractFunction(name) {
  const markers = [`function ${name}(`, `async function ${name}(`];
  const starts = markers.map(marker => html.indexOf(marker)).filter(index => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
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
  const engineCalls = [];
  const brandBoxes = [
    { value: 'SUKUN', checked: false },
    { value: 'EVO', checked: false },
  ];
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
    'new-camp-file': createElement('uploaded.csv'),
    'new-camp-price-floor': createElement(''),
    'new-camp-reward-tiers': createElement(''),
    'camp-file-preview': createElement('1 debtor ready'),
    'cat-rules-section': createElement(''),
    'cat-rules-list': createElement(''),
    'save-toast-camp': createElement(''),
  };
  elements['cat-rules-section'].style.display = 'block';

  const context = {
    _campFileDebtors: uploadRows,
    CAMPAIGNS_DATA: { campaigns: [] },
    CONFIG: { agents: { BEN: { active: true }, JACKY: { active: true } } },
    posts,
    alerts,
    engineCalls,
    console,
    window: null,
    MDAdminContext: { monthToIsoDate },
    getAdminWorkingMonth: () => 'Jun 26',
    document: {
      getElementById(id) {
        if (!elements[id]) elements[id] = createElement('');
        return elements[id];
      },
      querySelectorAll(selector) {
        if (selector === '#brand-checkboxes input:checked') return brandBoxes.filter(box => box.checked);
        if (selector === '#brand-checkboxes input') return brandBoxes;
        return [];
      },
    },
    alert(msg) { alerts.push(String(msg)); },
    setTimeout(fn) { if (typeof fn === 'function') fn(); },
    readKpiNumerators: () => ['distribution'],
    getCatRules: () => ({}),
    readBrandPenetrationAgentGroupMap: () => ({}),
    brandPenetrationDefaultGroup: () => 'grp2a',
    readCampaignMechanism: () => ({ mechanism_type: 'delivery_gift' }),
    getMdAdminScopedAgents(agentList, opts = {}) {
      return (agentList || [])
        .filter(agent => opts.includeInactive || context.CONFIG.agents[agent]?.active !== false)
        .filter(agent => opts.includeArchived || !context.CONFIG.agents[agent]?.archived)
        .map(agent => String(agent || '').trim().toUpperCase())
        .filter(Boolean);
    },
    _adminSupabaseFetch: async (table, opts = {}) => {
      posts.push({ table, opts, body: opts.body ? JSON.parse(opts.body) : null });
      return { ok: true };
    },
    saveCampaignsData() {},
    PFMDCampaignEngine: {
      admin: {
        async createCampaignFromAdminForm(ctx) {
          engineCalls.push(ctx);
          return engineAdmin.createCampaignFromAdminForm(ctx);
        },
      },
    },
  };

  context.window = context;
  vm.createContext(context);
  vm.runInContext([
    'var _campFileDebtors = globalThis._campFileDebtors;',
    'var CAMPAIGNS_DATA = globalThis.CAMPAIGNS_DATA;',
    'var CONFIG = globalThis.CONFIG;',
    extractFunction('_adminCurrentMonthDate'),
    extractFunction('prepareCampaignDebtorForSave'),
    extractFunction('buildAdminCampaignEngineContext'),
    extractFunction('createCampaign'),
  ].join('\n'), context);

  return context;
}

function createEditContext(campaign) {
  const patches = [];
  const elements = {
    [`camp-edit-name-${campaign.id}`]: createElement('June FOC edited'),
    [`camp-edit-desc-${campaign.id}`]: createElement('Updated description'),
    [`camp-edit-promo-${campaign.id}`]: createElement('Updated promo'),
    [`camp-edit-deadline-${campaign.id}`]: createElement('2026-06-29'),
  };
  const context = {
    CAMPAIGNS_DATA: { campaigns: [campaign] },
    patches,
    console,
    document: {
      getElementById(id) {
        if (!elements[id]) elements[id] = createElement('');
        return elements[id];
      },
    },
    alert(msg) { throw new Error(`Unexpected alert: ${msg}`); },
    confirm() { throw new Error('Unexpected confirm'); },
    getCampaignNumerators: camp => camp.kpi_numerators || ['distribution'],
    readKpiNumerators: () => ['distribution'],
    readCampaignMechanism: () => ({ mechanism_type: 'delivery_gift' }),
    _campPatchCampaign: async (id, payload) => { patches.push({ id, payload }); },
    saveCampaignsData() {},
    renderCampaignsList() {},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext([
    'var CAMPAIGNS_DATA = globalThis.CAMPAIGNS_DATA;',
    extractFunction('_campFromDb'),
    extractFunction('saveCampEdit'),
  ].join('\n'), context);
  return context;
}

(async () => {
  const valid = createContext([{ code: '300-A001', name: 'SHOP A', agent: 'ben' }]);
  await valid.createCampaign();
  assert.strictEqual(valid.engineCalls.length, 1, 'createCampaign should delegate once to the shared admin engine');
  assert.deepStrictEqual(Array.from(valid.engineCalls[0].defaultTargetGroups), ['grp2a']);

  const campaignPost = valid.posts.find(post => post.table === 'campaigns');
  assert(campaignPost, 'shared engine should post a campaign row to Supabase');
  assert.strictEqual(
    campaignPost.body.start_date,
    '2026-06-01',
    'Campaigns created from a working month should persist that month start date'
  );
  assert.deepStrictEqual(
    campaignPost.body.notes.target_groups,
    ['grp2a'],
    'Campaign Supabase notes should scope the campaign to Group 2A'
  );
  assert.strictEqual(
    valid.CAMPAIGNS_DATA.campaigns[0].start_date,
    '2026-06-01',
    'Local campaign state should keep the same working-month start date'
  );
  assert.deepStrictEqual(
    Array.from(valid.CAMPAIGNS_DATA.campaigns[0].target_groups),
    ['grp2a'],
    'Local campaign state should keep the Group 2A target scope'
  );

  const debtorPost = valid.posts.find(post => post.table === 'campaign_debtors');
  assert(debtorPost, 'shared engine should post campaign debtor rows to Supabase');
  assert.strictEqual(debtorPost.body[0].agent, 'BEN', 'Uploaded debtor agents should be normalized before save');

  const missingAgent = createContext([{ code: '300-A002', name: 'SHOP B', agent: '' }]);
  await missingAgent.createCampaign();
  assert.strictEqual(missingAgent.posts.length, 0, 'Campaign creation should stop before Supabase when an agent is blank');
  assert(missingAgent.alerts.join('\n').includes('no active agent can claim'), 'Blank agent validation should explain the agent problem');

  const unknownAgent = createContext([{ code: '300-A003', name: 'SHOP C', agent: 'ZZ' }]);
  await unknownAgent.createCampaign();
  assert.strictEqual(unknownAgent.posts.length, 0, 'Campaign creation should stop before Supabase when an agent is unknown');
  assert(unknownAgent.alerts.join('\n').includes('300-A003'), 'Unknown agent validation should identify the affected debtor row');

  const edit = createEditContext({
    id: 'camp-edit-scope',
    name: 'June FOC',
    type: 'free_sample',
    description: 'Original description',
    promo_detail: 'Original promo',
    deadline: '2026-06-30',
    kpi_numerators: ['distribution'],
    notes: { mechanism_type: 'delivery_gift', target_groups: ['grp2a'] },
  });
  const loaded = edit._campFromDb(
    { id: 'loaded-camp', name: 'Loaded FOC', type: 'free_sample', notes: { target_groups: ['grp2a'] } },
    {},
    {},
  );
  assert.deepStrictEqual(Array.from(loaded.target_groups), ['grp2a'], 'Loaded campaigns should hydrate target groups from notes');
  const loadedDefault = edit._campFromDb(
    { id: 'loaded-default', name: 'Loaded Default', type: 'free_sample', notes: {} },
    {},
    {},
  );
  assert.deepStrictEqual(Array.from(loadedDefault.target_groups), ['grp2a'], 'Loaded campaigns should default to Group 2A scope');

  await edit.saveCampEdit('camp-edit-scope');
  assert.deepStrictEqual(
    edit.patches[0].payload.notes.target_groups,
    ['grp2a'],
    'Campaign edit PATCH should preserve Group 2A target groups in notes'
  );
  assert.deepStrictEqual(
    Array.from(edit.CAMPAIGNS_DATA.campaigns[0].target_groups),
    ['grp2a'],
    'Campaign edit should keep local target_groups in sync after PATCH'
  );
  assert.deepStrictEqual(
    edit.CAMPAIGNS_DATA.campaigns[0].notes.target_groups,
    ['grp2a'],
    'Campaign edit should keep local notes.target_groups in sync after PATCH'
  );

  console.log('admin_campaign_create_flow.test.cjs passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
