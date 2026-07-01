import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import process_data


class DistributionCampaignKpiTests(unittest.TestCase):
    def test_distribution_campaign_scores_delivered_against_listed_target(self):
        camp = {
            "id": "sukun_july_sampling",
            "name": "SUKUN JULY SAMPLING",
            "type": "free_sample",
            "kpi_numerators": ["distribution"],
            "distribution_targets": {"XIAN": 52},
        }

        items = process_data.build_per_campaign_kpi_items(
            agent_code="XIAN",
            ag_cfg={"campaign_targets": {}},
            active_campaigns=[camp],
            deliveries_by_camp_agent={
                ("sukun_july_sampling", "XIAN"): ["300-A001", "300-A002", "300-A002"]
            },
            overrides_by_agent_key={},
            conversion_rollup={},
            month_weights={"camp_sukun_july_sampling_distribution": 0.05},
        )

        item = items["camp_sukun_july_sampling_distribution"]
        self.assertEqual(item["numerator"], "distribution")
        self.assertEqual(item["target"], 52)
        self.assertEqual(item["actual"], 2)
        self.assertEqual(item["source"], "auto_distribution_delivered")
        self.assertAlmostEqual(item["score"], round((2 / 52) * 5, 3))

    def test_distribution_campaign_deducts_manager_removed_debtors_from_target(self):
        camp = {
            "id": "sukun_july_sampling",
            "name": "SUKUN JULY SAMPLING",
            "type": "free_sample",
            "kpi_numerators": ["distribution"],
            "distribution_targets": {"XIAN": 52},
            "distribution_exclusions": {"XIAN": ["300-A001", "300-A002", "300-A002"]},
        }

        items = process_data.build_per_campaign_kpi_items(
            agent_code="XIAN",
            ag_cfg={"campaign_targets": {}},
            active_campaigns=[camp],
            deliveries_by_camp_agent={
                ("sukun_july_sampling", "XIAN"): ["300-A003", "300-A004"]
            },
            overrides_by_agent_key={},
            conversion_rollup={},
            month_weights={"camp_sukun_july_sampling_distribution": 0.05},
        )

        item = items["camp_sukun_july_sampling_distribution"]
        self.assertEqual(item["target"], 50)
        self.assertEqual(item["distribution_listed_target"], 52)
        self.assertEqual(item["distribution_removed_target"], 2)
        self.assertAlmostEqual(item["score"], round((2 / 50) * 5, 3))

    def test_campaign_target_exclusions_only_use_manager_off_claims(self):
        rows = [
            {"camp_id": "camp1", "agent": "XIAN", "debtor_code": "300-A001", "status": "excluded", "actor": "management_bulk_off"},
            {"camp_id": "camp1", "agent": "XIAN", "debtor_code": "300-A002", "status": "excluded", "actor": "agent"},
            {"camp_id": "camp1", "agent": "XIAN", "debtor_code": "300-A003", "status": "submitted", "actor": "management_bulk_off"},
            {"camp_id": "camp1", "agent": "BEN", "debtor_code": "300-B001", "status": "excluded", "actor": "campaign_audit_bulk_off"},
        ]

        exclusions = process_data._campaign_target_exclusion_sets(rows)

        self.assertEqual(exclusions[("camp1", "XIAN")], {"300-A001"})
        self.assertEqual(exclusions[("camp1", "BEN")], {"300-B001"})
        self.assertNotIn(("camp1", "CJ"), exclusions)

    def test_none_campaign_numerator_is_tracking_only(self):
        items = process_data.build_per_campaign_kpi_items(
            agent_code="XIAN",
            ag_cfg={"campaign_targets": {"camp_tracking_only_count": 10}},
            active_campaigns=[{
                "id": "tracking_only",
                "name": "Tracking Only",
                "type": "free_sample",
                "kpi_numerators": ["none"],
            }],
            deliveries_by_camp_agent={("tracking_only", "XIAN"): ["300-A001"]},
            overrides_by_agent_key={},
            conversion_rollup={},
            month_weights={"camp_tracking_only_count": 0.05},
        )

        self.assertEqual(items, {})


if __name__ == "__main__":
    unittest.main()
