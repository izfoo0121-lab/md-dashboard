-- Phase D.1: Create campaign_deliveries table
-- Applied: 2026-05-11 via Supabase SQL editor (manual run)
--
-- Context: Per-campaign KPI rebuild. Phase D adds delivery tracking
-- so non-auto-detected campaign achievements can feed KPI scoring.
--
-- This table stores delivered debtor snapshots by campaign, agent, and month.
-- Agent attribution is captured at upload time.

CREATE TABLE IF NOT EXISTS public.campaign_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id text NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  debtor_code text NOT NULL,
  agent text NOT NULL,
  month text NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('list_upload', 'manual_count')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_deliveries_lookup
  ON public.campaign_deliveries (campaign_id, agent, month);

CREATE INDEX IF NOT EXISTS idx_campaign_deliveries_debtor
  ON public.campaign_deliveries (campaign_id, debtor_code);

-- Prevent the same debtor from being counted twice for the same campaign/month
-- when delivery rows come from list upload.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_campaign_deliveries_debtor_month
  ON public.campaign_deliveries (campaign_id, debtor_code, month)
  WHERE source = 'list_upload';

ALTER TABLE public.campaign_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated" ON public.campaign_deliveries;

CREATE POLICY "Allow all for authenticated" ON public.campaign_deliveries
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Verification (run separately):
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'campaign_deliveries'
-- ORDER BY ordinal_position;
