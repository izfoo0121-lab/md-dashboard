const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const salesHtml = fs.readFileSync(path.join(root, 'sales_dashboard.html'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
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

const kpiContent = { innerHTML: '' };
const context = {
  currentAgent: 'CJ',
  DATA: {
    agents: {
      CJ: {
        kpi: {
          total_abc: 0,
          max_abc: 1.5,
          grand_total: 0,
          total_pct: 0,
          section_scores: { B: { score: 0, max_score: 1.5 } },
          items: {
            missing_target: {
              label: 'Missing Target',
              section: 'B',
              source: 'auto',
              target: null,
              actual: 8,
              pct: 0,
              score: 0,
              max_score: 0,
              target_missing: true,
            },
            zero_target: {
              label: 'Zero Target',
              section: 'B',
              source: 'auto',
              target: 0,
              actual: 8,
              pct: 0,
              score: 0,
              max_score: 1.5,
            },
            real_target: {
              label: 'Real Target',
              section: 'B',
              source: 'auto',
              target: 4,
              actual: 2,
              pct: 50,
              score: 0.75,
              max_score: 1.5,
            },
          },
        },
      },
    },
  },
  document: {
    getElementById(id) {
      return id === 'kpi-content' ? kpiContent : null;
    },
  },
  trendCard() { return ''; },
  futureViewEmptyHtml(label) { return `future ${label}`; },
};

vm.createContext(context);
vm.runInContext(extractFunction(salesHtml, 'kpiTargetValue'), context);
vm.runInContext(extractFunction(salesHtml, 'renderKPI'), context);

context.renderKPI();

assert.match(kpiContent.innerHTML, /Real Target/, 'KPI tab should render items with a real target');
assert.doesNotMatch(kpiContent.innerHTML, /Missing Target/, 'KPI tab should leave missing target items blank');
assert.doesNotMatch(kpiContent.innerHTML, /Zero Target/, 'KPI tab should leave zero target items blank');

console.log('sales_kpi_target_blank.test.cjs passed');
