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
      team_normal_ctn: 47353,
      team_ga_ctn: 3255,
      team_ma_ctn: 12519,
      t1_gap: 1353,
      t2_gap: -1647,
      ga_gap: 255,
      ma_gap: -3795,
      t1_pct: 102.94,
      t2_pct: 96.64,
      ga_pct: 108.5,
      ma_pct: 76.74,
      prev_month_ctn: 7236,
      cur_month_invoiced_paid: 56328,
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

assert(groupContent.innerHTML.includes('46,000'), 'Group tab Normal T1 target should use the fixed Admin group target');
assert(!groupContent.innerHTML.includes('46,032'), 'Group tab Normal T1 target should not be replaced by summed agent targets');
assert(groupContent.innerHTML.includes('49,000'), 'Group tab Normal T2 target should use the fixed Admin group target');
assert(groupContent.innerHTML.includes('65,314'), 'Group tab total target should be fixed Normal T1 + GA + MA targets');
assert(groupContent.innerHTML.includes('63,127'), 'Group tab total actual should include Normal + GA + MA paid CTN');
assert(groupContent.innerHTML.includes('-2,187'), 'Group tab total gap should be actual minus combined fixed target');
assert(groupContent.innerHTML.includes('96.65%'), 'Group tab total achievement should use combined actual / fixed target');

context.DATA.team = {
  t1_total_target: 0,
  t2_total_target: 0,
  ga_total_target: 0,
  ma_total_target: 0,
  team_normal_ctn: 12,
  team_ga_ctn: 3,
  team_ma_ctn: 0,
  t1_gap: null,
  t2_gap: null,
  ga_gap: null,
  ma_gap: null,
  t1_pct: null,
  t2_pct: null,
  ga_pct: null,
  ma_pct: null,
  prev_month_ctn: 0,
  cur_month_invoiced_paid: 12,
  team_8com_unpaid: 0,
};
context.renderGroupBrandTargets();

assert(groupContent.innerHTML.includes('12'), 'Group tab should still show actual CTN when targets are pending');
assert(groupContent.innerHTML.includes('—'), 'Group tab should show blank/pending target fields as dash');
assert(!groupContent.innerHTML.includes('+12'), 'Group tab should not calculate a positive gap from a missing target');
assert(!groupContent.innerHTML.includes('Infinity'), 'Group tab should not divide by a missing target');

console.log('sales_group_totals.test.cjs passed');
