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
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

const groupContent = { innerHTML: '' };
const context = {
  DATA: {
    current_month: 'May 26',
    group_brand_targets: {},
    working_days: {
      total_working_days: 24,
      elapsed_working_days: 24,
      theoretical_pct: 100,
    },
    team: {
      t1_total_target: 46000,
      t2_total_target: 49000,
      ga_total_target: 3000,
      ma_total_target: 16314,
      team_normal_ctn: 45792,
      team_ga_ctn: 3190,
      team_ma_ctn: 12516,
      t1_gap: -208,
      t2_gap: -3208,
      ga_gap: 190,
      ma_gap: -3798,
      t1_pct: 99.55,
      t2_pct: 93.45,
      ga_pct: 106.33,
      ma_pct: 76.72,
      prev_month_ctn: 7146,
      cur_month_invoiced_paid: 54352,
      team_8com_unpaid: 0,
    },
    agents: {
      BEN: {
        sales_progression: {
          tiers: {
            normal_t1: { target: 930 },
            normal_t2: { target: 1171 },
            ga: { target: 23 },
            ma: { target: 244 },
          },
        },
      },
      CJ: {
        sales_progression: {
          tiers: {
            normal_t1: { target: 4078 },
            normal_t2: { target: 4328 },
            ga: { target: 362 },
            ma: { target: 4837 },
          },
        },
      },
      TEAM_REST: {
        sales_progression: {
          tiers: {
            normal_t1: { target: 41024 },
            normal_t2: { target: 43751 },
            ga: { target: 2617 },
            ma: { target: 8936 },
          },
        },
      },
    },
    config: {},
  },
  document: {
    getElementById(id) {
      return id === 'group-content' ? groupContent : null;
    },
  },
  fmtNum(value) {
    return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  },
  fmtPct(value) {
    return `${Number(value || 0).toFixed(1)}%`;
  },
  futureViewEmptyHtml(label) {
    return `future ${label}`;
  },
};

vm.createContext(context);
vm.runInContext(extractFunction('renderGroupBrandTargets'), context);
context.renderGroupBrandTargets();

assert(groupContent.innerHTML.includes('46,032'), 'Group tab Normal T1 target should use the summed agent targets, not the stale group override');
assert(!groupContent.innerHTML.includes('>46,000<'), 'Group tab Normal T1 target should not show the stale group override when agent targets are available');
assert(groupContent.innerHTML.includes('49,250'), 'Group tab Normal T2 target should use the summed agent targets');
assert(groupContent.innerHTML.includes('63,051'), 'Group tab total target should include summed Normal T1 + GA + MA targets');
assert(groupContent.innerHTML.includes('61,498'), 'Group tab total actual should include Normal + GA + MA paid CTN');
assert(groupContent.innerHTML.includes('-1,553'), 'Group tab total gap should be actual minus combined target');
assert(groupContent.innerHTML.includes('97.54%'), 'Group tab total achievement should use combined actual / combined target');

console.log('sales_group_totals.test.cjs passed');
