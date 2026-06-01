const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
const start = html.indexOf('function renderCampaignDeliveriesSection');
const end = html.indexOf('async function closeCampaign', start);

assert(start >= 0, 'campaign archive helpers not found');
assert(end > start, 'closeCampaign marker not found after archive helpers');

const context = {
  CAMPAIGN_ARCHIVE_MODE: 'month',
  CAMPAIGN_ARCHIVE_SEARCH: '',
  CAMPAIGN_TYPE_LABELS: {
    free_sample: 'Free Sample',
    foc_sample: 'FOC Sample',
    promotion: 'Brand Promotion',
    other: 'Other',
  },
  CAMPAIGN_TYPE_COLORS: {
    free_sample: '#c8860a',
    foc_sample: '#c8860a',
    promotion: '#1a5c8f',
    other: '#555',
  },
  kpiAdminEscape(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  },
  renderDeliveryMonthOptions() {
    return '<option>May 26</option>';
  },
  renderCampaignMechanismSummary() {
    return '';
  },
  adminMonthLabelToIso(month) {
    const [mon, yy] = String(month || '').split(' ');
    const idx = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(mon);
    return `${2000 + Number(yy)}-${String(idx + 1).padStart(2, '0')}`;
  },
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

const campaigns = [
  { id: 'active', name: 'Active May', type: 'promotion', active: true, start_date: '2026-05-01', deadline: '2026-05-31', debtors: [] },
  { id: 'may', name: 'EVO May FOC', type: 'foc_sample', active: false, start_date: '2026-04-29', deadline: '2026-05-31', brand: 'EVO', debtors: [{ code: '300-A' }] },
  { id: 'apr', name: 'April Only', type: 'free_sample', active: false, start_date: '2026-04-01', deadline: '2026-04-30', debtors: [] },
  { id: 'open', name: 'No Deadline May', type: 'other', active: false, created_at: '2026-05-08T00:00:00Z', debtors: [] },
];

assert.strictEqual(JSON.stringify(context.campaignArchiveMonthRange('May 26')), JSON.stringify({
  start: '2026-05-01',
  end: '2026-05-31',
}));

assert.strictEqual(context.campaignOverlapsWorkingMonth(campaigns[1], 'May 26'), true);
assert.strictEqual(context.campaignOverlapsWorkingMonth(campaigns[2], 'May 26'), false);
assert.strictEqual(context.campaignOverlapsWorkingMonth(campaigns[3], 'May 26'), true);
assert.strictEqual(context.campaignExpiredBeforeWorkingMonth(campaigns[0], 'Jun 26'), true);
assert.strictEqual(context.campaignOperationalInWorkingMonth(campaigns[0], 'Jun 26'), false);
assert.strictEqual(context.campaignOperationalInWorkingMonth(campaigns[0], 'May 26'), true);
assert.strictEqual(context.campaignOperationalInWorkingMonth({
  id: 'open-active',
  name: 'Open Active',
  active: true,
  created_at: '2026-05-01T00:00:00Z',
  debtors: [],
}, 'Jun 26'), true);

const monthFiltered = context.filterClosedCampaignsForArchive(campaigns, 'May 26', 'month', '');
assert.deepStrictEqual(monthFiltered.map(c => c.id), ['open', 'may']);

const searched = context.filterClosedCampaignsForArchive(campaigns, 'May 26', 'all', 'evo');
assert.deepStrictEqual(searched.map(c => c.id), ['may']);

const historyHtml = context.renderCampaignDeliveriesSection(campaigns[1], { readOnly: true });
assert(historyHtml.includes('Delivery history'), 'closed campaigns should relabel deliveries as history');
assert(!historyHtml.includes('Upload delivered list'), 'closed campaigns should not render upload controls');
assert(historyHtml.includes('data-read-only="true"'), 'closed delivery sections should be marked read-only');

const archiveHtml = context.renderCampaignArchiveDrawer(campaigns.filter(c => c.active === false), 'May 26');
assert(archiveHtml.includes('Campaign Archive'), 'archive drawer should be rendered');
assert(archiveHtml.includes('This month'), 'archive drawer should include month quick filter');
assert(archiveHtml.includes('data-archive-deliveries-count'), 'closed card summary should include delivered count placeholder');
assert(archiveHtml.includes('Danger'), 'archive drawer should keep delete in a danger section');
assert(archiveHtml.includes('Delete forever'), 'permanent delete should be available only inside danger details');
assert(html.includes('function campaignExpiredBeforeWorkingMonth'), 'Admin should detect active campaigns that expired before the Working Month');
assert(html.includes('renderExpiredActiveCampaignsPanel'), 'Admin should separate expired active campaigns from the Working Month active list');

console.log('admin_campaign_archive.test.cjs passed');
