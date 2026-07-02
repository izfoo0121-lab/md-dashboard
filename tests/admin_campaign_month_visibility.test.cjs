const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

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

const context = {
  kpiAdminEscape(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  },
  adminMonthLabelToIso(month) {
    const [mon, yy] = String(month || '').split(' ');
    const idx = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(mon);
    return `${2000 + Number(yy)}-${String(idx + 1).padStart(2, '0')}`;
  },
};

vm.createContext(context);
vm.runInContext([
  extractFunction('campaignArchiveMonthRange'),
  extractFunction('adminIsoToMonthLabel'),
  extractFunction('campaignArchiveIsoDate'),
  extractFunction('campaignArchiveStartDate'),
  extractFunction('campaignArchiveEndDate'),
  extractFunction('campaignOperationalInWorkingMonth'),
  extractFunction('campaignExpiredBeforeWorkingMonth'),
  extractFunction('campaignMonthWindowLabel'),
  extractFunction('campaignActiveOutsideWorkingMonth'),
  extractFunction('filterActiveOutsideWorkingMonth'),
  extractFunction('filterBulkCampaignsForMonth'),
  extractFunction('renderOtherActiveCampaignsPanel'),
].join('\n'), context);

const junCampaign = {
  id: 'camp_jun',
  name: 'SUKUN FOC JUN26',
  active: true,
  type: 'free_sample',
  start_date: '2026-06-02',
  deadline: '2026-06-30',
  debtors: [],
};
const julCampaign = {
  id: 'camp_jul',
  name: 'CLASSMILD SAMPLE [CM7]',
  active: true,
  type: 'free_sample',
  start_date: '2026-07-01',
  deadline: '2026-07-31',
  debtors: [{ code: '300-A' }],
};
const mayExpired = {
  id: 'camp_may',
  name: 'EVO MAY',
  active: true,
  type: 'conversion_simple',
  start_date: '2026-05-01',
  deadline: '2026-05-31',
  debtors: [],
};

assert.strictEqual(context.campaignOperationalInWorkingMonth(julCampaign, 'Jun 26'), false);
assert.strictEqual(context.campaignActiveOutsideWorkingMonth(julCampaign, 'Jun 26'), true);
assert.strictEqual(context.campaignActiveOutsideWorkingMonth(mayExpired, 'Jun 26'), false);

assert.deepStrictEqual(
  context.filterActiveOutsideWorkingMonth([junCampaign, julCampaign, mayExpired], 'Jun 26').map(c => c.id),
  ['camp_jul'],
  'future active campaigns should not be hidden when viewing an earlier working month'
);

assert.deepStrictEqual(
  context.filterActiveOutsideWorkingMonth([junCampaign, julCampaign, mayExpired], 'Jul 26', []).map(c => c.id),
  ['camp_jul'],
  'active campaigns omitted from the main card list should still be surfaced for management'
);

assert.deepStrictEqual(
  context.filterBulkCampaignsForMonth([junCampaign, julCampaign, mayExpired], 'Jun 26').map(c => c.id),
  ['camp_jun'],
  'bulk dropdown for Jun should not list a July campaign'
);

assert.deepStrictEqual(
  context.filterBulkCampaignsForMonth([junCampaign, julCampaign, mayExpired], 'Jul 26').map(c => c.id),
  ['camp_jul'],
  'bulk dropdown for Jul should list the July campaign'
);

const otherHtml = context.renderOtherActiveCampaignsPanel([julCampaign], 'Jun 26', c => `<article>${c.name}</article>`);
assert(otherHtml.includes('Active campaigns in other months'), 'other-month active panel should be visible');
assert(otherHtml.includes('CLASSMILD SAMPLE [CM7]'), 'other-month active panel should render the stranded campaign card');
assert(otherHtml.includes('Jul 26'), 'other-month active panel should show the campaign month window');
assert(otherHtml.includes('Switch to Jul 26'), 'other-month active panel should provide a month switch action');

console.log('admin_campaign_month_visibility.test.cjs passed');
