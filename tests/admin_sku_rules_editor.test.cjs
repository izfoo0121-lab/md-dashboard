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
    if (ch === '{') depth += 1;
    if (ch === '}') {
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

function makeElement(id) {
  return {
    id,
    innerHTML: '',
    value: '',
    style: {},
    download: '',
    href: '',
    click() { this.clicked = true; },
  };
}

assert.equal(html.includes('id="new-sku-rules-editor"'), true, 'desktop admin should expose editable New SKU Matrix UI');
assert.equal(html.includes('id="other-sku-rules-editor"'), true, 'desktop admin should expose editable Other SKU non-KPI UI');
assert.equal(html.includes('function renderNewSkuRulesEditor'), true, 'desktop admin should define New SKU Matrix editor renderer');
assert.equal(html.includes('function updateNewSkuRuleField'), true, 'desktop admin should let SKU rule fields update CONFIG.sku_rules');
assert.equal(html.includes('function addNewSkuRuleRow'), true, 'desktop admin should let managers add new SKU rule rows');
assert.equal(html.includes('function removeNewSkuRule'), true, 'desktop admin should let managers remove SKU rule rows');
assert.equal(html.includes('function renderOtherSkuRulesEditor'), true, 'desktop admin should define Other SKU editor renderer');
assert.equal(html.includes('function updateOtherSkuRuleField'), true, 'desktop admin should let Other SKU fields update CONFIG.sku_rules');
assert.equal(html.includes('function downloadSkuRulesConfig'), true, 'desktop admin should export sku_rules.json for local pipeline fallback');
assert.equal(html.includes('function applyAgentReplacementsToConfig'), true, 'desktop admin should apply configured agent replacements');
assert.match(html, /staticKeys[\s\S]*agent_replacements/, 'desktop admin should persist agent replacement rules through targets_static static config');
assert.match(html, /staticKeys[\s\S]*sku_rules/, 'desktop admin should persist SKU rules through targets_static static config');

const elements = new Map([
  ['new-sku-rules-editor', makeElement('new-sku-rules-editor')],
  ['other-sku-rules-editor', makeElement('other-sku-rules-editor')],
  ['sku-rules-preview', makeElement('sku-rules-preview')],
]);
const context = {
  AGENTS: ['BEN', 'CJ', 'JACKY', 'JAMES', 'JW', 'KEAN', 'KEE', 'KF', 'KI-MI', 'KW', 'LEON', 'NMK', 'SAM', 'YI'],
  CONFIG: {
    sku_rules_snapshot: {
      version: 2,
      updated_at: '2026-07-02',
      new_sku_groups: {
        CMX: { item_codes: ['CMX'], item_groups: ['CMX'] },
      },
      other_sku_groups: {
        OTHER: { label: 'CMLT', item_codes: ['CMLT'], item_groups: ['CMLT'] },
      },
    },
  },
  DASH_DATA: {},
  DEFAULT_OTHER_SKU_GROUPS: {
    OTHER: { label: 'CMLT', item_codes: ['CMLT'], item_groups: ['CMLT'] },
  },
  document: {
    createElement(tag) { return makeElement(tag); },
    getElementById(id) { return elements.get(id) || null; },
  },
  Blob,
  URL: {
    createObjectURL() { return 'blob:test'; },
    revokeObjectURL() {},
  },
  console: { warn() {}, log() {}, error() {} },
  updateRawJSON() {},
};
context.window = context;
vm.createContext(context);
vm.runInContext(extractBlock('const MD_ADMIN_GROUP', 'const BRAND_PEN_GROUP_MAP_KEY'), context);

[
  'kpiAdminEscape',
  'adminSkuRulesSnapshot',
  'adminRuleItemsText',
  'adminRuleMapHtml',
  'renderSkuRulesPreview',
  'adminSkuRuleListFromMap',
  'adminParseRuleList',
  'adminNormalizeRuleMap',
  'adminEditableSkuRules',
  'syncNewSkuRulesToConfig',
  'syncOtherSkuRulesToConfig',
  'renderNewSkuRulesEditor',
  'updateNewSkuRuleField',
  'addNewSkuRuleRow',
  'removeNewSkuRule',
  'renderOtherSkuRulesEditor',
  'updateOtherSkuRuleField',
  'addOtherSkuRuleRow',
  'removeOtherSkuRule',
  'downloadSkuRulesConfig',
  'applyAgentReplacementsToConfig',
].forEach(name => vm.runInContext(extractFunction(name), context));

const replacementConfig = {
  agents: {
    KEAN: { active: true },
    XIAN: { active: true },
  },
  agent_replacements: {
    KEAN: { successor: 'XIAN', from_month: 'Jul-26' },
  },
};
context.applyAgentReplacementsToConfig(replacementConfig);
assert.equal(replacementConfig.agents.KEAN.active, false, 'agent replacement should deactivate predecessor');
assert.equal(replacementConfig.agents.KEAN.archived, true, 'agent replacement should archive predecessor');
assert.equal(replacementConfig.agents.XIAN.inherits_from, 'KEAN', 'agent replacement should mark successor inheritance');
assert.equal(replacementConfig.agents.XIAN.inherit_from_month, 'Jul-26', 'agent replacement should preserve effective month');

const expandedLegacyRules = context.adminNormalizeRuleMap({
  SUKUN: { item_code_prefixes: ['SKN'], item_groups: ['SUKUN'] },
  CMX: { item_codes: ['CMX'], item_groups: ['CMX'] },
});
assert.deepEqual(
  Object.keys(expandedLegacyRules),
  ['SKNR', 'SKNW', 'CMX'],
  'admin should expand legacy SUKUN New SKU config into separate SKNR/SKNW rules',
);
assert.equal(
  expandedLegacyRules.SUKUN,
  undefined,
  'admin should not keep SUKUN as a single New SKU KPI bucket',
);

context.renderNewSkuRulesEditor();
assert.match(elements.get('new-sku-rules-editor').innerHTML, /CMX/, 'editor should render rules from the active snapshot');
context.renderOtherSkuRulesEditor();
assert.match(elements.get('other-sku-rules-editor').innerHTML, /CMLT/, 'Other SKU editor should render the default non-KPI bucket');

context.updateNewSkuRuleField(0, 'key', 'test sku');
context.updateNewSkuRuleField(0, 'item_codes', 'xyz-001, xyz-002');
context.updateNewSkuRuleField(0, 'item_code_prefixes', 'xyz');
context.updateNewSkuRuleField(0, 'item_groups', 'xgroup');

const edited = context.CONFIG.sku_rules.new_sku_groups['TEST SKU'];
assert.deepEqual(edited.item_codes, ['XYZ-001', 'XYZ-002'], 'item code edits should normalize into CONFIG.sku_rules');
assert.deepEqual(edited.item_code_prefixes, ['XYZ'], 'item code prefix edits should normalize into CONFIG.sku_rules');
assert.deepEqual(edited.item_groups, ['XGROUP'], 'item group edits should normalize into CONFIG.sku_rules');
assert.equal(
  context.CONFIG.sku_rules_snapshot.new_sku_groups['TEST SKU'].item_codes[0],
  'XYZ-001',
  'editor should keep sku_rules_snapshot aligned for immediate preview',
);

context.addNewSkuRuleRow();
assert.equal(Object.keys(context.CONFIG.sku_rules.new_sku_groups).length, 2, 'add row should append a new configurable SKU group');
context.removeNewSkuRule(1);
assert.equal(Object.keys(context.CONFIG.sku_rules.new_sku_groups).length, 1, 'remove row should delete the selected configurable SKU group');

context.updateOtherSkuRuleField(0, 'label', 'OTHERS');
context.updateOtherSkuRuleField(0, 'item_codes', 'cmlt, cmlt-001');
context.updateOtherSkuRuleField(0, 'item_groups', 'cmlt');
assert.equal(context.CONFIG.sku_rules.other_sku_groups.OTHER.label, 'OTHERS', 'Other SKU label edits should persist');
assert.deepEqual(
  context.CONFIG.sku_rules.other_sku_groups.OTHER.item_codes,
  ['CMLT', 'CMLT-001'],
  'Other SKU item code edits should normalize into CONFIG.sku_rules',
);
assert.match(
  elements.get('sku-rules-preview').innerHTML,
  /Other SKU Groups/,
  'preview should show Other SKU groups separately from New SKU KPI groups',
);

context.addOtherSkuRuleRow();
assert.equal(Object.keys(context.CONFIG.sku_rules.other_sku_groups).length, 2, 'add row should append an Other SKU non-KPI group');
context.removeOtherSkuRule(1);
assert.equal(Object.keys(context.CONFIG.sku_rules.other_sku_groups).length, 1, 'remove row should delete the selected Other SKU group');

console.log('admin_sku_rules_editor.test.cjs passed');
