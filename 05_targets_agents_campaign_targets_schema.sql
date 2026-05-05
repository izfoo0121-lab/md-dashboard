-- Add agent-scoped per-campaign KPI targets.
-- Run in Supabase SQL editor before deploying admin/save changes that write this field.

ALTER TABLE targets_agents
ADD COLUMN IF NOT EXISTS campaign_targets JSONB DEFAULT '{}'::jsonb;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'targets_agents'
  AND column_name = 'campaign_targets';
