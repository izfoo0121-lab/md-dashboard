const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}`);
  assert(start >= 0, `${name} should exist`);
  const bodyStart = html.indexOf('{', html.indexOf(')', start));
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

assert(html.includes('function campaignAgentInstructionParts'), 'Admin should dedupe duplicated campaign description / note copy');
assert(html.includes('function renderCampaignAgentCopySummary'), 'Admin campaign cards should render a compact agent-facing copy summary');
assert(html.includes('Agent Instruction (optional)'), 'Create form should use a clearer one-line agent instruction label');
assert(html.includes('FOC / Claim Note (optional)'), 'Create form should label FOC notes as claim notes, not a second description');
assert(html.includes('renderCampaignAgentCopySummary(c)'), 'Campaign cards should use the compact copy summary renderer');
assert(!html.includes('setNewCampaignField(\'new-camp-desc\', `${cfg.label} new account / never bought / 3-month no ${cfg.label}.${hasFoc'), 'Brand penetration preset should not duplicate FOC package and note inside description');

const context = {};
vm.createContext(context);
vm.runInContext([
  extractFunction('cleanCampaignCopyText'),
  extractFunction('normalizeCampaignCopyText'),
  extractFunction('campaignAgentInstructionParts'),
].join('\n'), context);

const copy = JSON.parse(JSON.stringify(context.campaignAgentInstructionParts({
  description: 'IFACE new account / never bought / 3-month no IFACE. FOC SUKUN x 4 packs. Note: IFACE PEN.',
  foc_note: 'IFACE PEN',
  notes: { foc_note: 'IFACE PEN' },
})));

assert.strictEqual(copy.instruction.includes('IFACE new account'), true, 'Agent instruction should keep the mission text');
assert.strictEqual(copy.claimNote, '', 'Admin should not repeat a claim note already contained in the instruction');

console.log('admin_campaign_copy.test.cjs passed');
