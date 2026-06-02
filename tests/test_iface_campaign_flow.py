import unittest
from pathlib import Path
import sys

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import process_data


class IfaceCampaignFlowTests(unittest.TestCase):
    def test_brand_penetration_candidate_sets_generate_selectable_brands(self):
        debtor_info = {
            "300-SUKUN-LAPSED": {
                "name": "Lapsed SUKUN", "agent": "BEN", "type": "SH-Shop",
                "open_date": "2024-01-10", "dm_active": True,
            },
            "300-BISON-NEW": {
                "name": "New BISON", "agent": "CJ", "type": "SH-Shop",
                "open_date": "2026-06-03", "dm_active": True,
            },
            "300-BISON-RECENT": {
                "name": "Recent BISON", "agent": "KF", "type": "SH-Shop",
                "open_date": "2024-01-10", "dm_active": True,
            },
        }
        df = pd.DataFrame([
            {"debtor_code": "300-SUKUN-LAPSED", "item_group": "SUKUN", "item_code": "SKNR", "paid_on": "Feb 26", "tranx_mth_full": "Feb 26", "qty_ctn": 2},
            {"debtor_code": "300-BISON-RECENT", "item_group": "BISON", "item_code": "BISON-R", "paid_on": "May 26", "tranx_mth_full": "May 26", "qty_ctn": 1},
        ])

        current, by_month, presets = process_data.build_brand_penetration_candidate_sets(
            debtor_info=debtor_info,
            df=df,
            agents=["BEN", "CJ", "KF"],
            month_labels=["Jun 26"],
            brand_config={
                "SUKUN": ["SKNR", "SKNW"],
                "BISON": ["BISON-R", "BISON-M"],
            },
        )

        self.assertIn("SUKUN", current)
        self.assertIn("BISON", current)
        self.assertIn("Jun 26", by_month["SUKUN"])
        self.assertEqual(presets["SUKUN"]["match_values"], ["SUKUN", "SKNR", "SKNW"])
        self.assertEqual(
            {row["debtor_code"] for row in current["SUKUN"]},
            {"300-SUKUN-LAPSED", "300-BISON-NEW", "300-BISON-RECENT"},
        )
        self.assertEqual(
            {row["debtor_code"] for row in current["BISON"]},
            {"300-SUKUN-LAPSED", "300-BISON-NEW"},
        )
        self.assertEqual(
            {row["debtor_code"] for row in by_month["BISON"]["Jun 26"]},
            {"300-SUKUN-LAPSED", "300-BISON-NEW"},
        )

    def test_brand_penetration_filter_options_include_matches_types_and_months(self):
        debtor_info = {
            "300-A": {"name": "A", "agent": "BEN", "type": "SH-Shop", "dm_active": True},
            "300-B": {"name": "B", "agent": "CJ", "type": "P-Personal", "dm_active": True},
            "300-C": {"name": "C", "agent": "KF", "type": "End User", "dm_active": False},
        }
        df = pd.DataFrame([
            {"item_group": "IFACE", "item_code": "IFACE R", "paid_on": "May 26", "tranx_mth_full": "May 26"},
            {"item_group": "SUKUN", "item_code": "SKNR", "paid_on": "Apr 26", "tranx_mth_full": "Apr 26"},
            {"item_group": "EVO", "item_code": "DPM EVO", "paid_on": "Mar 26", "tranx_mth_full": "Mar 26"},
            {"item_group": "BISON", "item_code": "BISON-R", "paid_on": "NoComm", "tranx_mth_full": "NoComm"},
            {"item_group": "TR20", "item_code": "TR20", "paid_on": "Oct 25", "tranx_mth_full": "Oct 25"},
        ])

        options = process_data.build_brand_penetration_filter_options(
            debtor_info=debtor_info,
            df=df,
            month_labels=["May 26", "Jun 26", "Feb 26"],
        )

        self.assertIn("IFACE", options["match_values"])
        self.assertIn("IFACE R", options["match_values"])
        self.assertIn("SKNR", options["match_values"])
        self.assertEqual(options["item_group_values"], ["BISON", "EVO", "IFACE", "SUKUN", "TR20"])
        self.assertIn("DPM EVO", options["item_code_values"])
        self.assertIn("SH-Shop", options["debtor_types"])
        self.assertIn("P-Personal", options["debtor_types"])
        self.assertIn("End User", options["debtor_types"])
        self.assertEqual(options["months"], ["Jun 26", "May 26", "Apr 26", "Mar 26", "Feb 26", "Oct 25", "NoComm"])
        self.assertEqual(options["default_exclude_types"], ["Personal", "End User"])

    def test_brand_penetration_source_supports_browser_recompute(self):
        debtor_info = {
            "300-A": {"name": "A Shop", "agent": "BEN", "type": "SH-Shop", "open_date": "2026-06-03", "dm_active": True},
            "300-B": {"name": "B Shop", "agent": "CJ", "type": "P-Personal", "open_date": "2024-01-10", "dm_active": True},
        }
        df = pd.DataFrame([
            {"debtor_code": "300-A", "item_group": "IFACE", "item_code": "IFACE R", "paid_on": "Feb 26", "tranx_mth_full": "Feb 26", "qty_ctn": 2},
            {"debtor_code": "300-B", "item_group": "SUKUN", "item_code": "SKNR", "paid_on": "May 26", "tranx_mth_full": "May 26", "qty_ctn": 1},
        ])

        source = process_data.build_brand_penetration_source_data(
            debtor_info=debtor_info,
            df=df,
            agents=["BEN", "CJ"],
        )

        self.assertEqual(len(source["debtors"]), 2)
        self.assertEqual(source["debtors"][0]["open_month"], "Jun 26")
        self.assertIn(
            {"debtor_code": "300-A", "item_group": "IFACE", "item_code": "IFACE R", "month": "Feb 26"},
            source["purchases"],
        )

    def test_generic_brand_penetration_candidates_support_iface_without_fixed_groups(self):
        debtor_info = {
            "300-NEW": {
                "name": "New Shop", "agent": "BEN", "type": "SH-Shop",
                "open_date": "2026-06-03", "dm_active": True,
            },
            "300-LAPSED": {
                "name": "Lapsed IFACE", "agent": "CJ", "type": "SH-Shop",
                "open_date": "2024-01-10", "dm_active": True,
            },
            "300-RECENT": {
                "name": "Recent IFACE", "agent": "KF", "type": "SH-Shop",
                "open_date": "2024-01-10", "dm_active": True,
            },
            "300-PERSONAL": {
                "name": "Personal IFACE", "agent": "KW", "type": "P-Personal",
                "open_date": "2024-01-10", "dm_active": True,
            },
        }
        df = pd.DataFrame([
            {"debtor_code": "300-LAPSED", "item_group": "IFACE", "item_code": "IFACE R", "paid_on": "Feb 26", "tranx_mth_full": "Feb 26", "qty_ctn": 2},
            {"debtor_code": "300-RECENT", "item_group": "IFACE", "item_code": "IFACE M", "paid_on": "May 26", "tranx_mth_full": "May 26", "qty_ctn": 1},
        ])

        candidates = process_data.build_brand_penetration_campaign_candidates(
            debtor_info=debtor_info,
            df=df,
            agents=["BEN", "CJ", "KF", "KW"],
            cur_month="Jun 26",
            brand_label="IFACE",
            qualifying_values=["IFACE", "IFACE B", "IFACE M", "IFACE R", "IFACE DB"],
            foc_item="SUKUN",
            foc_qty=4,
            foc_unit="packs",
            foc_note="IFACE PEN",
            exclude_type_keywords=["Personal", "End User"],
            agent_group_map={},
        )
        by_code = {row["debtor_code"]: row for row in candidates}

        self.assertEqual(set(by_code), {"300-NEW", "300-LAPSED"})
        self.assertEqual(by_code["300-LAPSED"]["eligibility_reason"], "3-month no IFACE")
        self.assertEqual(by_code["300-NEW"]["campaign_family"], "brand_penetration")
        self.assertEqual(by_code["300-NEW"].get("cat_group"), "")
        self.assertEqual(by_code["300-NEW"]["foc_package"], "SUKUN x 4 packs")

    def test_build_iface_campaign_candidates_excludes_personal_and_labels_reasons(self):
        debtor_info = {
            "300-NEW": {
                "name": "New Shop", "agent": "BEN", "type": "SH-Shop",
                "open_date": "2026-06-03", "dm_active": True,
            },
            "300-NEVER": {
                "name": "Never IFACE", "agent": "CJ", "type": "SH-Shop",
                "open_date": "2025-01-10", "dm_active": True,
            },
            "300-LAPSED": {
                "name": "Lapsed IFACE", "agent": "KF", "type": "SH-Shop",
                "open_date": "2024-01-10", "dm_active": True,
            },
            "300-RECENT": {
                "name": "Recent IFACE", "agent": "KW", "type": "SH-Shop",
                "open_date": "2024-01-10", "dm_active": True,
            },
            "300-PERSONAL": {
                "name": "Personal IFACE", "agent": "BEN", "type": "P-Personal",
                "open_date": "2024-01-10", "dm_active": True,
            },
            "300-ENDUSER": {
                "name": "End User IFACE", "agent": "CJ", "type": "End User",
                "open_date": "2024-01-10", "dm_active": True,
            },
        }
        df = pd.DataFrame([
            {"debtor_code": "300-LAPSED", "item_group": "IFACE", "item_code": "IFACE R", "paid_on": "Feb 26", "tranx_mth_full": "Feb 26", "qty_ctn": 2},
            {"debtor_code": "300-RECENT", "item_group": "IFACE", "item_code": "IFACE M", "paid_on": "May 26", "tranx_mth_full": "May 26", "qty_ctn": 1},
            {"debtor_code": "300-PERSONAL", "item_group": "IFACE", "item_code": "IFACE B", "paid_on": "Feb 26", "tranx_mth_full": "Feb 26", "qty_ctn": 1},
        ])

        candidates = process_data.build_iface_campaign_candidates(
            debtor_info=debtor_info,
            df=df,
            agents=["BEN", "CJ", "KF", "KW"],
            cur_month="Jun 26",
            agent_group_map={"BEN": "MVP", "CJ": "MI", "KF": "SS", "KW": "SBG"},
        )
        by_code = {row["debtor_code"]: row for row in candidates}

        self.assertEqual(set(by_code), {"300-NEW", "300-NEVER", "300-LAPSED"})
        self.assertIn("New account", by_code["300-NEW"]["eligibility_reason"])
        self.assertEqual(by_code["300-NEVER"]["eligibility_reason"], "Never bought IFACE")
        self.assertEqual(by_code["300-LAPSED"]["eligibility_reason"], "3-month no IFACE")
        self.assertEqual(by_code["300-NEW"]["cat_group"], "MVP")
        self.assertEqual(by_code["300-NEVER"]["foc_package"], "SUKUN x 4 packs")
        self.assertEqual(by_code["300-LAPSED"]["foc_note"], "IFACE PEN")

    def test_iface_group_progress_adds_rm350_pool_value_and_winners(self):
        debtor_cards = {
            "BEN": {"debtors": [
                {"debtor_code": "300-A", "company_name": "A Shop", "campaigns": [
                    {"id": "iface_jun26", "type": "conversion_simple", "converted": True, "current_ctn": 10}
                ]},
                {"debtor_code": "300-B", "company_name": "B Shop", "campaigns": [
                    {"id": "iface_jun26", "type": "conversion_simple", "converted": False, "current_ctn": 0}
                ]},
            ]},
            "CJ": {"debtors": [
                {"debtor_code": "300-C", "company_name": "C Shop", "campaigns": [
                    {"id": "iface_jun26", "type": "conversion_simple", "converted": True, "current_ctn": 15}
                ]},
            ]},
        }
        campaigns = [{
            "id": "iface_jun26",
            "name": "IFACE JUNE CAMPAIGN 2026",
            "type": "conversion_simple",
            "notes": {"qualifying_item_group": "IFACE", "pk_pool_rate": 3.5},
            "debtors": [
                {"debtor_code": "300-A", "cat_group": "MVP"},
                {"debtor_code": "300-B", "cat_group": "MVP"},
                {"debtor_code": "300-C", "cat_group": "MI"},
            ],
        }]

        progress = process_data.calc_conversion_campaign_group_progress(debtor_cards, campaigns)

        iface = progress["iface_jun26"]
        self.assertEqual(iface["pk_pool_rate"], 3.5)
        self.assertEqual(iface["totals"]["converted_ctn"], 25)
        self.assertEqual(iface["totals"]["pool_value"], 87.5)
        self.assertEqual(iface["groups"]["MVP"]["pool_value"], 35)
        self.assertEqual(iface["groups"]["MI"]["pool_value"], 52.5)
        self.assertEqual(iface["winner_by_accounts"], "MVP")
        self.assertEqual(iface["winner_by_ctn"], "MI")


if __name__ == "__main__":
    unittest.main()
