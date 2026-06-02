# Admin Campaign Mechanisms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Admin campaign creation clearer by separating campaign type from reusable mechanism cards while preserving existing Supabase-compatible campaign notes.

**Architecture:** This is a scoped `admin.html` UI and helper change. The create/edit campaign form continues to use existing IDs and `readCampaignMechanism()` payload fields, but the visible labels and sections become business-friendly cards. Tests validate the Admin HTML contract and helper output strings.

**Tech Stack:** Static HTML, vanilla JavaScript, existing Node `.cjs` smoke tests, Supabase REST payload compatibility.

---

## File Structure

- Modify: `C:\Users\tgy_3\Documents\Playground\md-dashboard-live-main\admin.html`
  - Rename the campaign type area to "Campaign Type".
  - Replace "Campaign Mechanism Builder" with card-style mechanism copy.
  - Add helper functions for mechanism labels, descriptions, and validation warnings.
  - Keep existing `new-camp-*` field IDs to avoid breaking current save flow.
- Create: `C:\Users\tgy_3\Documents\Playground\md-dashboard-live-main\tests\admin_campaign_mechanisms.test.cjs`
  - Smoke-test that the Admin form exposes the new type/mechanism language and still has existing fields.
- Modify: `C:\Users\tgy_3\Documents\Playground\md-dashboard-live-main\docs\superpowers\specs\2026-06-02-admin-campaign-mechanisms-design.md`
  - Add a short implementation note after the code is complete.

## Task 1: Admin Mechanism Contract Test

**Files:**
- Create: `C:\Users\tgy_3\Documents\Playground\md-dashboard-live-main\tests\admin_campaign_mechanisms.test.cjs`

- [ ] **Step 1: Write the failing test**

```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

assert(html.includes('Campaign Type'), 'Admin should label the top dropdown as Campaign Type');
assert(html.includes('Mechanism Cards'), 'Admin should present reusable mechanism cards');
assert(html.includes('Gift / FOC Delivery'), 'Admin should include a gift delivery mechanism card label');
assert(html.includes('Brand Penetration / Win-back'), 'Admin should include a penetration mechanism card label');
assert(html.includes('Volume Segment Offer'), 'Admin should include a BISON-style volume segment mechanism card label');
assert(html.includes('PK / Commission Pool'), 'Admin should include a PK pool add-on label');
assert(html.includes('function campaignMechanismDisplayMeta'), 'Admin should expose mechanism display metadata helper');
assert(html.includes('function updateCampaignMechanismCopy'), 'Admin should update mechanism explanation when selection changes');
assert(html.includes('function validateCampaignMechanismBeforeSave'), 'Admin should validate missing mechanism requirements before save');
assert(html.includes('validateCampaignMechanismBeforeSave('), 'Admin save flow should call mechanism validation before Supabase save');
assert(html.includes('id="new-camp-mechanism-help"'), 'Create form should show selected mechanism help text');
assert(html.includes('id="new-camp-mechanism-preview"'), 'Create form should show mechanism preview text');
assert(html.includes('id="new-camp-pk-addon"'), 'Create form should expose the PK add-on card');
assert(html.includes('id="new-camp-gift-addon"'), 'Create form should expose the gift/FOC add-on card');
assert(html.includes('new-camp-volume-basis'), 'Existing volume basis field should remain available');
assert(html.includes('new-camp-reward-tiers'), 'Existing reward tier field should remain available');
assert(html.includes('new-camp-lookback-months'), 'Existing lookback field should remain available');

console.log('admin_campaign_mechanisms.test.cjs passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests\admin_campaign_mechanisms.test.cjs`

Expected: FAIL on at least one new label/helper assertion because the form still uses the old "Campaign Mechanism Builder" presentation.

## Task 2: Mechanism Card UI

**Files:**
- Modify: `C:\Users\tgy_3\Documents\Playground\md-dashboard-live-main\admin.html`

- [ ] **Step 1: Implement the minimal UI copy and card wrappers**

Replace the `Type` label with `Campaign Type`, change the mechanism divider to `Mechanism Cards`, and add these sections using existing field IDs:

```html
<div class="sec-divider" style="margin-top:14px;">Mechanism Cards</div>
<div id="new-camp-mechanism-help" ...></div>
<div id="new-camp-mechanism-preview" ...></div>
<label id="new-camp-gift-addon" ...>Gift / FOC Delivery ...</label>
<label id="new-camp-pk-addon" ...>PK / Commission Pool ...</label>
```

The main mechanism dropdown should use labels:

```html
<option value="manual_claim">Manual list / exact package</option>
<option value="delivery_gift">Gift / FOC Delivery</option>
<option value="conversion">Brand Penetration / Win-back</option>
<option value="volume_reward">Volume Segment Offer</option>
```

- [ ] **Step 2: Add display metadata helpers**

Add:

