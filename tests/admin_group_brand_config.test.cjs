const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

function extractFunction(name) {
  const syncMarker = `function ${name}(`;
  const asyncMarker = `async function ${name}(`;
  const syncStart = html.indexOf(syncMarker);
  const asyncStart = html.indexOf(asyncMarker);
  const candidates = [syncStart, asyncStart].filter(idx => idx >= 0);
  const start = candidates.length ? Math.min(...candidates) : -1;
  assert(start >= 0, `${name} should exist`);
  const bodyStart = html.indexOf('{', html.indexOf(')', start));
  assert(bodyStart >= 0, `${name} should have a function body`);
  let depth = 0;
  for (let i = bodyStart; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
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

function makeElement(id, value = '') {
  return {
    id,
    value,
    innerHTML: '',
    textContent: '',
    style: {},
  };
}

assert(html.includes('id="group-brand-config-editor"'), 'Group Brand tab should expose a config editor');

const elements = new Map([
  ['group-brand-config-editor', makeElement('group-brand-config-editor')],
  ['group-brand-form', makeElement('group-brand-form')],
  ['group-brand-config-input', makeElement('group-brand-config-input')],
]);

const context = {
  CONFIG: {
    group_brand_config: {
      SUKUN: ['SKNR', 'SKNW'],
      EVO: ['EVO'],
      BISON: ['BISON-G', 'BISON-M', 'BISON-R'],
    },
    group_brand_targets: {
      SUKUN: 7800,
      EVO: 11000,
    },
  },
  document: {
    getElementById(id) { return elements.get(id) || null; },
  },
  updateRawJSON() { context.rawUpdated = true; },
  console,
};
context.window = context;
vm.createContext(context);

[
  extractBlock('const DEFAULT_GROUP_BRAND_CONFIG', 'function renderGroupBrandForms'),
  extractFunction('kpiAdminEscape'),
  extractFunction('kpiAdminJsLiteral'),
  extractFunction('kpiAdminEventArg'),
  extractFunction('normalizeGroupBrandKey'),
  extractFunction('normalizeGroupBrandCodes'),
  extractFunction('normalizeGroupBrandConfig'),
  extractFunction('adminGroupBrandConfig'),
  extractFunction('groupBrandConfigToText'),
  extractFunction('parseGroupBrandConfigText'),
  extractFunction('renderGroupBrandConfigEditor'),
  extractFunction('applyGroupBrandConfigText'),
  extractFunction('renderGroupBrandForms'),
  extractFunction('setGroupTarget'),
].forEach(src => vm.runInContext(src, context));

const migrated = context.adminGroupBrandConfig();
assert.deepStrictEqual(Object.keys(migrated), ['CMP', 'EVO', 'BISON'], 'Legacy SUKUN group brand should migrate to CMP');
assert.deepEqual(migrated.CMP, ['CMP'], 'CMP group target should use CMP item code');
assert.strictEqual(context.CONFIG.group_brand_targets.CMP, 7800, 'Migration should preserve old SUKUN target value under CMP');
assert.strictEqual(context.CONFIG.group_brand_targets.SUKUN, undefined, 'Migration should remove old SUKUN target key');

context.renderGroupBrandForms();
assert.match(elements.get('group-brand-form').innerHTML, /CMP/, 'Group target form should render CMP');
assert.doesNotMatch(elements.get('group-brand-form').innerHTML, /SUKUN/, 'Group target form should not render SUKUN after migration');

elements.get('group-brand-config-input').value = 'CMP=CMP\nEVO=EVO\nBISON-R=BISON-R\nBISON-M=BISON-M';
context.applyGroupBrandConfigText();
assert.deepStrictEqual(Object.keys(context.CONFIG.group_brand_config), ['CMP', 'EVO', 'BISON-R', 'BISON-M']);
assert.strictEqual(context.CONFIG.group_brand_config['BISON-R'][0], 'BISON-R');
assert.strictEqual(context.CONFIG.group_brand_config['BISON-M'][0], 'BISON-M');
assert.strictEqual(context.CONFIG.group_brand_targets.EVO, 11000, 'Existing targets for retained brands should remain');
assert.strictEqual(context.rawUpdated, true, 'Applying group brand config should update raw JSON');

console.log('admin_group_brand_config.test.cjs passed');
