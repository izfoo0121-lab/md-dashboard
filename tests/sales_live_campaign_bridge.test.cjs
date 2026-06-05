const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales_dashboard.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}`);
  assert(start >= 0, `${name} should exist`);
  let depth = 0;
  let seenBody = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') {
      depth += 1;
      seenBody = true;
    } else if (ch === '}') {
      depth -= 1;
      if (seenBody && depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

assert(html.includes('fetchLiveCampaignDataForSales'), 'Sales Dashboard should fetch live Supabase campaigns');
assert(html.includes('campaign_debtors?select=*'), 'Sales Dashboard should read live campaign debtor enrollment rows');
assert(html.includes('SalesLiveCampaignSync.apply(DATA)'), 'Sales Dashboard should apply live campaigns before rendering');
assert(html.includes('Campaign claim requests are allowed'), 'Future-view banner should clarify that campaign claims are allowed');
assert(extractFunction('saveCampClaim').includes('allowCampaignClaim'), 'Campaign claim save should be allowed in future planning view');
assert(extractFunction('removeCampClaim').includes('allowCampaignClaim'), 'Campaign claim removal should be allowed in future planning view');
assert(extractFunction('toggleCampClaim').includes('allowCampaignClaim'), 'Campaign claim modal should open in future planning view');

const context = {
  DATA: { current_month: 'Jun 26' },
  console: { warn() {}, log() {} },
};
vm.createContext(context);
vm.runInContext([
  'var DATA = globalThis.DATA;',
  extractFunction('blockFutureViewAction'),
  extractFunction('isCampaignActiveInMonth'),
  extractFunction('monthLabelToIso'),
  extractFunction('isHistoricalMonth'),
  extractFunction('shouldIncludeLiveCampaignForSales'),
  extractFunction('salesCampaignGroupBy'),
  extractFunction('salesParseCampaignNotes'),
  extractFunction('salesCampaignRuleFromDb'),
  extractFunction('salesCampaignFromDb'),
  extractFunction('salesDebtorRecordToCard'),
  extractFunction('salesCampaignEntryFromDebtor'),
  extractFunction('mergeSalesCampaignEntry'),
  extractFunction('mergeLiveCampaignsIntoSalesData'),
  extractFunction('isConversionCampaign'),
  extractFunction('isVisibleDebtorCampaign'),
  extractFunction('campaignVisibleForSelectedMonth'),
  extractFunction('visibleDebtorCampaigns'),
].join('\n'), context);

context.DATA.is_future_view = true;
let blockedAlert = '';
context.alert = msg => { blockedAlert = msg; };
assert.strictEqual(context.blockFutureViewAction(), true, 'Future view should still block sales-only actions');
assert(blockedAlert.includes('actions disabled'), 'Default future-view block should explain sales-only lock');
blockedAlert = '';
assert.strictEqual(context.blockFutureViewAction({ allowCampaignClaim: true }), false, 'Future view should allow campaign claim actions');
assert.strictEqual(blockedAlert, '', 'Allowed campaign claims should not show the future-view block alert');
context.DATA.is_future_view = false;

const liveCampaign = context.salesCampaignFromDb(
  {
    id: 'camp_sukun_jun26',
    name: 'SUKUN FOC JUN26',
    type: 'free_sample',
    active: true,
    start_date: '2026-06-02',
    deadline: '2026-06-30',
    default_foc_item: 'SUKUN',
    default_foc_qty: 4,
    default_foc_unit: 'packs',
    notes: { mechanism_type: 'delivery_gift' },
  },
  {},
  {
    camp_sukun_jun26: [
      {
        campaign_id: 'camp_sukun_jun26',
        debtor_code: '300-BR004',
        debtor_name: 'KEDAI RUNCIT TOK NGULU NASIR',
        agent: 'BEN',
        debtor_type: 'SH-Shop',
        foc_item: 'SKNR',
        foc_qty: 2,
        foc_unit: 'packs',
        foc_item_2: 'SKNW',
        foc_qty_2: 2,
        foc_unit_2: 'packs',
        notes: '派4包FOC',
      },
    ],
  }
);

assert.strictEqual(
  context.isCampaignActiveInMonth(liveCampaign, 'May 26'),
  false,
  'June live campaign should not appear when May is selected'
);
assert.strictEqual(
  context.isCampaignActiveInMonth(liveCampaign, 'Jun 26'),
  true,
  'June live campaign should appear when June is selected'
);

const mayData = {
  current_month: 'May 26',
  agents: {
    BEN: { debtor_cards: { debtors: [] } },
  },
};
assert.strictEqual(
  context.mergeLiveCampaignsIntoSalesData(mayData, { campaigns: [liveCampaign] }),
  0,
  'Live June campaign should not attach debtor rows to a May snapshot'
);
assert.strictEqual(mayData.agents.BEN.debtor_cards.debtors.length, 0);

const closedMayCampaign = context.salesCampaignFromDb(
  {
    id: 'camp_evo_may26',
    name: 'EVO MAY 2026 — Conversion',
    type: 'conversion_tiered',
    active: false,
    created_at: '2026-05-03T01:54:53.126751+00:00',
    deadline: '2026-05-31',
  },
  {},
  {
    camp_evo_may26: [
      {
        campaign_id: 'camp_evo_may26',
        debtor_code: '300-KT209',
        debtor_name: 'EDDY KAMPUNG BRING',
        agent: 'JACKY',
        debtor_type: 'SH-Shop',
      },
    ],
  }
);
const historicalMayData = {
  current_month: 'May 26',
  agents: {
    JACKY: { debtor_cards: { debtors: [] } },
  },
};
assert.strictEqual(
  context.mergeLiveCampaignsIntoSalesData(historicalMayData, { campaigns: [closedMayCampaign] }),
  1,
  'Closed live campaigns should still attach when viewing their historical month'
);
assert.strictEqual(
  historicalMayData.agents.JACKY.debtor_cards.debtors[0].campaigns[0].name,
  'EVO MAY 2026 — Conversion'
);
context.DATA = historicalMayData;
vm.runInContext('DATA = globalThis.DATA;', context);
assert.strictEqual(
  context.visibleDebtorCampaigns(historicalMayData.agents.JACKY.debtor_cards.debtors[0]).map(c => c.name).join(','),
  'EVO MAY 2026 — Conversion',
  'Closed historical campaigns should remain visible when viewing that past month'
);

const malformedAgentCampaign = context.salesCampaignFromDb(
  {
    id: 'camp_bad_agent',
    name: 'Bad Agent Row',
    type: 'free_sample',
    active: true,
    created_at: '2026-05-03T01:54:53.126751+00:00',
    deadline: '2026-05-31',
  },
  {},
  {
    camp_bad_agent: [
      {
        campaign_id: 'camp_bad_agent',
        debtor_code: '300-C516',
        debtor_name: 'KEDAI MAKANAN',
        agent: 'MINUMAN DAN RUNCIT YA SRI BLAU STORE-POKYA',
        debtor_type: 'SH-Shop',
      },
    ],
  }
);
const knownAgentData = {
  current_month: 'May 26',
  agents: {
    KW: { debtor_cards: { debtors: [] } },
  },
};
assert.strictEqual(
  context.mergeLiveCampaignsIntoSalesData(knownAgentData, { campaigns: [malformedAgentCampaign] }),
  0,
  'Malformed campaign debtor agent values should not create fake agents'
);
assert.strictEqual(knownAgentData.agents['MINUMAN DAN RUNCIT YA SRI BLAU STORE-POKYA'], undefined);

const data = {
  current_month: 'Jun 26',
  is_future_view: true,
  agents: {
    BEN: { debtor_cards: { debtors: [] } },
  },
};

const applied = context.mergeLiveCampaignsIntoSalesData(data, { campaigns: [liveCampaign] });
assert.strictEqual(applied, 1, 'One live campaign debtor should be attached to Sales data');

const benDebtors = data.agents.BEN.debtor_cards.debtors;
assert.strictEqual(benDebtors.length, 1, 'Live campaign debtor should render even when generated debtor card is missing');
assert.strictEqual(benDebtors[0].debtor_code, '300-BR004');
assert.strictEqual(benDebtors[0].company_name, 'KEDAI RUNCIT TOK NGULU NASIR');
assert.strictEqual(benDebtors[0].status, 'pending');
assert.strictEqual(benDebtors[0].campaigns.length, 1);
assert.strictEqual(benDebtors[0].campaigns[0].foc_item, 'SKNR');
assert.strictEqual(benDebtors[0].campaigns[0].foc_item_2, 'SKNW');

const staleGenerated = {
  current_month: 'Jun 26',
  agents: {
    JAMES: {
      debtor_cards: {
        debtors: [
          {
            debtor_code: '300-J025',
            company_name: 'PANTAI LANJUT KAK JAK',
            status: 'pending',
            campaigns: [
              { id: 'camp_sukun_sample_jun26', name: 'SUKUN SAMPLE JUN26', type: 'free_sample', deadline: '2026-06-30' },
              {
                id: 'camp_1780407172845',
                name: 'SUKUN FOC JUN26',
                type: 'free_sample',
                deadline: '2026-06-30',
                foc_item: 'SKNR',
                foc_qty: 2,
                foc_unit: 'packs',
                foc_item_2: 'SKNW',
                foc_qty_2: 2,
                foc_unit_2: 'packs',
                foc_package: 'SKNR x 2 packs + SKNW x 2 packs',
              },
            ],
          },
        ],
      },
    },
  },
};
const liveWithClosed = {
  campaigns: [
    {
      id: 'camp_sukun_sample_jun26',
      name: 'SUKUN SAMPLE JUN26',
      type: 'free_sample',
      active: false,
      deadline: '2026-06-30',
      debtors: [{ debtor_code: '300-J025', debtor_name: 'PANTAI LANJUT KAK JAK', agent: 'JAMES' }],
    },
    {
      ...liveCampaign,
      id: 'camp_1780407172845',
      name: 'SUKUN FOC JUN26',
      active: true,
      debtors: [{
        debtor_code: '300-J025',
        debtor_name: 'PANTAI LANJUT KAK JAK',
        agent: 'JAMES',
        foc_item: 'SKNR',
        foc_qty: 2,
        foc_unit: 'ctn',
        foc_item_2: 'SKNW',
        foc_qty_2: 2,
        foc_unit_2: 'ctn',
      }],
    },
  ],
};
context.mergeLiveCampaignsIntoSalesData(staleGenerated, liveWithClosed);
assert.strictEqual(
  staleGenerated.agents.JAMES.debtor_cards.debtors[0].campaigns.map(c => c.name).join(','),
  'SUKUN FOC JUN26',
  'Closed Supabase campaigns should be stripped from stale generated Sales debtor cards'
);
assert.strictEqual(
  staleGenerated.agents.JAMES.debtor_cards.debtors[0].campaigns[0].foc_unit,
  'ctn',
  'Live Supabase FOC package edits should override stale generated package units'
);
assert.strictEqual(
  staleGenerated.agents.JAMES.debtor_cards.debtors[0].campaigns[0].foc_unit_2,
  'ctn',
  'Live Supabase second FOC package unit should override stale generated package units'
);
assert.strictEqual(
  staleGenerated.agents.JAMES.debtor_cards.debtors[0].campaigns[0].foc_package,
  '',
  'Live Supabase FOC package edits should clear stale generated package display strings'
);

context.DATA = data;
vm.runInContext('DATA = globalThis.DATA;', context);
assert.strictEqual(
  context.visibleDebtorCampaigns(benDebtors[0]).map(c => c.id).join(','),
  'camp_sukun_jun26',
  'Live Supabase campaigns should be visible in the selected June month'
);

console.log('sales_live_campaign_bridge.test.cjs passed');
