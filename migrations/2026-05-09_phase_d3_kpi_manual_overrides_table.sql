-- Phase D.3: Create kpi_manual_overrides table
-- Applied: 2026-05-11 via Supabase SQL editor (manual run)
--
-- Context: Per-campaign KPI rebuild. Stores dynamic manual achievement
-- overrides separately from the fixed-column kpi_manual table.
--
-- Rows are keyed by month + agent + kpi_key, where kpi_key can be a
-- per-campaign numerator key such as camp_1778113461122_count or
-- camp_1778113461122_ctn.

CREATE TABLE IF NOT EXISTS public.kpi_manual_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month text NOT NULL,
  agent text NOT NULL,
  kpi_key text NOT NULL,
  value numeric NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_kpi_manual_overrides_lookup
  ON public.kpi_manual_overrides (month, agent, kpi_key);

CREATE INDEX IF NOT EXISTS idx_kpi_manual_overrides_kpi_key
  ON public.kpi_manual_overrides (kpi_key);

ALTER TABLE public.kpi_manual_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated" ON public.kpi_manual_overrides;

CREATE POLICY "Allow all for authenticated" ON public.kpi_manual_overrides
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Verification (run separately):
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'kpi_manual_overrides'
-- ORDER BY ordinal_position;
