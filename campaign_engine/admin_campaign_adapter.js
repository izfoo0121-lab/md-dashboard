(function(root, factory) {
  const engine = root.PFMDCampaignEngine || {};
  const model = engine.model || (typeof require === 'function' ? require('./campaign_model.js') : null);
  const validation = engine.validation || (typeof require === 'function' ? require('./campaign_validation.js') : null);
  const repository = engine.repository || (typeof require === 'function' ? require('./campaign_repository.js') : null);
  const api = factory(model, validation, repository);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PFMDCampaignEngine = Object.assign(root.PFMDCampaignEngine || {}, { admin: api });
})(typeof window !== 'undefined' ? window : globalThis, function(model, validation, repository) {
  function assertDependency(name, dep) {
    if (!dep) throw new Error('PFMDCampaignEngine.admin missing dependency: ' + name);
    return dep;
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value == null || value === '') return [];
    return [value];
  }

  function getValue(ctx, id) {
    if (!ctx || typeof ctx.getValue !== 'function') {
      throw new Error('buildCampaignDraftFromAdminForm requires ctx.getValue');
    }
    return ctx.getValue(id);
  }

  function getCheckedValues(ctx, selector) {
    if (!ctx || typeof ctx.getCheckedValues !== 'function') {
      throw new Error('buildCampaignDraftFromAdminForm requires ctx.getCheckedValues');
    }
    return asArray(ctx.getCheckedValues(selector));
  }

  function getCampaignFileDebtors(ctx) {
    if (!ctx || typeof ctx.getCampaignFileDebtors !== 'function') {
      throw new Error('buildCampaignDraftFromAdminForm requires ctx.getCampaignFileDebtors');
    }
    return asArray(ctx.getCampaignFileDebtors());
  }

  function readTargetGroups(ctx) {
    if (ctx && typeof ctx.readTargetGroups === 'function') return asArray(ctx.readTargetGroups());
    return asArray(ctx && ctx.defaultTargetGroups);
  }

  function readPrepareOptions(ctx) {
    if (!ctx) return {};
    if (typeof ctx.getPrepareCampaignDebtorOptions === 'function') {
      return ctx.getPrepareCampaignDebtorOptions() || {};
    }
    const options = {};
    if (typeof ctx.readBrandPenetrationAgentGroupMap === 'function') {
      options.groupMap = ctx.readBrandPenetrationAgentGroupMap() || {};
    }
    if (typeof ctx.brandPenetrationDefaultGroup === 'function') {
      options.defaultGroup = ctx.brandPenetrationDefaultGroup() || '';
    }
    return options;
  }

  function prepareDebtors(ctx, rawDebtors) {
    const debtors = asArray(rawDebtors);
    if (!ctx || typeof ctx.prepareCampaignDebtorForSave !== 'function') {
      return debtors.slice();
    }
    const options = readPrepareOptions(ctx);
    return debtors.map(function(row) {
      return ctx.prepareCampaignDebtorForSave(row, options);
    });
  }

  function filterDebtors(ctx, preparedDebtors, targetGroups) {
    if (ctx && typeof ctx.filterCampaignDebtorsByTargetGroups === 'function') {
      return asArray(ctx.filterCampaignDebtorsByTargetGroups(preparedDebtors, targetGroups));
    }
    return asArray(preparedDebtors);
  }

  function coverageIssue(ctx, debtors, targetGroups) {
    if (!ctx) return false;
    if (typeof ctx.campaignListingCoverageIssue === 'function') {
      return !!ctx.campaignListingCoverageIssue(debtors, targetGroups);
    }
    if (typeof ctx.getCampaignListingCoverageIssue === 'function') {
      return !!ctx.getCampaignListingCoverageIssue(debtors, targetGroups);
    }
    if (typeof ctx.validateListingCoverage === 'function') {
      const result = ctx.validateListingCoverage(debtors, targetGroups, { silent: true });
      if (result && typeof result === 'object') {
        return Array.isArray(result.errors) && result.errors.length > 0;
      }
      return result === false;
    }
    return false;
  }

  function generatedBrandPenetrationListing(ctx, rawDebtors) {
    if (!ctx) return false;
    if (typeof ctx.campaignListingIsGeneratedBrandPenetration === 'function') {
      return !!ctx.campaignListingIsGeneratedBrandPenetration(rawDebtors);
    }
    if (typeof ctx.isGeneratedBrandPenetrationListing === 'function') {
      return !!ctx.isGeneratedBrandPenetrationListing(rawDebtors);
    }
    return false;
  }

  async function buildPreparedDebtors(ctx, targetGroups) {
    const rawDebtors = getCampaignFileDebtors(ctx);
    const preparedDebtors = prepareDebtors(ctx, rawDebtors);
    return {
      rawDebtors: rawDebtors,
      preparedDebtors: filterDebtors(ctx, preparedDebtors, targetGroups),
    };
  }

  function readKpiNumerators(ctx) {
    if (ctx && typeof ctx.readKpiNumerators === 'function') {
      return asArray(ctx.readKpiNumerators('new-camp'));
    }
    return [];
  }

  function readCatRules(ctx) {
    if (ctx && typeof ctx.getCatRules === 'function') return ctx.getCatRules();
    return null;
  }

  function readMechanismNotes(ctx, type, targetGroups) {
    const notes = ctx && typeof ctx.readCampaignMechanism === 'function'
      ? ctx.readCampaignMechanism('new-camp', type)
      : {};
    if (ctx && typeof ctx.mergeCampaignTargetGroupsIntoNotes === 'function') {
      return ctx.mergeCampaignTargetGroupsIntoNotes(notes, targetGroups);
    }
    return notes || {};
  }

  function listingCoverageFailedResult() {
    return {
      ok: false,
      errors: [{ code: 'listing_coverage_failed', message: 'Campaign listing coverage check failed.' }],
      warnings: [],
    };
  }

  function normalizeValidationArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeListingCoverageResult(result) {
    if (result === false) return listingCoverageFailedResult();
    if (result === true) return { ok: true, errors: [], warnings: [] };
    if (result && typeof result === 'object') {
      const errors = normalizeValidationArray(result.errors);
      const warnings = normalizeValidationArray(result.warnings);
      if (result.ok === false && !errors.length) return listingCoverageFailedResult();
      return {
        ok: result.ok === false ? false : errors.length === 0,
        errors: errors,
        warnings: warnings,
      };
    }
    return { ok: true, errors: [], warnings: [] };
  }

  function validationContext(ctx) {
    const context = ctx || {};
    if (typeof context.validateListingCoverage !== 'function') return context;
    const originalValidateListingCoverage = context.validateListingCoverage;
    return Object.assign({}, context, {
      validateListingCoverage: function(debtors, targetGroups, options) {
        const coverageOptions = options || { silent: true };
        return normalizeListingCoverageResult(
          originalValidateListingCoverage.call(context, debtors, targetGroups, coverageOptions),
        );
      },
    });
  }

  function modelContext(ctx) {
    const context = ctx || {};
    if (typeof context.monthStart !== 'function') return context;
    return Object.assign({}, context, {
      monthStart: context.monthStart.call(context),
    });
  }

  async function buildCampaignDraftFromAdminForm(ctx) {
    assertDependency('model', model);
    const context = ctx || {};
    const type = getValue(context, 'new-camp-type');
    const targetGroups = readTargetGroups(context);
    let debtorState = await buildPreparedDebtors(context, targetGroups);

    if (
      coverageIssue(context, debtorState.preparedDebtors, targetGroups) &&
      generatedBrandPenetrationListing(context, debtorState.rawDebtors) &&
      typeof context.regenerateBrandPenetrationListingForTargetGroups === 'function'
    ) {
      await context.regenerateBrandPenetrationListingForTargetGroups(targetGroups);
      debtorState = await buildPreparedDebtors(context, targetGroups);
    }

    const rawDraft = {
      type: type,
      name: getValue(context, 'new-camp-name'),
      description: getValue(context, 'new-camp-desc'),
      start_date: getValue(context, 'new-camp-start-date'),
      deadline: getValue(context, 'new-camp-deadline'),
      active: true,
      brands: type === 'promotion' ? getCheckedValues(context, '#brand-checkboxes input:checked') : [],
      promo_detail: getValue(context, 'new-camp-promo'),
      min_order_ctn: getValue(context, 'new-camp-min-order'),
      cat_rules: readCatRules(context),
      default_foc_item: getValue(context, 'new-camp-foc-item'),
      default_foc_qty: getValue(context, 'new-camp-foc-qty'),
      default_foc_unit: getValue(context, 'new-camp-foc-unit') || 'packs',
      foc_note: getValue(context, 'new-camp-foc-note'),
      festive_occasion: getValue(context, 'new-camp-festive'),
      kpi_numerators: readKpiNumerators(context),
      notes: readMechanismNotes(context, type, targetGroups),
      target_groups: targetGroups,
      debtors: debtorState.preparedDebtors,
    };

    return model.normalizeCampaignDraft(rawDraft, modelContext(context));
  }

  function formatValidationIssue(issue) {
    if (typeof issue === 'string') return issue;
    if (!issue || typeof issue !== 'object') return 'Campaign validation issue.';
    const message = issue.message || issue.code || 'Campaign validation issue.';
    if (Array.isArray(issue.detail) && issue.detail.length) {
      return message + ' (' + issue.detail.slice(0, 8).join(', ') + (issue.detail.length > 8 ? ' +' + (issue.detail.length - 8) + ' more' : '') + ')';
    }
    if (issue.detail != null && issue.detail !== '') return message + ' (' + issue.detail + ')';
    return message;
  }

  function formatValidation(result) {
    const validationResult = result || {};
    const errors = Array.isArray(validationResult.errors) ? validationResult.errors : [];
    const warnings = Array.isArray(validationResult.warnings) ? validationResult.warnings : [];
    const lines = [];
    if (errors.length) lines.push(errors.map(formatValidationIssue).join('\n'));
    if (warnings.length) lines.push('Warnings:\n' + warnings.map(formatValidationIssue).join('\n'));
    return lines.join('\n\n') || 'Campaign validation failed.';
  }

  function formatRepositoryFailure(result) {
    const failure = result || {};
    const lines = ['Failed to save campaign to Supabase.'];
    if (failure.error && failure.error.message) {
      lines.push(String(failure.error.message).slice(0, 700));
    }
    if (failure.rollback && failure.rollback.attempted) {
      lines.push(failure.rollback.ok ? 'Rollback completed.' : 'Rollback failed. Check Supabase for partial campaign rows.');
      if (failure.rollback.error && failure.rollback.error.message) {
        lines.push('Rollback error: ' + String(failure.rollback.error.message).slice(0, 700));
      }
    } else {
      lines.push('Rollback was not needed because the campaign row was not inserted.');
    }
    return lines.join('\n\n');
  }

  function alertMessage(ctx, message) {
    if (ctx && typeof ctx.alert === 'function') ctx.alert(message);
  }

  async function createCampaignFromAdminForm(ctx) {
    assertDependency('validation', validation);
    assertDependency('repository', repository);
    const context = ctx || {};
    const draft = await buildCampaignDraftFromAdminForm(context);
    const validationResult = validation.validateCampaignDraft(draft, validationContext(context));

    if (!validationResult.ok) {
      alertMessage(context, formatValidation(validationResult));
      return { ok: false, validation: validationResult };
    }

    const result = await repository.createCampaign({
      supabaseFetch: context.supabaseFetch,
      now: context.now || function() { return new Date(); },
      chunkSize: context.chunkSize || 500,
    }, draft);

    if (!result.ok) {
      alertMessage(context, formatRepositoryFailure(result));
      return result;
    }

    if (typeof context.onCampaignCreateSuccess === 'function') {
      await context.onCampaignCreateSuccess(draft);
    }

    return result;
  }

  return {
    buildCampaignDraftFromAdminForm: buildCampaignDraftFromAdminForm,
    createCampaignFromAdminForm: createCampaignFromAdminForm,
  };
});
