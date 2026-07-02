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
assert.equal(html.includes('function renderNewSkuRulesEditor'), true, 'desktop admin should define New SKU Matrix editor renderer');
assert.equal(html.includes('function updateNewSkuRuleField'), true, 'desktop admin should let SKU rule fields update CONFIG.sku_rules');
assert.equal(html.includes('function addNewSkuRuleRow'), true, 'desktop admin should let managers add new SKU rule rows');
assert.equal(html.includes('function removeNewSkuRule'), true, 'desktop admin should let managers remove SKU rule rows');
assert.equal(html.includes('function downloadSkuRulesConfig'), true, 'desktop admin should export sku_rules.json for local pipeline fallback');
assert.match(html, /staticKeys[\s\S]*sku_rules/, 'desktop admin should persist SKU rules through targets_static static config');

const elements = new Map([
  ['new-sku-rules-editor', makeElement('new-sku-rules-editor')],
  ['sku-rules-preview', makeElement('sku-rules-preview')],
]);
const context = {
  CONFIG: {
    sku_rules_snapshot: {
      version: 2,
      updated_at: '2026-07-02',
      new_sku_groups: {
        CMX: { item_codes: ['CMX'], item_groups: ['CMX'] },
      },
    },
  },
  DASH_DATA: {},
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
  'renderNewSkuRulesEditor',
  'updateNewSkuRuleField',
  'addNewSkuRuleRow',
  'removeNewSkuRule',
  'downloadSkuRulesConfig',
].forEach(name => vm.runInContext(extractFunction(name), context));

context.renderNewSkuRulesEditor();
assert.match(elements.get('new-sku-rules-editor').innerHTML, /CMX/, 'editor should render rules from the active snapshot');

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

console.log('admin_sku_rules_editor.test.cjs passed');
