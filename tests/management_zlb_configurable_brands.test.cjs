const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'management.html'), 'utf8');
const start = html.indexOf('const PROGRESS_ZLB_BRAND_ORDER');
assert(start >= 0, 'ZLB brand helpers should exist');
const end = html.indexOf('function progressZlbMonthLabelFromIndex', start);
assert(end > start, 'ZLB brand helper slice should end before month helpers');

const context = {
  apAgents(D) { return Object.keys(D.agents || {}).sort(); },
  console,
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

const data = {
  config: {
    brand_config: {
      iFACE: ['IFACE B'],
      SUKUN: ['SKNR'],
      CMP: ['CMP'],
      EVO: ['EVO'],
      BISON: ['BISON-R'],
      'LAM+LWM': ['LAM', 'LWM'],
    },
    zlb_brands: ['SUKUN', 'CMP', 'BISON'],
  },
  agents: {
    BEN: {
      brand_commission: {
        iFACE: {},
        SUKUN: {},
        CMP: {},
        BISON: {},
      },
    },
  },
};

assert.deepEqual(
  context.progressZlbBrands(data),
  ['SUKUN', 'CMP', 'BISON'],
  'ZLB brand chips should follow config.zlb_brands and exclude unlisted iFACE',
);

const legacyData = {
  config: {
    brand_config: {
      iFACE: ['IFACE B'],
      SUKUN: ['SKNR'],
      EVO: ['EVO'],
      BISON: ['BISON-R'],
      'LAM+LWM': ['LAM', 'LWM'],
    },
  },
  agents: {
    BEN: {
      brand_commission: {
        iFACE: {},
        SUKUN: {},
        EVO: {},
        BISON: {},
        'LAM+LWM': {},
      },
    },
  },
};

assert.deepEqual(
  context.progressZlbBrands(legacyData),
  ['SUKUN', 'EVO', 'BISON', 'LAM+LWM'],
  'ZLB fallback should use the default visible list and hide iFACE when config.zlb_brands is absent',
);

console.log('management_zlb_configurable_brands.test.cjs passed');