```javascript
function campaignMechanismDisplayMeta(mechanism, type) {
  const meta = {
    manual_claim: { title: 'Manual list / exact package', help: 'Use when Admin already has the approved debtor list.', preview: 'Sales shows selected debtors and exact package notes.' },
    delivery_gift: { title: 'Gift / FOC Delivery', help: 'Use for festive gift, birthday, or free sample delivery tracking.', preview: 'Agents claim or mark delivered without changing the package instruction.' },
    conversion: { title: 'Brand Penetration / Win-back', help: 'Use for current-month purchase or no-lookback-then-current campaigns.', preview: 'Sales shows eligibility reason; Management compares conversion and CTN.' },
    volume_reward: { title: 'Volume Segment Offer', help: 'Use for BISON-style previous-volume categories with different offers.', preview: 'Admin defines volume basis and reward tiers; generated data tracks the result.' }
  };
  const chosen = meta[mechanism] || meta.manual_claim;
  if (type === 'festive_gift' && mechanism === 'manual_claim') {
    return { ...chosen, help: 'Festive campaign with a confirmed debtor list and exact gift package.' };
  }
  return chosen;
}

function updateCampaignMechanismCopy(scope, type = '') {
  const mechanism = document.getElementById(_campScopeId(scope, 'mechanism-type'))?.value || 'manual_claim';
  const meta = campaignMechanismDisplayMeta(mechanism, type);
  const help = document.getElementById(_campScopeId(scope, 'mechanism-help'));
  const preview = document.getElementById(_campScopeId(scope, 'mechanism-preview'));
  if (help) help.textContent = meta.help;
  if (preview) preview.textContent = meta.preview;
}
```

- [ ] **Step 3: Wire the copy updater**

Update `toggleCampaignMechanismSections(scope, type)` so the final line calls:

```javascript
updateCampaignMechanismCopy(scope, type);
```

- [ ] **Step 4: Run the new test**

Run: `node tests\admin_campaign_mechanisms.test.cjs`

Expected: still FAIL on validation helper until Task 3 is implemented.

## Task 3: Mechanism Validation

**Files:**
- Modify: `C:\Users\tgy_3\Documents\Playground\md-dashboard-live-main\admin.html`

- [ ] **Step 1: Add validation helper before `createCampaign()`**

Add:

```javascript
function validateCampaignMechanismBeforeSave(scope, type) {
  const get = field => document.getElementById(_campScopeId(scope, field));
  const mechanism = get('mechanism-type')?.value || 'manual_claim';
  const errors = [];
  const matchValues = _campCsv(get('qualifying-item')?.value || '');
  const lookbackMonths = _campCsv(get('lookback-months')?.value || '');
  const hasDefaultGift = !!String(document.getElementById('new-camp-foc-item')?.value || '').trim();
  const hasUploadedRows = Array.isArray(_campFileDebtors) && _campFileDebtors.length > 0;

  if (mechanism === 'conversion') {
    if (!matchValues.length) errors.push('Brand Penetration / Win-back needs at least one match value.');
    if ((get('conversion-rule')?.value || '') === 'no_lookback_then_current' && !lookbackMonths.length) {
      errors.push('No-lookback conversion needs at least one lookback month.');
    }
  }
  if (mechanism === 'volume_reward') {
    if (!matchValues.length) errors.push('Volume Segment Offer needs the item group/code to measure.');
    if (!String(get('reward-tiers')?.value || '').trim()) errors.push('Volume Segment Offer needs at least one reward/category tier.');
  }
  if (mechanism === 'delivery_gift' && !hasDefaultGift && !hasUploadedRows) {
    errors.push('Gift / FOC Delivery needs a default package or an uploaded debtor list with debtor-level package.');
  }
  if (errors.length) alert(errors.join('\n'));
  return !errors.length;
}
```

- [ ] **Step 2: Call validation in `createCampaign()`**

After reading `type` and before creating the payload, add:

```javascript
if (!validateCampaignMechanismBeforeSave('new-camp', type)) return;
```

- [ ] **Step 3: Run the new test**

Run: `node tests\admin_campaign_mechanisms.test.cjs`

Expected: PASS.

## Task 4: Regression Tests

**Files:**
- Test only.

- [ ] **Step 1: Run Admin campaign tests**

Run:

```powershell
node tests\admin_campaign_mechanisms.test.cjs
node tests\admin_iface_campaign.test.cjs
node tests\admin_foc_campaign.test.cjs
node tests\admin_campaign_archive.test.cjs
```

Expected: all print `passed`.

- [ ] **Step 2: Parse Admin scripts**

Run:

```powershell
@'
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('admin.html', 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
scripts.forEach((script, i) => new vm.Script(script, { filename: `admin-script-${i}.js` }));
console.log(`parsed ${scripts.length} admin inline scripts`);
'@ | node
```

Expected: exit 0 and print parsed script count.

## Task 5: Documentation and Notion Record

**Files:**
- Modify: `C:\Users\tgy_3\Documents\Playground\md-dashboard-live-main\docs\superpowers\specs\2026-06-02-admin-campaign-mechanisms-design.md`

- [ ] **Step 1: Add implementation note**

Append:

```markdown
## Implementation Record

First pass implemented in `admin.html`:

- Campaign Type is visually separated from mechanism selection.
- Mechanism Cards explain Manual List, Gift / FOC Delivery, Brand Penetration / Win-back, Volume Segment Offer, and PK / Commission Pool concepts.
- Existing Supabase campaign notes remain the storage format.
- Validation blocks missing match values, lookback months, volume tiers, and gift package/list requirements before save.
```

- [ ] **Step 2: Update Notion**

Use the Notion connector if available to create or update a dashboard architecture/decision record titled `MD Dashboard - Admin Campaign Mechanisms`.

If Notion tools are unavailable, report that Notion could not be updated and leave the repo spec as the durable record.

## Task 6: Commit

**Files:**
- Stage only the Admin implementation, new test, and spec update.

- [ ] **Step 1: Check status**

Run: `git status -sb`

Expected: modified `admin.html`, modified spec, new test, plus possibly unrelated `.superpowers/` untracked visual companion files that must not be staged.

- [ ] **Step 2: Commit**

Run:

```powershell
git add -- admin.html tests/admin_campaign_mechanisms.test.cjs docs/superpowers/specs/2026-06-02-admin-campaign-mechanisms-design.md
git commit -m "Improve admin campaign mechanism builder"
```

Expected: commit succeeds.

