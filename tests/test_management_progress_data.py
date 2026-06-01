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
