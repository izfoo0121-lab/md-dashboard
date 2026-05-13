-- Revert Definition B EVO MAY re-enrollment batch.
--
-- Business rule confirmed after the Definition B test:
-- Definition A is the chosen rule. A debtor is disqualified from EVO MAY
-- enrollment if the debtor bought EVO in Feb-Apr 2026 from any agent.
--
-- The reverted batch was inserted by the temporary Definition B re-enrollment
-- run and is identifiable as one Supabase insert batch:
--   campaign_id = camp_1777773301331
--   created_at  = 2026-05-13 02:12:41.826938+00
--   row count   = 242
--
-- This removes those temporary rows without touching the original enrollment,
-- the 2026-05-12 v2 expansion rows, or admin-entered delivery/claim data.

DELETE FROM public.campaign_debtors
WHERE campaign_id = 'camp_1777773301331'
  AND created_at = '2026-05-13 02:12:41.826938+00'::timestamptz;

/* Verification after running:
SELECT COUNT(*) AS total
FROM public.campaign_debtors
WHERE campaign_id = 'camp_1777773301331';

SELECT *
FROM public.campaign_debtors
WHERE campaign_id = 'camp_1777773301331'
  AND debtor_code IN ('300-C222', '300-H231', '300-JK014', '300-JK020', '300-JK098');

Expected:
- total drops from 1331 to 1089
- the five listed XIAN historical EVO buyers return zero rows
*/
