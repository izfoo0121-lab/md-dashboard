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

assert(html.includes('Full debtor list'), 'Debtors tab should expose the full debtor list menu item');

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
              address: '1 CANONICAL ROAD',
              account_status: 'account_active',
              account_status_label: 'Active',
              account_active: true,
              status: 'active',
              vip: true,
              birth_date_raw: '2018-06-27 00:00:00',
              birth_day: 27,
              birth_month: 6,
              birthday_this_month: true,
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
              status: 'pending',
              birth_day: 4,
              birth_month: 11,
              birthday_this_month: false,
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
  formatCampaignFocPackage(campaign) {
    if (
      campaign?.converted === false &&
      campaign?.status === 'pending' &&
      campaign?.current_ctn === 0 &&
      campaign?.current_rm === 0
    ) {
      return 'Planning reset: pending / 0 CTN / RM 0';
    }
    return 'FOC: SKNR x 2 packs';
  },
  newSkuKpiEntryCount(debtor) {
    if (debtor.is_future_planning === true) return debtor.new_sku_count;
    return debtor.debtor_code === '300-A001' ? 12 : 0;
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
  extractFunction('exportMonthName'),
  extractFunction('debtorBirthdayExportValue'),
  extractFunction('debtorBirthdayThisMonthExportValue'),
  extractFunction('debtorAccountStatusExportValue'),
  extractFunction('debtorAreaExportValue'),
  extractFunction('futureDebtorPlanningCopy'),
  extractFunction('buildFullDebtorExportRows'),
  extractFunction('debtorExportColumnWidths'),
].join('\n'), context);

const rows = context.buildFullDebtorExportRows('BEN', context.DATA);
const expectedExportKeys = [
  'Agent',
  'Debtor Code',
  'Company Name',
  'Debtor Type',
  'Phone',
  'Area',
  'Account Status',
  'Dashboard Status',
  'VIP',
  'Birthday',
  'Birthday This Month',
  'Current Month CTN',
  'M-1 CTN',
  'M-2 CTN',
  'M-3 CTN',
  'Last Purchase Date',
  'New SKU Count',
  'Active Campaigns',
  'Campaign FOC Package / Notes',
  'Flag Status / Reason',
  'Address',
];
const expectedExportWidths = [10, 14, 36, 18, 16, 14, 18, 18, 5, 12, 12, 14, 10, 10, 10, 16, 12, 30, 36, 20, 42];

assert.strictEqual(rows.length, 2, 'full debtor export should ignore active filters and pagination');
assert.deepStrictEqual(Object.keys(rows[0]), expectedExportKeys, 'debtor export keys and order should remain stable');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.debtorExportColumnWidths())).map(column => column.wch),
  expectedExportWidths,
  'debtor export should retain the exact 21 workbook widths'
);
assert.deepStrictEqual(
  rows.map(row => row['Debtor Code']),
  ['300-A001', '300-B002'],
  'full debtor export should include only the selected agent debtor list'
);
assert.strictEqual(rows[0]['Agent'], 'BEN');
assert.strictEqual(rows[0]['Company Name'], 'KEDAI A');
assert.strictEqual(rows[0]['Area'], 'GRP 2A');
assert.strictEqual(rows[0]['Account Status'], 'Active');
assert.strictEqual(rows[0]['Birthday'], '27 Jun');
assert.strictEqual(rows[0]['Birthday This Month'], 'Y');
assert.strictEqual(rows[1]['Account Status'], 'pending');
assert.strictEqual(rows[1]['Birthday'], '04 Nov');
assert.strictEqual(rows[1]['Birthday This Month'], '');
assert.strictEqual(rows[0]['Current Month CTN'], 7);
assert.strictEqual(rows[0]['M-1 CTN'], 3);
assert.strictEqual(rows[0]['New SKU Count'], 12, 'full debtor export should use computed New SKU KPI count');
assert.strictEqual(rows[0]['Active Campaigns'], 'SUKUN FOC');
assert.strictEqual(rows[0]['Campaign FOC Package / Notes'], 'FOC: SKNR x 2 packs');
assert.strictEqual(rows[0]['Flag Status / Reason'], 'cant_contact');
assert.strictEqual(
  rows.some(row => row['Company Name'] === 'OTHER AGENT'),
  false,
  'full debtor export should not include other-agent debtor records'
);

