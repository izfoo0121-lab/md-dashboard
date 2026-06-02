# Admin Campaign Mechanisms Design

## Purpose

Admin campaign setup should support repeated real-world campaign patterns without hardcoding one-off brands such as IFACE, TR12 PK, or BISON. The main refinement is to separate the campaign's business label from the rule that powers it.

Campaign type answers: "What kind of campaign is this for the team?"

Campaign mechanism answers: "How do we decide who is eligible, what they get, and how progress is counted?"

## Current Problem

The current Admin campaign form mixes type, conversion rules, FOC package, lookback purchase, PK pool, and delivery notes into one section. This works for simple campaigns, but it becomes confusing when a campaign is:

- a festive free gift with a fixed debtor list,
- a brand penetration campaign like IFACE,
- a BISON-style campaign where previous purchase volume creates debtor categories and different offers,
- a PK campaign with group ranking and commission pool,
- or a campaign with both a selling mission and a delivery/FOC action.

The result is that Admin has to guess which dropdown means campaign purpose versus actual scoring logic.

## Design

Admin campaign setup should become a two-layer builder.

### 1. Campaign Type

Campaign Type is the high-level display and default setup. It should keep the page friendly and familiar.

Recommended type options:

- Free Sample / FOC
- Birthday Gift
- Festive / Seasonal Gift
- Brand Promotion / Offer
- PK / Competition
- Other

The type sets defaults such as wording, icon, and suggested first mechanism, but it should not lock the campaign into one rule. For example, "Festive / Seasonal Gift" can use a manual debtor list, a purchase condition, or both.

### 2. Mechanism Cards

Mechanism Cards are the actual working rules. One campaign can have one or more cards.

Initial mechanism options:

- Manual debtor list + exact package: one row per debtor, with debtor-level FOC item, quantity, unit, and note.
- Gift entitlement / delivery tracking: agents claim or deliver a gift or FOC package.
- Current month purchase: a debtor qualifies when they buy the selected item or brand in the campaign month.
- No lookback purchase, then current purchase: a debtor qualifies if they had no selected-brand purchase in selected lookback months and then buys in the current month.
- Volume segment offer matrix: previous-month or lookback volume creates debtor categories, each with its own offer, target, or reward.
- PK / commission pool: group or agent ranking by converted customers, CTN, or both.
- Repeat order follow-up: later-month tracking for customers converted during the campaign period.

For the first implementation, these cards should map onto existing campaign fields and metadata rather than requiring a schema migration.

## Example Mapping

### IFACE June Style

Campaign Type: Brand Promotion / Offer or PK / Competition

Mechanisms:

- No lookback purchase, then current purchase
- Gift entitlement / delivery tracking
- PK / commission pool

This supports "new account or no IFACE in the lookback months, buy IFACE in June, get SUKUN FOC, then rank groups by penetration and CTN."

### BISON Style

Campaign Type: Brand Promotion / Offer

Mechanisms:

- Volume segment offer matrix
- Current month purchase
- Optional gift entitlement / delivery tracking

This supports "look at previous purchase volume, place debtor into category A/B/C, give different offer by category, then track current month result."

### Festive Gift Style

Campaign Type: Festive / Seasonal Gift

Mechanisms:

- Manual debtor list + exact package
- Gift entitlement / delivery tracking
- Optional current month purchase condition

This supports festive campaigns where Admin already has the approved debtor list and exact gift package.

## Admin UI Behavior

The Campaign Type dropdown should sit at the top and use plain business labels.

Below it, Admin should show a Mechanism Builder with cards. Each card should have:

- a short title,
- a one-line explanation,
- fields only for that mechanism,
- a compact preview of what agents or management will see.

The form should avoid showing conversion lookback fields when the selected mechanism is only a manual FOC list. It should also avoid hiding FOC package fields when the campaign type is not "Free Sample" but the mechanism still needs a gift.

## Data Flow

Admin saves campaign settings to existing Supabase campaign tables.

Generated JSON remains the source of truth for Sales Dashboard and Management report calculations after `update_dashboard.bat` runs.

Sales Dashboard should stay action-focused:

- show the agent's own eligible debtors,
- show exact FOC or gift package,
- show qualification reason,
- show claim/delivered state,
- show simple conversion progress.

Management should stay comparison-focused:

- show all-agent or group standings,
- show PK winners,
- show conversion and CTN totals,
- expose drilldowns for audit.

## Error Handling

If Admin cannot save to Supabase, it should clearly say the campaign was not saved and should not pretend local changes are live.

If a mechanism has missing required values, Admin should block campaign creation with a field-specific warning. Examples:

- Manual debtor list requires debtor code.
- Gift delivery requires either debtor-level package or campaign default package.
- Lookback conversion requires at least one match value and at least one lookback month.
- Volume segment offer matrix requires a volume basis and at least one category row.

Existing direct HTML pages should continue to load even if a campaign uses a mechanism that the page does not yet fully render.

## First Implementation Scope

The first pass should focus on Admin clarity and reusable setup:

- rename the old mixed "Campaign Mechanism Builder" into mechanism cards,
- split Campaign Type from mechanism selection,
- support a single main mechanism plus optional gift/delivery and PK add-ons,
- keep saved data compatible with existing Supabase tables,
- keep Sales and Management behavior unchanged unless the generated data already supports the mechanism.

True multi-mechanism storage can be added later only if the existing fields become too limiting.

## Testing

Admin should be checked with these campaign examples:

- Festive gift using manual debtor list and exact package.
- IFACE-style no-lookback brand penetration campaign.
- BISON-style volume segment offer matrix.
- Simple current-month purchase campaign.

For each example:

- Admin should show only relevant fields.
- Preview should explain eligibility and package clearly.
- Save should preserve existing Supabase compatibility.
- Generated Sales Dashboard should not break.
- Generated Management view should not break.

