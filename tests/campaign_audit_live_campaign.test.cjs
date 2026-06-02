const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'campaign_audit.html'), 'utf8');

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

assert(html.includes('fetchLiveCampaignData'), 'Campaign Audit should fetch live Supabase campaigns');
assert(html.includes('campaign_debtors?select=*'), 'Campaign Audit should read campaign debtor enrollment rows');
assert(html.includes('auditMergeCampaignData'), 'Campaign Audit should merge live campaigns with generated fallback data');

const context = {};
vm.createContext(context);
vm.runInContext([
  extractFunction('auditGroupBy'),
  extractFunction('auditParseCampaignNotes'),
  extractFunction('auditCampaignRuleFromDb'),
  extractFunction('auditCampaignFromDb'),
  extractFunction('auditMergeCampaignData'),
  extractFunction('auditDebtorRecordToCard'),
  extractFunction('auditCampaignEntryFromDebtor'),
].join('\n'), context);

const liveCampaign = context.auditCampaignFromDb(
  {
    id: 'camp_live_iface',
    name: 'IFACE JUN 26 PENETRATION CAMPAIGN',
    type: 'conversion_simple',
    brands: ['IFACE'],
    active: true,
    start_date: '2026-06-02',
    deadline: '2026-06-30',
    notes: { mechanism_type: 'conversion', qualifying_item_group: 'IFACE' },
    default_foc_item: 'SUKUN',
    default_foc_qty: 4,
    default_foc_unit: 'packs',
  },
  {
    camp_live_iface: [
      {
        campaign_id: 'camp_live_iface',
        cat_group: 'A',
        target_pct: 50,
        promo_detail: 'IFACE PEN',
      },
    ],
  },
  {
    camp_live_iface: [
      {
        campaign_id: 'camp_live_iface',
        debtor_code: '300-BR087',
        debtor_name: 'CARIL SHARI',
        agent: 'BEN',
        debtor_type: 'FL-Freelancer',
        foc_item: 'SUKUN',
        foc_qty: 4,
        foc_unit: 'packs',
        notes: 'New account',
      },
    ],
  }
);

assert.strictEqual(liveCampaign.debtors.length, 1, 'Live campaign debtor rows should be attached to the campaign');
assert.strictEqual(liveCampaign.debtors[0].eligibility_reason, 'New account', 'Live debtor notes should be available as eligibility display text');
assert.strictEqual(liveCampaign.cat_rules.A.target_pct, 50, 'Live campaign rules should be grouped by campaign/category');

const generated = {
  campaigns: [
    { id: 'camp_live_iface', name: 'stale generated copy', active: false, debtors: [] },
    { id: 'camp_old', name: 'generated fallback campaign', active: true, debtors: [] },
  ],
};
const merged = context.auditMergeCampaignData(generated, { campaigns: [liveCampaign] });

assert.strictEqual(merged.campaigns.length, 2, 'Live merge should keep generated-only fallback campaigns');
assert.strictEqual(merged.campaigns[0].id, 'camp_live_iface', 'Live campaigns should override stale generated copies');
assert.strictEqual(merged.campaigns[0].active, true, 'Live campaign active state should win over generated fallback');
assert.strictEqual(merged.campaigns[0].debtors.length, 1, 'Merged live campaign should retain debtor enrollment rows');

const debtorCard = context.auditDebtorRecordToCard(liveCampaign.debtors[0]);
const campEntry = context.auditCampaignEntryFromDebtor(liveCampaign, liveCampaign.debtors[0]);
assert.strictEqual(debtorCard.debtor_code, '300-BR087', 'Live campaign debtors should render without generated debtor cards');
assert.strictEqual(debtorCard.company_name, 'CARIL SHARI', 'Live campaign debtor name should render from Supabase row');
assert.strictEqual(campEntry.foc_item, 'SUKUN', 'Live campaign entry should preserve debtor-level FOC package');

console.log('campaign_audit_live_campaign.test.cjs passed');
