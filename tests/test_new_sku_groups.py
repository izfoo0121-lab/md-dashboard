import unittest
from pathlib import Path
import sys

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import process_data


class NewSkuGroupTests(unittest.TestCase):
    def test_zlb_brands_keep_iface_before_july_cutoff_only(self):
        configured = ["SUKUN", "EVO", "BISON", "LAM+LWM"]

        self.assertEqual(
            process_data.zlb_brands_for_month("Jun 26", configured)[0],
            "iFACE",
        )
        self.assertNotIn("iFACE", process_data.zlb_brands_for_month("Jul 26", configured))

    def test_debtor_cards_count_new_matrix_skus_individually(self):
        rows = []
        for item_code in ("CMX", "CMP", "BISON-R", "BISON-M"):
            rows.append(
                {
                    "debtor_code": "300-NEW-SKU",
                    "company_name": "New SKU Shop",
                    "agent": "CJ",
                    "item_group": item_code,
                    "item_code": item_code,
                    "paid_on": "Jun 26",
                    "tranx_mth_full": "Jun 26",
                    "qty_ctn": 1,
                    "date_parsed": pd.Timestamp("2026-06-05"),
                    "local_subtotal": 100,
                    "rm_ctn": 100,
                    "rm_ctn_rebate": 0,
                    "sales_type": "Target",
                }
            )
        sales = pd.DataFrame(rows)
        debtors = pd.DataFrame(
            [
                {
                    "Code": "300-NEW-SKU",
                    "Company Name": "New SKU Shop",
                    "Agent": "CJ",
                    "Debtor Type": "SH-Shop",
                    "Active": "Checked",
                    "Open Acct Date": "2024-01-01",
                }
            ]
        )

        original_supabase_get = process_data._supabase_get
        process_data._supabase_get = lambda *args, **kwargs: []
        try:
            cards = process_data.calc_debtor_cards(sales, debtors, ["CJ"], "Jun 26")
        finally:
            process_data._supabase_get = original_supabase_get

        debtor = cards["CJ"]["debtors"][0]
        self.assertEqual(debtor["new_sku_count"], 4)
        for group in ("CMX", "CMP", "BISON-R", "BISON-M"):
            with self.subTest(group=group):
                self.assertEqual(debtor["new_sku_status"].get(group), "new")

    def test_debtor_cards_accept_custom_new_sku_group_config(self):
        sales = pd.DataFrame(
            [
                {
                    "debtor_code": "300-DYNAMIC",
                    "company_name": "Dynamic SKU Shop",
                    "agent": "CJ",
                    "item_group": "XYZGROUP",
                    "item_code": "XYZ-001",
                    "paid_on": "Jun 26",
                    "tranx_mth_full": "Jun 26",
                    "qty_ctn": 1,
                    "date_parsed": pd.Timestamp("2026-06-05"),
                    "local_subtotal": 100,
                    "rm_ctn": 100,
                    "rm_ctn_rebate": 0,
                    "sales_type": "Target",
                }
            ]
        )
        debtors = pd.DataFrame(
            [
                {
                    "Code": "300-DYNAMIC",
                    "Company Name": "Dynamic SKU Shop",
                    "Agent": "CJ",
                    "Debtor Type": "SH-Shop",
                    "Active": "Checked",
                    "Open Acct Date": "2024-01-01",
                }
            ]
        )
        custom_rules = {
            "TEST": {
                "item_codes": ["XYZ-001"],
                "item_code_prefixes": ["XYZ-P"],
                "item_groups": ["XYZGROUP"],
            }
        }

        original_supabase_get = process_data._supabase_get
        process_data._supabase_get = lambda *args, **kwargs: []
        try:
            cards = process_data.calc_debtor_cards(
                sales,
                debtors,
                ["CJ"],
                "Jun 26",
                new_sku_groups_config=custom_rules,
            )
        finally:
            process_data._supabase_get = original_supabase_get

        debtor = cards["CJ"]["debtors"][0]
        self.assertEqual(debtor["new_sku_count"], 1)
        self.assertEqual(debtor["new_sku_total"], 1)
        self.assertEqual(debtor["new_sku_status"].get("TEST"), "new")

    def test_sku_rules_config_respects_empty_new_sku_groups(self):
        rules = process_data.normalise_sku_rules_config(
            {"version": 3, "updated_at": "2026-07-02", "new_sku_groups": {}}
        )

        self.assertEqual(rules["version"], 3)
        self.assertEqual(rules["new_sku_groups"], {})

    def test_cmlt_is_other_sku_and_does_not_count_new_sku_kpi(self):
        sales = pd.DataFrame(
            [
                {
                    "debtor_code": "300-CMLT",
                    "company_name": "CMLT Shop",
                    "agent": "CJ",
                    "item_group": "CMLT",
                    "item_code": "CMLT",
                    "paid_on": "Jun 26",
                    "tranx_mth_full": "Jun 26",
                    "qty_ctn": 1,
                    "date_parsed": pd.Timestamp("2026-06-05"),
                    "local_subtotal": 100,
                    "rm_ctn": 100,
                    "rm_ctn_rebate": 0,
                    "sales_type": "Target",
                }
            ]
        )
        debtors = pd.DataFrame(
            [
                {
                    "Code": "300-CMLT",
                    "Company Name": "CMLT Shop",
                    "Agent": "CJ",
                    "Debtor Type": "SH-Shop",
                    "Active": "Checked",
                    "Open Acct Date": "2024-01-01",
                }
            ]
        )
        custom_rules = {
            "OTHER": {
                "item_codes": ["CMLT"],
                "item_groups": ["CMLT"],
            }
        }

        original_supabase_get = process_data._supabase_get
        process_data._supabase_get = lambda *args, **kwargs: []
        try:
            cards = process_data.calc_debtor_cards(
                sales,
                debtors,
                ["CJ"],
                "Jun 26",
                new_sku_groups_config=custom_rules,
            )
        finally:
            process_data._supabase_get = original_supabase_get

        debtor = cards["CJ"]["debtors"][0]
        self.assertEqual(debtor["new_sku_count"], 0)
        self.assertNotEqual(debtor["new_sku_status"].get("OTHER"), "new")


if __name__ == "__main__":
    unittest.main()
