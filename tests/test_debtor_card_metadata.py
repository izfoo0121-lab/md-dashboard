import unittest
from pathlib import Path
import sys

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import process_data


class DebtorCardMetadataTests(unittest.TestCase):
    def test_debtor_cards_include_export_and_sync_metadata_aliases(self):
        sales = pd.DataFrame(
            [
                {
                    "debtor_code": "300-META",
                    "company_name": "Metadata Shop",
                    "agent": "CJ",
                    "area_code": "GRP 2A",
                    "item_group": "EVO",
                    "item_code": "EVO",
                    "paid_on": "Jul 26",
                    "tranx_mth_full": "Jul 26",
                    "qty_ctn": 3,
                    "date_parsed": pd.Timestamp("2026-07-02"),
                    "local_subtotal": 300,
                    "rm_ctn": 100,
                    "rm_ctn_rebate": 0,
                    "sales_type": "Target",
                }
            ]
        )
        debtors = pd.DataFrame(
            [
                {
                    "Code": "300-META",
                    "Company Name": "Metadata Shop",
                    "Agent": "CJ",
                    "Debtor Type": "SH-Shop",
                    "Area": "GRP 2A",
                    "Active": "Checked",
                    "Open Acct Date": "2024-01-01",
                    "Birth Date": "1990-07-15",
                }
            ]
        )

        original_supabase_get = process_data._supabase_get
        process_data._supabase_get = lambda *args, **kwargs: []
        try:
            cards = process_data.calc_debtor_cards(sales, debtors, ["CJ"], "Jul 26")
        finally:
            process_data._supabase_get = original_supabase_get

        debtor = cards["CJ"]["debtors"][0]
        self.assertEqual(debtor["debtor_type"], "SH-Shop")
        self.assertEqual(debtor["type"], "SH-Shop")
        self.assertEqual(debtor["area_code"], "GRP 2A")
        self.assertEqual(debtor["area"], "GRP 2A")
        self.assertTrue(debtor["dm_active"])
        self.assertTrue(debtor["account_active"])
        self.assertEqual(debtor["account_status"], "account_active")
        self.assertEqual(debtor["account_status_label"], "Active")
        self.assertEqual(debtor["birth_month"], 7)
        self.assertEqual(debtor["birth_day"], 15)
        self.assertEqual(debtor["birth_date"], debtor["birth_date_raw"])


if __name__ == "__main__":
    unittest.main()
