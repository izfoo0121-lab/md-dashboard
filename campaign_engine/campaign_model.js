(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PFMDCampaignEngine = Object.assign(root.PFMDCampaignEngine || {}, { model: api });
})(typeof window !== 'undefined' ? window : globalThis, function() {
  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function upper(value) {
    return text(value).toUpperCase();
  }

  function numOrNull(value) {
    const raw = text(value);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeFocUnit(value) {
    const raw = text(value).toLowerCase();
    const units = {
      ctn: 'ctn',
      carton: 'ctn',
      cartons: 'ctn',
      pack: 'packs',
      packs: 'packs',
      pkt: 'packs',
      pkts: 'packs',
      packet: 'packs',
      packets: 'packs',
      box: 'box',
      boxes: 'box',
      piece: 'piece',
      pieces: 'piece',
      pc: 'piece',
      pcs: 'piece',
    };
    return units[raw] || raw;
  }

  function asDate(now) {
    if (typeof now === 'function') return now();
    return new Date();
  }

  function campaignId(now) {
    const date = asDate(now);
    const timestamp = date && typeof date.getTime === 'function' ? date.getTime() : Date.now();
    return 'camp_' + timestamp;
  }

  function campaignMonthStart(adapter) {
    if (adapter && adapter.monthStart) return text(adapter.monthStart);
    if (adapter && typeof adapter.getMonthStart === 'function') return text(adapter.getMonthStart());
    return new Date().toISOString().slice(0, 7) + '-01';
  }

  function toArray(value) {
    const raw = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
    return raw.flatMap(entry => (typeof entry === 'string' ? entry.split(/[,\n]/) : [entry]));
  }

  function unique(values, normalizer) {
    const seen = new Set();
    const out = [];
    toArray(values).forEach(value => {
      const normalized = normalizer(value);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    });
    return out;
  }

  function normalizeBool(value) {
    if (value === true || value === 1) return true;
    const raw = text(value).toLowerCase();
    return raw === 'true' || raw === 'yes' || raw === 'y' || raw === 'approved' || raw === '1';
  }

  function mechanismFor(notes, type) {
    const explicit = text(notes && notes.mechanism_type);
    if (explicit) return explicit;
    const campaignType = text(type);
    if (campaignType.indexOf('conversion_') === 0) return 'conversion';
    if (Array.isArray(notes && notes.reward_tiers) && notes.reward_tiers.length) return 'volume_reward';
    if (campaignType === 'birthday_gift' || campaignType === 'festive_gift' || campaignType === 'free_sample') return 'delivery_gift';
    return 'manual_claim';
  }

  function normalizeCampaignMechanism(notes, type) {
    const source = notes && typeof notes === 'object' && !Array.isArray(notes) ? notes : {};
    const mechanism = mechanismFor(source, type);
    const qualifyingValues = unique(
      source.qualifying_values || source.qualifying_value || source.qualifying_item_group || source.match_values,
      upper,
    );
    const lookbackMonths = unique(source.lookback_months, text);
    const out = {
      ...source,
      mechanism_type: mechanism,
      qualifying_match: text(source.qualifying_match || source.match_by || 'item_group'),
      qualifying_value: upper(source.qualifying_value || qualifyingValues[0]),
      qualifying_values: mechanism === 'conversion' || mechanism === 'volume_reward' || mechanism === 'linked_conversion_repeat'
        ? qualifyingValues
        : [],
      qualifying_item_group: upper(source.qualifying_item_group || source.qualifying_value || qualifyingValues[0]),
      min_rm_per_ctn: numOrNull(source.min_rm_per_ctn ?? source.price_floor),
      lookback_months: mechanism === 'conversion' || mechanism === 'linked_conversion_repeat' ? lookbackMonths : [],
      conversion_rule: text(source.conversion_rule || 'no_lookback_then_current'),
      volume_basis: text(source.volume_basis || 'current_month'),
      sort_by: text(source.sort_by || 'ctn_desc'),
      reward_tiers: Array.isArray(source.reward_tiers) ? source.reward_tiers : [],
      follow_up_enabled: normalizeBool(source.follow_up_enabled),
      follow_up_months: numOrNull(source.follow_up_months) ?? 2,
      follow_up_match: text(source.follow_up_match || source.qualifying_match || 'item_group'),
      follow_up_values: unique(source.follow_up_values, upper),
    };

    if (mechanism === 'linked_conversion_repeat') {
      out.linked_conversion_target_pct = numOrNull(source.linked_conversion_target_pct) ?? 20;
      out.linked_repeat_target_pct = numOrNull(source.linked_repeat_target_pct) ?? 30;
      out.linked_conversion_units = numOrNull(source.linked_conversion_units) ?? 20;
      out.linked_repeat_units = numOrNull(source.linked_repeat_units) ?? 30;
      out.linked_internal_target = numOrNull(source.linked_internal_target) ?? 50;
      out.stage1_foc_item = upper(source.stage1_foc_item || 'SUKUN');
      out.stage1_foc_qty = numOrNull(source.stage1_foc_qty) ?? 3;
      out.stage1_foc_unit = normalizeFocUnit(source.stage1_foc_unit || 'packs');
      out.stage1_foc_note = text(source.stage1_foc_note || '[1ST OD]');
      out.stage2_min_ctn = numOrNull(source.stage2_min_ctn) ?? 3;
      out.stage2_foc_item = upper(source.stage2_foc_item || 'SUKUN');
      out.stage2_foc_qty = numOrNull(source.stage2_foc_qty) ?? 1;
      out.stage2_foc_unit = normalizeFocUnit(source.stage2_foc_unit || 'ctn');
      out.stage2_foc_note = text(source.stage2_foc_note || '[RP OD]');
    }

    return out;
  }

  function normalizeCampaignDebtor(row, adapter) {
    const source = row || {};
    const normalizeAgent = adapter && typeof adapter.normalizeAgent === 'function' ? adapter.normalizeAgent : upper;
    const code = upper(source.code || source.debtor_code);
    const name = text(source.name || source.debtor_name);
    const cat = text(source.cat);
    const catGroup = text(source.cat_group) || (cat ? cat.charAt(0).toUpperCase() : '');
    const focItem2 = upper(source.foc_item_2 || source.foc_item2);
    const focQty2 = numOrNull(source.foc_qty_2 ?? source.foc_qty2);
    return {
      code,
      debtor_code: code,
      name,
      debtor_name: name,
      agent: normalizeAgent(source.agent),
      cat,
      cat_group: catGroup,
      debtor_type: text(source.debtor_type),
      foc_item: upper(source.foc_item),
      foc_qty: numOrNull(source.foc_qty),
      foc_unit: normalizeFocUnit(source.foc_unit),
      foc_type: text(source.foc_type),
      rebate: numOrNull(source.rebate),
      foc_item2: focItem2,
      foc_qty2: focQty2,
      foc_item_2: focItem2,
      foc_qty_2: focQty2,
      foc_unit_2: normalizeFocUnit(source.foc_unit_2 || source.foc_unit2),
      avg_ctn: numOrNull(source.avg_ctn),
      promo_logic: text(source.promo_logic),
      eligibility_reason: text(source.eligibility_reason || source.promo_logic || source.notes),
      approval: normalizeBool(source.approval),
      approval_note: text(source.approval_note),
      notes: text(source.notes),
    };
  }

  function normalizeCampaignDraft(rawDraft, adapter) {
    const draft = rawDraft || {};
    const normalizeGroup = adapter && typeof adapter.normalizeGroup === 'function' ? adapter.normalizeGroup : text;
    const targetSource = toArray(draft.target_groups).length
      ? draft.target_groups
      : (adapter && Array.isArray(adapter.defaultTargetGroups) ? adapter.defaultTargetGroups : ['all']);
    return {
      id: text(draft.id) || campaignId(adapter && adapter.now),
      name: text(draft.name),
      type: text(draft.type) || 'other',
      description: text(draft.description),
      start_date: text(draft.start_date) || campaignMonthStart(adapter),
      deadline: text(draft.deadline),
      active: draft.active !== false,
      brands: unique(draft.brands || (draft.brand ? [draft.brand] : []), upper),
      promo_detail: text(draft.promo_detail),
      min_order_ctn: numOrNull(draft.min_order_ctn),
      cat_rules: draft.cat_rules && typeof draft.cat_rules === 'object' && !Array.isArray(draft.cat_rules) ? draft.cat_rules : {},
      default_foc_item: upper(draft.default_foc_item),
      default_foc_qty: numOrNull(draft.default_foc_qty),
      default_foc_unit: normalizeFocUnit(draft.default_foc_unit || 'packs'),
      default_foc_type: text(draft.default_foc_type),
      default_foc_item_2: upper(draft.default_foc_item_2 || draft.foc_item2),
      default_foc_qty_2: numOrNull(draft.default_foc_qty_2 ?? draft.foc_qty2),
      default_foc_unit_2: normalizeFocUnit(draft.default_foc_unit_2 || draft.foc_unit2),
      foc_note: text(draft.foc_note),
      festive_occasion: text(draft.festive_occasion),
      conditions: Array.isArray(draft.conditions) ? draft.conditions : [],
      no_cap: !!draft.no_cap,
      kpi_numerators: unique(draft.kpi_numerators, text),
      notes: normalizeCampaignMechanism(draft.notes, draft.type),
      target_groups: unique(targetSource, normalizeGroup),
      debtors: (Array.isArray(draft.debtors) ? draft.debtors : []).map(row => normalizeCampaignDebtor(row, adapter)).filter(row => row.debtor_code),
    };
  }

  return {
    text,
    upper,
    numOrNull,
    normalizeFocUnit,
    campaignId,
    campaignMonthStart,
    normalizeCampaignMechanism,
    normalizeCampaignDebtor,
    normalizeCampaignDraft,
  };
});
