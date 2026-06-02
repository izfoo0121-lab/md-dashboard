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

const context = {
  DATA: { current_month: 'Jun 26' },
  console: { warn() {}, log() {} },
};
vm.createContext(context);
vm.runInContext([
  'var DATA = globalThis.DATA;',
  extractFunction('isCampaignActiveInMonth'),
  extractFunction('salesCampaignGroupBy'),
  extractFunction('salesParseCampaignNotes'),
  extractFunction('salesCampaignRuleFromDb'),
  extractFunction('salesCampaignFromDb'),
  extractFunction('salesDebtorRecordToCard'),
  extractFunction('salesCampaignEntryFromDebtor'),
  extractFunction('mergeLiveCampaignsIntoSalesData'),
  extractFunction('isConversionCampaign'),
  extractFunction('isVisibleDebtorCampaign'),
  extractFunction('campaignVisibleForSelectedMonth'),
  extractFunction('visibleDebtorCampaigns'),
].join('\n'), context);

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

context.DATA = data;
vm.runInContext('DATA = globalThis.DATA;', context);
assert.strictEqual(
  context.visibleDebtorCampaigns(benDebtors[0]).map(c => c.id).join(','),
  'camp_sukun_jun26',
  'Live Supabase campaigns should be visible in the selected June month'
);

console.log('sales_live_campaign_bridge.test.cjs passed');
