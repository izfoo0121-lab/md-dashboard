-- Phase C: Migrate campaign_targets keys from camp_<id> to camp_<id>_count
-- Applied: 2026-05-09 via Supabase SQL editor (manual run)
-- 
-- Context: Per-campaign KPI rebuild. Phase A added kpi_numerators column.
-- Phase B updated admin UI to read/write new key format.
-- Phase C migrates existing data to match new format.
--
-- Affected: 14 agents with EVO MAY 2026 conversion targets.
-- TR12 had no existing targets (dual-numerator, fresh setup pending).

UPDATE targets_agents ta
SET campaign_targets = (
  SELECT jsonb_object_agg(
    CASE
      WHEN key LIKE 'camp_%'
        AND key NOT LIKE '%_count'
        AND key NOT LIKE '%_ctn'
      THEN key || '_count'
      ELSE key
    END,
    value
  )
  FROM jsonb_each(ta.campaign_targets)
),
updated_at = now()
WHERE campaign_targets IS NOT NULL
  AND campaign_targets != '{}'::jsonb
  AND EXISTS (
    SELECT 1
    FROM jsonb_each(ta.campaign_targets) e
    WHERE e.key LIKE 'camp_%'
      AND e.key NOT LIKE '%_count'
      AND e.key NOT LIKE '%_ctn'
  );

-- Verification (run separately):
-- SELECT agent, campaign_targets FROM targets_agents
-- WHERE campaign_targets IS NOT NULL AND campaign_targets != '{}'::jsonb
-- ORDER BY agent;