const constrainedRows = context.buildFullDebtorExportRows('BEN', context.DATA, [
  { debtor_code: ' 300-b002 ', company_name: 'FORGED B' },
  context.DATA.agents.CJ.debtor_cards.debtors[0],
  { code: '300-A001', company_name: 'FORGED A' },
  { debtor_code: '300-B002' },
  { debtor_code: '300-UNKNOWN' },
]);
assert.deepStrictEqual(
  Array.from(constrainedRows, row => row['Debtor Code']),
  ['300-B002', '300-A001'],
  'filtered override should preserve requested canonical-code order and dedupe matches'
);
assert.deepStrictEqual(
  Array.from(constrainedRows, row => row['Company Name']),
  ['KEDAI B', 'KEDAI A'],
  'filtered override should use canonical selected-agent values instead of override objects'
);
assert.strictEqual(
  constrainedRows.some(row => row['Company Name'] === 'OTHER AGENT'),
  false,
  'filtered override must drop foreign-agent debtor codes'
);

const canonicalFallbackStatusDebtor = {
  ...context.DATA.agents.BEN.debtor_cards.debtors[1],
  debtor_code: '300-D004',
  company_name: 'KEDAI D',
  status: 'reactivation',
};
const futureViewData = {
  ...context.DATA,
  current_month: 'Jul 26',
  planning_base_month: 'Jun 26',
  is_future_view: true,
  agents: {
    ...context.DATA.agents,
    BEN: {
      ...context.DATA.agents.BEN,
      debtor_cards: {
        ...context.DATA.agents.BEN.debtor_cards,
        debtors: [
          ...context.DATA.agents.BEN.debtor_cards.debtors,
          canonicalFallbackStatusDebtor,
        ],
      },
    },
  },
};
const futurePlanningOverride = context.futureDebtorPlanningCopy(
  context.DATA.agents.BEN.debtor_cards.debtors[0],
  { baseMonth: 'Jun 26', targetMonth: 'Jul 26' }
);
const futureFallbackStatusOverride = context.futureDebtorPlanningCopy(
  canonicalFallbackStatusDebtor,
  { baseMonth: 'Jun 26', targetMonth: 'Jul 26' }
);
futurePlanningOverride.debtor_code = ' 300-a001 ';
futurePlanningOverride.company_name = 'FORGED FUTURE NAME';
futurePlanningOverride.debtor_type = 'FORGED TYPE';
futurePlanningOverride.phone = '+609999';
futurePlanningOverride.address = 'FORGED ADDRESS';
const futurePlanningRows = context.buildFullDebtorExportRows(
  'BEN',
  futureViewData,
  [futurePlanningOverride, futureFallbackStatusOverride]
);
assert.deepStrictEqual(
  {
    code: futurePlanningRows[0]?.['Debtor Code'],
    company: futurePlanningRows[0]?.['Company Name'],
    debtorType: futurePlanningRows[0]?.['Debtor Type'],
    phone: futurePlanningRows[0]?.['Phone'],
    address: futurePlanningRows[0]?.['Address'],
    status: futurePlanningRows[0]?.['Dashboard Status'],
    currentCtn: futurePlanningRows[0]?.['Current Month CTN'],
    newSkuCount: futurePlanningRows[0]?.['New SKU Count'],
    campaigns: futurePlanningRows[0]?.['Active Campaigns'],
    campaignNotes: futurePlanningRows[0]?.['Campaign FOC Package / Notes'],
  },
  {
    code: '300-A001',
    company: 'KEDAI A',
    debtorType: 'SH-Shop',
    phone: '+601111',
    address: '1 CANONICAL ROAD',
    status: 'pending',
    currentCtn: 0,
    newSkuCount: 0,
    campaigns: 'SUKUN FOC',
    campaignNotes: 'Planning reset: pending / 0 CTN / RM 0',
  },
  'future-view filtered export should retain canonical identity and planning-copy values'
);
assert.deepStrictEqual(
  {
    accountStatus: futurePlanningRows[1]?.['Account Status'],
    dashboardStatus: futurePlanningRows[1]?.['Dashboard Status'],
  },
  {
    accountStatus: 'reactivation',
    dashboardStatus: 'pending',
  },
  'future-view filtered export should preserve the canonical Account Status fallback while using planning Dashboard Status'
);

