import unittest
from pathlib import Path
import sys

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import process_data


class ManagementProgressDataTests(unittest.TestCase):
    def test_calc_sku_trace_counts_month_bases_and_target_sales_type(self):
        df = pd.DataFrame([
            {
                "agent": "BEN", "item_group": "CIG", "item_code": "DPM EVO",
                "tranx_mth_full": "May 26", "paid_on": "May 26",
                "sales_type": "Target", "qty_ctn": 10,
            },
            {
                "agent": "BEN", "item_group": "CIG", "item_code": "DPM EVO",
                "tranx_mth_full": "May 26", "paid_on": "May 26",
                "sales_type": "Grey Area", "qty_ctn": 3,
            },
            {
                "agent": "BEN", "item_group": "CIG", "item_code": "DPM EVO",
                "tranx_mth_full": "Apr 26", "paid_on": "May 26",
                "sales_type": "Target", "qty_ctn": 2,
            },
            {
                "agent": "CJ", "item_group": "CIG", "item_code": "DPM EVO",
                "tranx_mth_full": "May 26", "paid_on": "",
                "sales_type": "Target", "qty_ctn": 5,
            },
            {
                "agent": "CJ", "item_group": process_data.EIGHTCOM_GROUP,
                "item_code": "DPM EVO", "tranx_mth_full": "May 26",
                "paid_on": "May 26", "sales_type": "Target", "qty_ctn": 99,
            },
            {
                "agent": "CJ", "item_group": "CIG", "item_code": "CMX",
                "tranx_mth_full": "May 26", "paid_on": "May 26",
                "sales_type": "Target", "qty_ctn": 7,
            },
        ])
        config = [
            {"label": "DPM EVO", "item_codes": ["DPM EVO"], "commission_rate": 1.3},
            {"label": "CMX", "item_codes": ["CMX"], "commission_rate": 0},
        ]

        trace = process_data.calc_sku_trace(df, config, ["BEN", "CJ"], "May 26")

        dpm = trace["items"][0]
        self.assertEqual(dpm["label"], "DPM EVO")
        self.assertEqual(dpm["totals"]["tranx_ctn"], 18)
        self.assertEqual(dpm["totals"]["paid_ctn"], 15)
        self.assertEqual(dpm["totals"]["target_ctn"], 12)
        self.assertEqual(dpm["totals"]["commission"], 15.6)
        self.assertEqual(dpm["agents"]["BEN"]["tranx_ctn"], 13)
        self.assertEqual(dpm["agents"]["BEN"]["paid_ctn"], 15)
        self.assertEqual(dpm["agents"]["BEN"]["target_ctn"], 12)
        self.assertEqual(dpm["agents"]["CJ"]["tranx_ctn"], 5)
        self.assertEqual(dpm["agents"]["CJ"]["paid_ctn"], 0)
        self.assertEqual(dpm["agents"]["CJ"]["target_ctn"], 0)

    def test_debtor_cards_track_m3_8com_without_counting_as_canggih(self):
        sales = pd.DataFrame([
            {
                "agent": "CJ",
                "debtor_code": "300-8COM",
                "company_name": "8COM Only Shop",
                "item_group": "8com ",
                "item_code": "JDB",
                "tranx_mth_full": "Apr 26",
                "paid_on": "Apr 26",
                "sales_type": "Target",
                "qty_ctn": 5,
                "date_parsed": pd.Timestamp("2026-04-05"),
                "local_subtotal": 100,
                "rm_ctn": 20,
                "rm_ctn_rebate": 0,
            },
        ])
        debtors = pd.DataFrame([
            {
                "Code": "300-8COM",
                "Company Name": "8COM Only Shop",
                "Agent": "CJ",
                "Debtor Type": "SH-Shop",
                "Area": "GRP 2A",
                "Active": "Checked",
                "Open Acct Date": "2024-01-01",
            }
        ])

        original_supabase_get = process_data._supabase_get
        process_data._supabase_get = lambda *args, **kwargs: []
        try:
            cards = process_data.calc_debtor_cards(sales, debtors, ["CJ"], "Jul 26")
        finally:
            process_data._supabase_get = original_supabase_get

        debtor = cards["CJ"]["debtors"][0]
        self.assertEqual(debtor["eightcom_ctn_prev3"], 5)
        self.assertEqual(debtor["ctn_prev3"], 0)
        self.assertEqual(debtor["canggih_ctn_prev3"], 0)

    def test_sales_progression_normalizes_8com_item_group_boundary(self):
        df = pd.DataFrame([
            {
                "agent": "CJ",
                "debtor_code": "300-8COM",
                "doc_no": "INV-8",
                "item_group": "8com ",
                "item_code": "JDB",
                "paid_on": "Jul 26",
                "sales_type": "Target",
                "qty_ctn": 7,
            },
        ])

        result = process_data.calc_sales_progression(df, {"agents": {}}, ["CJ"], "Jul 26")

        self.assertEqual(result["CJ"]["total_canggih_ctn"], 0)
        self.assertEqual(result["CJ"]["eightcom_paid_ctn"], 7)

    def test_calc_conversion_campaign_group_progress_ranks_groups_and_agents(self):
        debtor_cards = {
            "BEN": {"debtors": [
                {"debtor_code": "300-A", "campaigns": [
                    {"id": "tr12", "type": "conversion_simple", "converted": True, "current_ctn": 8}
                ]},
                {"debtor_code": "300-B", "campaigns": [
                    {"id": "tr12", "type": "conversion_simple", "converted": False, "current_ctn": 0}
                ]},
            ]},
            "CJ": {"debtors": [
                {"debtor_code": "300-C", "campaigns": [
                    {"id": "tr12", "type": "conversion_simple", "converted": True, "current_ctn": 3}
                ]},
            ]},
        }
        campaigns = [{
            "id": "tr12",
            "name": "TR12 PK",
            "debtors": [
                {"debtor_code": "300-A", "group": "MIRACLE"},
                {"debtor_code": "300-B", "group": "MIRACLE"},
                {"debtor_code": "300-C", "group": "MVP"},
            ],
        }]

        progress = process_data.calc_conversion_campaign_group_progress(debtor_cards, campaigns)

        tr12 = progress["tr12"]
        self.assertEqual(tr12["totals"]["new_accounts"], 3)
        self.assertEqual(tr12["totals"]["converted_count"], 2)
        self.assertEqual(tr12["totals"]["converted_ctn"], 11)
        self.assertEqual(tr12["winner_by_accounts"], "MIRACLE")
        self.assertEqual(tr12["winner_by_ctn"], "MIRACLE")
        self.assertEqual(tr12["groups"]["MIRACLE"]["new_accounts"], 2)
        self.assertEqual(tr12["groups"]["MIRACLE"]["converted_ctn"], 8)
        self.assertEqual(tr12["groups"]["MIRACLE"]["rank_accounts"], 1)
        self.assertEqual(tr12["groups"]["MVP"]["rank_ctn"], 2)
        self.assertEqual(tr12["agents"]["BEN"]["group"], "MIRACLE")
        self.assertEqual(tr12["agents"]["BEN"]["not_converted_count"], 1)
        self.assertEqual(tr12["agents"]["CJ"]["converted_ctn"], 3)


if __name__ == "__main__":
    unittest.main()
