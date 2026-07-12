const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}`);
  assert(start >= 0, `${name} should exist`);
  const bodyStart = html.indexOf('{', html.indexOf(')', start));
  assert(bodyStart >= 0, `${name} should have a function body`);
  let depth = 0;
  for (let i = bodyStart; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

function extractBlock(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  assert(start >= 0, `${startMarker} should exist`);
  const end = html.indexOf(endMarker, start);
  assert(end > start, `${endMarker} should appear after ${startMarker}`);
  return html.slice(start, end);
}

assert(html.includes('Download Row Template'), 'Admin should expose a human-friendly row target template');
assert(html.includes('Download System Template'), 'Admin should keep the existing system target template');
assert(html.includes('function downloadTargetsRowTemplate'), 'Admin should implement row template export');
assert(html.includes('function parseTargetsWideCsv'), 'Admin should parse one-agent-per-row target CSV');

const context = { console };
vm.createContext(context);
vm.runInContext(`
var CONFIG = {
  agents: {
    BEN: {
      active: true,
      is_newbie: false,
      sales_progression: { normal_t1: 100, normal_t2: 200, ga: null, ma: null },
      brand_commission: { iFACE: { penetration_target: 4, ctn_target: 85 } },
      kpi_targets: { vip_count: 10 },
      campaign_targets: {},
      newbie_tiers: [{ threshold: 0, reward: 0 }, { threshold: 0, reward: 0 }, { threshold: 0, reward: 0 }],
      newbie_account_tiers: [{ count: 0, reward: 0 }, { count: 0, reward: 0 }, { count: 0, reward: 0 }],
    },
    CJ: {
      active: true,
      is_newbie: false,
      sales_progression: { normal_t1: 222, normal_t2: 333, ga: null, ma: null },
      brand_commission: { iFACE: { penetration_target: 2, ctn_target: 50 } },
      kpi_targets: {},
      campaign_targets: {},
    },
    KEAN: {
      active: true,
      archived: true,
      default_group: 'grp2a',
      sales_progression: { normal_t1: 999 },
      brand_commission: {},
      kpi_targets: {},
      campaign_targets: {},
    },
    OLD: {
      active: false,
      default_group: 'grp2a',
      sales_progression: { normal_t1: 888 },
      brand_commission: {},
      kpi_targets: {},
      campaign_targets: {},
    },
  },
};
var LAST_TARGETS_IMPORT = null;
var DASH_DATA = {};
const DEFAULT_BRAND_CONFIG = {
  iFACE: ['IFACE B','IFACE M','IFACE R','IFACE DB'],
  SUKUN: ['SKNR','SKNW'],
  CMP: ['CMP'],
  EVO: ['EVO'],
  BISON: ['BISON-G','BISON-R','BISON-M'],
  TR20: ['TR20'],
  'LAM+LWM': ['LAM','LWM'],
};
const DEFAULT_BRANDS = Object.keys(DEFAULT_BRAND_CONFIG);
const DEFAULT_PENETRATION_AUTO_BRANDS = ['iFACE','CMP','BISON','TR20'];
const DEFAULT_ZLB_BRANDS = ['SUKUN','EVO','BISON','LAM+LWM'];
const ADMIN_ZLB_EXCLUDED_BRANDS = new Set(['CMP']);
const BULK_TARGET_KPI_KEYS = ['new_accounts','vip_count','reactivation','new_sku','activation_rate','event'];
const AGENTS = ['BEN','CJ'];
${extractBlock('const MD_ADMIN_GROUP', 'const BRAND_PEN_GROUP_MAP_KEY')}
function getBulkImportMonth() { return 'Jun 26'; }
function getBulkImportCampaignKeys() { return [{ key: 'camp_iface_count', legacyKey: 'iface', label: 'IFACE count' }]; }
function getCampaignMetricValue(obj, metricKey) { return obj ? obj[metricKey] : undefined; }
function parseCampaignImportKey(fieldKey) {
  return String(fieldKey || '').startsWith('camp_')
    ? { key: fieldKey, campaignKey: fieldKey.replace(/^camp_/, '').replace(/_count$/, ''), legacy: false }
    : null;
}
var renderNewbieFormsCount = 0;
function updateRawJSON() {}
function renderAgentForms() {}
function renderNewbieForms() { renderNewbieFormsCount += 1; }
function updateKPITotal() {}
var document = { getElementById: () => null };
var alert = (msg) => { throw new Error(msg); };
${extractFunction('parseCsvLine')}
${extractFunction('detectTargetsImportDelimiter')}
${extractFunction('normalizeImportAgent')}
${extractFunction('getTargetsImportPath')}
${extractFunction('getTargetsImportCurrent')}
${extractFunction('ensureTargetTierArray')}
${extractFunction('bulkTargetBrandSlug')}
${extractFunction('adminBrandKey')}
${extractFunction('adminBrandListFromValue')}
${extractFunction('adminBrandSortKey')}
${extractFunction('adminSortBrandKeys')}
${extractFunction('adminConfiguredBrandList')}
${extractFunction('adminIsZlbExcludedBrand')}
${extractFunction('adminConfiguredZlbBrands')}
${extractFunction('adminBrandKeys')}
${extractFunction('normalizeTargetsWideHeader')}
${extractFunction('getBulkTargetWideColumns')}
${extractFunction('getBulkTargetWideColumnMap')}
${extractFunction('isTargetsWideCsvHeader')}
${extractFunction('getBulkTargetWideValue')}
${extractFunction('getBulkTargetTemplateAgents')}
${extractFunction('normalizeWideTargetValue')}
${extractFunction('parseTargetsWideCsv')}
${extractFunction('parseTargetsCsv')}
${extractFunction('setNewbie')}
${extractFunction('applyTargetsImport')}
`, context);

assert.strictEqual(
  JSON.stringify(context.getBulkTargetTemplateAgents()),
  JSON.stringify(['BEN', 'CJ']),
  'Row/System target templates should exclude archived and inactive agents'
);

const wideHeaders = context.getBulkTargetWideColumns('Jun 26').map(col => col.header);
assert(wideHeaders.includes('normal_t1'), 'Row template should include Normal T1 target');
assert(wideHeaders.includes('iface_pen_target'), 'Row template should include iFACE penetration target');
assert(wideHeaders.includes('iface_ctn_target'), 'Row template should include iFACE CTN target');
assert(wideHeaders.includes('kpi_vip_count'), 'Row template should include KPI VIP target');
assert(wideHeaders.includes('campaign_camp_iface_count'), 'Row template should include active campaign targets');
assert(wideHeaders.includes('newbie_ctn_t1_threshold'), 'Row template should include newbie CTN tiers');
assert(wideHeaders.includes('newbie_acc_t1_count'), 'Row template should include newbie account tiers');

const csv = [
  'agent,active,is_newbie,normal_t1,iface_pen_target,iface_ctn_target,kpi_vip_count,kpi_event,campaign_camp_iface_count,newbie_ctn_t1_threshold,newbie_ctn_t1_reward,newbie_acc_t1_count,newbie_acc_t1_reward',
  'BEN,1,0,930,5,80,12,16,7,1000,1200,2,400',
  'CJ,,Y,,4,,3,,,,,,',
].join('\n');

const parsed = context.parseTargetsCsv(csv);
assert.strictEqual(parsed.mode, 'row', 'Wide CSV should be detected as row template mode');
assert.strictEqual(parsed.valid, true, `Wide CSV should validate cleanly: ${parsed.errors.join('; ')}`);
assert.strictEqual(parsed.applyCount, 15, 'Only nonblank row-template cells should apply');
assert(parsed.warnings.some(w => w.includes('blank cells are ignored')), 'Validation should explain blank-cell behavior');

const tsv = [
  'agent\tactive\tis_newbie\tnormal_t1\tiface_pen_target\tiface_ctn_target\tkpi_vip_count\tkpi_event\tcampaign_camp_iface_count',
  'BEN\t1\t0\t930\t5\t80\t12\t16\t7',
  'CJ\t\tY\t\t4\t\t3\t\t',
].join('\n');
const parsedExcelPaste = context.parseTargetsCsv(tsv);
assert.strictEqual(parsedExcelPaste.mode, 'row', 'Excel tab-separated paste should be detected as row template mode');
assert.strictEqual(parsedExcelPaste.valid, true, `Excel paste should validate cleanly: ${parsedExcelPaste.errors.join('; ')}`);
assert.strictEqual(parsedExcelPaste.applyCount, 11, 'Excel tab-separated paste should apply nonblank cells');
assert(parsedExcelPaste.rows.some(r => r.agent === 'BEN' && r.field_type === 'sales_prog' && r.field_key === 'normal_t1' && r.value === 930), 'Excel paste should parse normal_t1');
assert(parsedExcelPaste.rows.some(r => r.agent === 'CJ' && r.field_type === 'flag' && r.field_key === 'is_newbie' && r.value === 1), 'Excel paste should parse Y flag values');

context.LAST_TARGETS_IMPORT = parsed;
context.applyTargetsImport();

assert.strictEqual(
  context.renderNewbieFormsCount,
  1,
  'Applying imported newbie flags or tier values should refresh the Newbie Scheme tab'
);

assert.strictEqual(context.CONFIG.agents.BEN.active, true, 'Active flag should apply');
assert.strictEqual(context.CONFIG.agents.BEN.is_newbie, false, 'Newbie flag should apply');
assert.strictEqual(context.CONFIG.agents.BEN.sales_progression.normal_t1, 930, 'Sales target should apply');
assert.strictEqual(context.CONFIG.agents.BEN.brand_commission.iFACE.penetration_target, 5, 'Brand penetration target should apply');
assert.strictEqual(context.CONFIG.agents.BEN.brand_commission.iFACE.ctn_target, 80, 'Brand CTN target should apply');
assert.strictEqual(context.CONFIG.agents.BEN.kpi_targets.vip_count, 12, 'KPI target should apply');
assert.strictEqual(context.CONFIG.agents.BEN.kpi_targets.event, 16, 'Event KPI target should apply');
assert.strictEqual(context.CONFIG.agents.BEN.campaign_targets.camp_iface_count, 7, 'Campaign target should apply');
assert.strictEqual(context.CONFIG.agents.BEN.newbie_tiers[0].threshold, 1000, 'Newbie CTN threshold should apply');
assert.strictEqual(context.CONFIG.agents.BEN.newbie_tiers[0].reward, 1200, 'Newbie CTN reward should apply');
assert.strictEqual(context.CONFIG.agents.BEN.newbie_account_tiers[0].count, 2, 'Newbie account threshold should apply');
assert.strictEqual(context.CONFIG.agents.BEN.newbie_account_tiers[0].reward, 400, 'Newbie account reward should apply');

assert.strictEqual(context.CONFIG.agents.CJ.is_newbie, true, 'Y should be accepted for row-template flags');
assert.strictEqual(context.CONFIG.agents.CJ.sales_progression.normal_t1, 222, 'Blank wide cells should not clear existing targets');
assert.strictEqual(context.CONFIG.agents.CJ.brand_commission.iFACE.penetration_target, 4, 'Nonblank wide cells should apply');
assert.strictEqual(context.CONFIG.agents.CJ.brand_commission.iFACE.ctn_target, 50, 'Blank brand cells should keep existing values');
assert.strictEqual(context.CONFIG.agents.CJ.kpi_targets.vip_count, 3, 'Nonblank KPI cells should apply');

context.setNewbie('BEN', true);
assert.strictEqual(context.CONFIG.agents.BEN.is_newbie, true, 'setNewbie should update the agent flag');
assert.strictEqual(
  context.renderNewbieFormsCount,
  2,
  'Toggling newbie from Agent Targets should refresh the Newbie Scheme tab'
);

console.log('admin_targets_wide_import.test.cjs passed');