const futureFullRows = context.buildFullDebtorExportRows('BEN', futureViewData);
const fullFutureDebtor = futureFullRows.find(row => row['Debtor Code'] === '300-A001');
const filteredFutureDebtor = futurePlanningRows.find(row => row['Debtor Code'] === '300-A001');
const futureParityFields = [
  'Dashboard Status',
  'Current Month CTN',
  'M-1 CTN',
  'M-2 CTN',
  'M-3 CTN',
  'New SKU Count',
  'Active Campaigns',
  'Campaign FOC Package / Notes',
];
assert.deepStrictEqual(
  Object.fromEntries(futureParityFields.map(field => [field, fullFutureDebtor?.[field]])),
  Object.fromEntries(futureParityFields.map(field => [field, filteredFutureDebtor?.[field]])),
  'future-view full and filtered exports should use the same planning-normalized debtor row'
);
assert.deepStrictEqual(
  {
    status: fullFutureDebtor?.['Dashboard Status'],
    currentCtn: fullFutureDebtor?.['Current Month CTN'],
    previous1Ctn: fullFutureDebtor?.['M-1 CTN'],
    previous2Ctn: fullFutureDebtor?.['M-2 CTN'],
    previous3Ctn: fullFutureDebtor?.['M-3 CTN'],
    newSkuCount: fullFutureDebtor?.['New SKU Count'],
    campaignNotes: fullFutureDebtor?.['Campaign FOC Package / Notes'],
  },
  {
    status: 'pending',
    currentCtn: 0,
    previous1Ctn: 7,
    previous2Ctn: 3,
    previous3Ctn: 2,
    newSkuCount: 0,
    campaignNotes: 'Planning reset: pending / 0 CTN / RM 0',
  },
  'future-view full export should not leak the authorized base month current values'
);

const oneMonthPlanning = context.futureDebtorPlanningCopy({
  ctn_cur: 12,
  ctn_prev1: 9,
  ctn_prev2: 6,
  ctn_prev3: 3,
  campaigns: [{
    id: 'campaign-progress',
    converted: true,
    status: 'converted',
    linked_status: 'rp_od_achieved',
    linked_stage1_actual: true,
    linked_stage2_actual: true,
    current_ctn: 5,
    current_paid_ctn: 5,
    current_invoice_ctn: 7,
    current_unpaid_ctn: 2,
    current_rm: 410,
    ctn_this_month: 7,
    progress_ctn: 7,
  }],
}, { baseMonth: 'Jun 26', targetMonth: 'Jul 26' });
assert.deepStrictEqual(
  {
    current: oneMonthPlanning.ctn_cur,
    previous1: oneMonthPlanning.ctn_prev1,
    previous2: oneMonthPlanning.ctn_prev2,
    previous3: oneMonthPlanning.ctn_prev3,
  },
  { current: 0, previous1: 12, previous2: 9, previous3: 6 },
  'one-month planning should shift the authorized base month into M-1'
);
assert.deepStrictEqual(
  {
    converted: oneMonthPlanning.campaigns[0].converted,
    status: oneMonthPlanning.campaigns[0].status,
    linkedStatus: oneMonthPlanning.campaigns[0].linked_status,
    stage1: oneMonthPlanning.campaigns[0].linked_stage1_actual,
    stage2: oneMonthPlanning.campaigns[0].linked_stage2_actual,
    currentCtn: oneMonthPlanning.campaigns[0].current_ctn,
    paidCtn: oneMonthPlanning.campaigns[0].current_paid_ctn,
    invoiceCtn: oneMonthPlanning.campaigns[0].current_invoice_ctn,
    unpaidCtn: oneMonthPlanning.campaigns[0].current_unpaid_ctn,
    currentRm: oneMonthPlanning.campaigns[0].current_rm,
    monthCtn: oneMonthPlanning.campaigns[0].ctn_this_month,
    progressCtn: oneMonthPlanning.campaigns[0].progress_ctn,
  },
  {
    converted: false,
    status: 'pending',
    linkedStatus: 'not_converted',
    stage1: false,
    stage2: false,
    currentCtn: 0,
    paidCtn: 0,
    invoiceCtn: 0,
    unpaidCtn: 0,
    currentRm: 0,
    monthCtn: 0,
    progressCtn: 0,
  },
  'future planning should reset current-month campaign conversion and invoice progress'
);

const threeMonthPlanning = context.futureDebtorPlanningCopy({
  ctn_cur: 12,
  ctn_prev1: 9,
  ctn_prev2: 6,
  ctn_prev3: 3,
}, { baseMonth: 'Jun 26', targetMonth: 'Sep 26' });
assert.deepStrictEqual(
  {
    current: threeMonthPlanning.ctn_cur,
    previous1: threeMonthPlanning.ctn_prev1,
    previous2: threeMonthPlanning.ctn_prev2,
    previous3: threeMonthPlanning.ctn_prev3,
  },
  { current: 0, previous1: 0, previous2: 0, previous3: 12 },
  'multi-month planning should repeatedly shift the rolling window and zero unknown months'
);

