const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const salesHtml = fs.readFileSync(path.join(root, 'sales_dashboard.html'), 'utf8');
const processData = fs.readFileSync(path.join(root, 'process_data.py'), 'utf8');

function extractFunction(source, name) {
  const syncStart = source.indexOf(`function ${name}`);
  const asyncStart = source.indexOf(`async function ${name}`);
  const candidates = [syncStart, asyncStart].filter(idx => idx >= 0);
  const start = candidates.length ? Math.min(...candidates) : -1;
  assert(start >= 0, `${name} should exist`);
  const bodyStart = source.indexOf('{', source.indexOf(')', start));
  assert(bodyStart >= 0, `${name} should have a function body`);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

function extractPythonBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert(start >= 0, `${startMarker} should exist`);
  const end = source.indexOf(endMarker, start);
  assert(end > start, `${endMarker} should appear after ${startMarker}`);
  return source.slice(start, end);
}

const renderDebtorCard = extractFunction(salesHtml, 'renderDebtorCard');
assert(
  renderDebtorCard.includes('ZLB Brand'),
  'debtor card chips should be labelled ZLB Brand, not generic SKU',
);
assert(
  renderDebtorCard.includes('visibleZlbStatusEntries'),
  'debtor card should build visible ZLB brand chips through a helper that can follow admin config',
);
assert(
  salesHtml.includes('function isVisibleZlbBrandGroup'),
  'sales dashboard should define a helper that applies the ZLB brand visibility cutoff',
);
assert(
  !renderDebtorCard.includes("replace('IFACE','iFACE')"),
  'debtor card should route ZLB labels through the cutoff helper instead of always showing IFACE',
);

assert(
  salesHtml.includes("const ZLB_IFACE_REMOVED_FROM_MONTH = 'Jul 26'"),
  'sales dashboard should make the IFACE removal month explicit',
);
assert(
  salesHtml.includes('targets_static?select=key,value'),
  'sales dashboard should fetch live static config from Supabase so Admin ZLB edits apply without regenerating JSON',
);

const salesContext = {
  DATA: {
    current_month: 'Jun 26',
    config: { zlb_brands: ['SUKUN', 'EVO', 'BISON', 'LAM+LWM'] },
  },
};
vm.createContext(salesContext);
vm.runInContext(extractFunction(salesHtml, 'monthSortKey'), salesContext);
vm.runInContext(extractFunction(salesHtml, 'shiftedMonthLabel'), salesContext);
const zlbHelperStart = salesHtml.indexOf('const ZLB_IFACE_REMOVED_FROM_MONTH');
const zlbHelperEnd = salesHtml.indexOf('function monthSlug', zlbHelperStart);
assert(zlbHelperStart >= 0 && zlbHelperEnd > zlbHelperStart, 'ZLB helper block should be extractable');
vm.runInContext(salesHtml.slice(zlbHelperStart, zlbHelperEnd), salesContext);

assert.strictEqual(
  salesContext.isVisibleZlbBrandGroup('IFACE'),
  true,
  'Jun 26 historical ZLB chips should still show IFACE even when current config omits it',
);
salesContext.DATA.current_month = 'Jul 26';
assert.strictEqual(
  salesContext.isVisibleZlbBrandGroup('IFACE'),
  false,
  'Jul 26 onward ZLB chips should hide IFACE when config omits it',
);
assert.strictEqual(
  salesContext.isVisibleZlbBrandGroup('SUKUN'),
  true,
  'configured ZLB brands should remain visible after the IFACE cutoff',
);

salesContext.DATA.current_month = 'Jul 26';
salesContext.DATA.config = {
  zlb_brands: ['SUKUN', 'CMP'],
  brand_config: { SUKUN: ['SKNR', 'SKNW'], CMP: ['CMP'] },
};
const dynamicZlbDebtor = {
  sku_status: { SUKUN: 'lapsed' },
  month_breakdown: {
    'Jul 26': [{ item: 'CMP', ctn: 2, sales_type: 'Target' }],
    'Jun 26': [],
    'May 26': [],
    'Apr 26': [],
  },
};
const dynamicEntries = salesContext.visibleZlbStatusEntries(dynamicZlbDebtor);
const dynamicBrands = Array.from(dynamicEntries, ([grp]) => grp);
assert.deepStrictEqual(
  dynamicBrands,
  ['SUKUN'],
  'debtor card ZLB chips should filter CMP because CMP belongs to Group Brand Target, not ZLB',
);

(async () => {
  const liveContext = {
    DATA: {
      current_month: 'Jul 26',
      config: {
        zlb_brands: ['SUKUN'],
        brand_config: { SUKUN: ['SKNR', 'SKNW'] },
      },
    },
    fetchedPath: '',
    SALES_LIVE_STATIC_CONFIG_KEYS: ['brand_config', 'zlb_brands', 'sku_rules'],
    SALES_LIVE_STATIC_CONFIG_CACHE: undefined,
    fetchSupabaseJson: async path => {
      liveContext.fetchedPath = path;
      return [
        { key: 'zlb_brands', value: ['SUKUN', 'iFACE'] },
        { key: 'brand_config', value: { SUKUN: ['SKNR'], iFACE: ['IFACE R'] } },
        { key: 'sku_rules', value: { version: 3, new_sku_groups: { CMX: { item_codes: ['CMX'] } } } },
      ];
    },
    console: { warn() {} },
  };
  vm.createContext(liveContext);
  vm.runInContext(extractFunction(salesHtml, 'monthSortKey'), liveContext);
  vm.runInContext(extractFunction(salesHtml, 'shiftedMonthLabel'), liveContext);
  vm.runInContext(salesHtml.slice(zlbHelperStart, zlbHelperEnd), liveContext);
  [
    'normalizeSalesLiveStaticRows',
    'fetchSalesLiveStaticConfig',
    'mergeSalesLiveStaticConfig',
    'applySalesLiveStaticConfig',
  ].forEach(name => vm.runInContext(extractFunction(salesHtml, name), liveContext));

  assert.strictEqual(
    liveContext.isVisibleZlbBrandGroup('IFACE'),
    false,
    'Jul 26 static JSON without iFACE should initially hide IFACE',
  );
  await liveContext.applySalesLiveStaticConfig(liveContext.DATA);
  assert.match(liveContext.fetchedPath, /targets_static\?select=key,value/, 'live static config fetch should query targets_static');
  assert.deepStrictEqual(
    liveContext.DATA.config.zlb_brands,
    ['SUKUN', 'iFACE'],
    'live static zlb_brands should override generated JSON config',
  );
  assert.deepStrictEqual(
    liveContext.DATA.config.brand_config.iFACE,
    ['IFACE R'],
    'live static brand_config should merge into DATA.config',
  );
  assert.strictEqual(
    liveContext.isVisibleZlbBrandGroup('IFACE'),
    true,
    'Jul 26 should show IFACE when Admin adds IFACE back to live ZLB config',
  );

  const skuGroupsBlock = extractPythonBlock(processData, '# ZLB brand groups shown on debtor cards', '# New SKU groups');
  assert(
    processData.includes('ZLB_IFACE_REMOVED_FROM_MONTH = "Jul 26"'),
    'process_data should make the IFACE removal month explicit',
  );
  assert(
    skuGroupsBlock.includes('zlb_brands_for_month'),
    'process_data debtor-card SKU/ZLB groups should apply the month cutoff before generating sku_status',
  );

  console.log('sales_zlb_brand_chips.test.cjs passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
