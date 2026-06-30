const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales_dashboard.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}`);
  assert(start >= 0, `${name} should exist`);
  const bodyStart = html.indexOf('{', html.indexOf(')', start));
  assert(bodyStart >= 0, `${name} should have a function body`);
  let depth = 0;
  for (let i = bodyStart; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

assert(
  html.includes('Download Full Debtor List'),
  'Debtors tab should expose a full debtor list download button'
);

const context = {
  DATA: {
    current_month: 'Jun 26',
    agents: {
      BEN: {
        debtor_cards: {
          debtors: [
            {
              debtor_code: '300-A001',
              company_name: 'KEDAI A',
              debtor_type: 'SH-Shop',
              phone: '+601111',
              area: 'GRP 2A',
              account_status: 'account_active',
              status: 'active',
              vip: true,
              birthday: true,
              ctn_cur: 7,
              ctn_prev1: 3,
              ctn_prev2: 2,
              ctn_prev3: 1,
              last_purchase_date: '2026-06-20',
              new_sku_count: 2,
              campaigns: [{ id: 'camp1', name: 'SUKUN FOC', foc_item: 'SKNR' }],
            },
            {
              debtor_code: '300-B002',
              company_name: 'KEDAI B',
              debtor_type: 'FL-Freelancer',
              phone: '+602222',
              account_status: 'account_inactive',
              status: 'pending',
              ctn_cur: 0,
              ctn_prev1: 0,
              ctn_prev2: 0,
              ctn_prev3: 0,
              campaigns: [],
            },
          ],
        },
      },
      CJ: {
        debtor_cards: {
          debtors: [
            { debtor_code: '300-C003', company_name: 'OTHER AGENT', ctn_cur: 99 },
          ],
        },
      },
    },
  },
  currentAgent: 'BEN',
  filters: { special: 'unpurchased', type: 'SH-Shop' },
  currentPage: 5,
  getFlag(agent, debtorCode) {
    return agent === 'BEN' && debtorCode === '300-A001'
      ? { reason: 'cant_contact' }
      : null;
  },
  visibleDebtorCampaigns(debtor) {
    return debtor.campaigns || [];
  },
  formatCampaignFocPackage() {
    return 'FOC: SKNR x 2 packs';
  },
};
vm.createContext(context);
vm.runInContext([
  'var DATA = globalThis.DATA;',
  'var currentAgent = globalThis.currentAgent;',
  'var filters = globalThis.filters;',
  'var currentPage = globalThis.currentPage;',
  extractFunction('safeExportText'),
  extractFunction('fullDebtorExportCampaigns'),
  extractFunction('campaignNamesForDebtorExport'),
  extractFunction('campaignFocForDebtorExport'),
  extractFunction('numericExportValue'),
  extractFunction('buildFullDebtorExportRows'),
].join('\n'), context);

const rows = context.buildFullDebtorExportRows('BEN', context.DATA);

assert.strictEqual(rows.length, 2, 'full debtor export should ignore active filters and pagination');
assert.deepStrictEqual(
  rows.map(row => row['Debtor Code']),
  ['300-A001', '300-B002'],
  'full debtor export should include only the selected agent debtor list'
);
assert.strictEqual(rows[0]['Agent'], 'BEN');
assert.strictEqual(rows[0]['Company Name'], 'KEDAI A');
assert.strictEqual(rows[0]['Current Month CTN'], 7);
assert.strictEqual(rows[0]['M-1 CTN'], 3);
assert.strictEqual(rows[0]['Active Campaigns'], 'SUKUN FOC');
assert.strictEqual(rows[0]['Campaign FOC Package / Notes'], 'FOC: SKNR x 2 packs');
assert.strictEqual(rows[0]['Flag Status / Reason'], 'cant_contact');
assert.strictEqual(
  rows.some(row => row['Company Name'] === 'OTHER AGENT'),
  false,
  'full debtor export should not include other-agent debtor records'
);

console.log('sales_full_debtor_export.test.cjs passed');