const fallbackCalls = [];
const fallbackContext = {
  DATA: context.DATA,
  currentAgent: 'BEN',
  alert(message) {
    fallbackCalls.push(['alert', message]);
  },
  downloadTextFile(filename, content, mimeType) {
    fallbackCalls.push(['downloadTextFile', filename, content, mimeType]);
  },
  getFlag: context.getFlag,
  visibleDebtorCampaigns: context.visibleDebtorCampaigns,
  formatCampaignFocPackage: context.formatCampaignFocPackage,
  newSkuKpiEntryCount: context.newSkuKpiEntryCount,
  getCurrentDebtorExportView() {
    return { agent: 'BEN', month: 'Jun 26', debtors: context.DATA.agents.BEN.debtor_cards.debtors, active: false };
  },
};
vm.createContext(fallbackContext);
vm.runInContext([
  'var DATA = globalThis.DATA;',
  'var currentAgent = globalThis.currentAgent;',
  'var alert = globalThis.alert;',
  'var downloadTextFile = globalThis.downloadTextFile;',
  extractFunction('safeExportText'),
  extractFunction('safeExportFilenamePart'),
  extractFunction('fullDebtorExportCampaigns'),
  extractFunction('campaignNamesForDebtorExport'),
  extractFunction('campaignFocForDebtorExport'),
  extractFunction('numericExportValue'),
  extractFunction('exportMonthName'),
  extractFunction('debtorBirthdayExportValue'),
  extractFunction('debtorBirthdayThisMonthExportValue'),
  extractFunction('debtorAccountStatusExportValue'),
  extractFunction('debtorAreaExportValue'),
  extractFunction('csvExportValue'),
  extractFunction('rowsToCsv'),
  extractFunction('exportRowsAsCsv'),
  extractFunction('exportRowsAsWorkbook'),
  extractFunction('buildFullDebtorExportRows'),
  extractFunction('debtorExportColumnWidths'),
  extractFunction('exportDebtorRows'),
  extractFunction('exportFullDebtorListExcel'),
].join('\n'), fallbackContext);

vm.runInContext('exportFullDebtorListExcel()', fallbackContext);
assert.strictEqual(
  fallbackCalls[0]?.[0],
  'downloadTextFile',
  'full debtor export should fall back to CSV when the XLSX library is unavailable',
);
assert.strictEqual(
  fallbackCalls[0]?.[1],
  'MD_Full_Debtor_List_BEN_Jun_26.csv',
  'CSV fallback should use the same agent/month filename base',
);
assert(
  fallbackCalls[0]?.[2].startsWith('\uFEFFAgent,Debtor Code,Company Name'),
  'CSV fallback should include a UTF-8 BOM and debtor export headers',
);
assert(
  fallbackCalls[0]?.[2].includes('BEN,300-A001,KEDAI A'),
  'CSV fallback should include the selected agent debtor rows',
);
assert.strictEqual(
  fallbackCalls.some(call => call[0] === 'alert'),
  false,
  'missing XLSX should not block agents with an alert-only failure',
);

const xlsxCalls = [];
const worksheet = {};
const workbook = {};
fallbackContext.XLSX = {
  utils: {
    json_to_sheet(workbookRows) {
      xlsxCalls.push(['json_to_sheet', Array.from(workbookRows)]);
      return worksheet;
    },
    book_new() {
      xlsxCalls.push(['book_new']);
      return workbook;
    },
    book_append_sheet(workbookArg, worksheetArg, sheetName) {
      xlsxCalls.push(['book_append_sheet', workbookArg, worksheetArg, sheetName]);
    },
  },
  writeFile(workbookArg, filename) {
    xlsxCalls.push(['writeFile', workbookArg, filename]);
  },
};
const csvDownloadCountBeforeXlsx = fallbackCalls.filter(call => call[0] === 'downloadTextFile').length;
vm.runInContext('exportFullDebtorListExcel()', fallbackContext);
assert.strictEqual(xlsxCalls[0][0], 'json_to_sheet');
assert.strictEqual(xlsxCalls[0][1].length, 2);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(worksheet['!cols'])).map(column => column.wch),
  expectedExportWidths
);
assert.deepStrictEqual(xlsxCalls[2], ['book_append_sheet', workbook, worksheet, 'Full Debtor List']);
assert.deepStrictEqual(xlsxCalls[3], ['writeFile', workbook, 'MD_Full_Debtor_List_BEN_Jun_26.xlsx']);
assert.strictEqual(
  fallbackCalls.filter(call => call[0] === 'downloadTextFile').length,
  csvDownloadCountBeforeXlsx,
  'successful SheetJS export should not invoke the CSV fallback'
);

fallbackContext.getCurrentDebtorExportView = () => null;
const fallbackCallCountBeforeStale = fallbackCalls.length;
vm.runInContext('exportFullDebtorListExcel()', fallbackContext);
assert.strictEqual(
  fallbackCalls.length,
  fallbackCallCountBeforeStale + 1,
  'stale full export should only add one alert call'
);
assert.deepStrictEqual(
  fallbackCalls.at(-1),
  ['alert', 'Debtor list is still loading.'],
  'full export should block while the current agent/month debtor view is stale'
);

console.log('sales_full_debtor_export.test.cjs passed');
