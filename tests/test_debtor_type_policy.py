import unittest

import pandas as pd

import process_data


class DebtorTypePolicyTests(unittest.TestCase):
    def test_converter_is_business_personal_is_excluded_and_unknown_is_reviewed(self):
        self.assertTrue(hasattr(process_data, "normalize_debtor_type"))
        self.assertTrue(hasattr(process_data, "classify_debtor_type"))

        self.assertEqual(process_data.normalize_debtor_type(" converter "), "Converter")
        self.assertEqual(process_data.classify_debtor_type("Converter"), "business")
        self.assertEqual(process_data.normalize_debtor_type("personal"), "P-Personal")
        self.assertEqual(process_data.classify_debtor_type("P-Personal"), "personal")
        self.assertEqual(process_data.classify_debtor_type("Staff"), "review_required")
        self.assertEqual(process_data.classify_debtor_type(""), "review_required")

    def test_sales_report_type_fills_blank_or_missing_master_records(self):
        self.assertTrue(hasattr(process_data, "merge_sales_debtor_type_fallback"))
        master = {
            "300-BLANK": {
                "name": "Blank Type Shop",
                "agent": "CJ",
                "area": "GRP 2A",
                "type": "",
                "dm_active": True,
            }
        }
        sales = pd.DataFrame(
            [
                {
                    "debtor_code": "300-BLANK",
                    "company_name": "Blank Type Shop",
                    "agent": "CJ",
                    "area_code": "GRP 2A",
                    "debtor_type": "converter",
                    "paid_on": "Jul 26",
                    "tranx_mth_full": "Jul 26",
                    "date_parsed": pd.Timestamp("2026-07-02"),
                },
                {
                    "debtor_code": "300-ORPHAN",
                    "company_name": "New Converter",
                    "agent": "CJ",
                    "area_code": "GRP 2A",
                    "debtor_type": "Converter",
                    "paid_on": "Jul 26",
                    "tranx_mth_full": "Jul 26",
                    "date_parsed": pd.Timestamp("2026-07-03"),
                },
            ]
        )

        merged = process_data.merge_sales_debtor_type_fallback(
            master, sales, current_month="Jul 26"
        )

        self.assertEqual(merged["300-BLANK"]["type"], "Converter")
        self.assertEqual(merged["300-BLANK"]["debtor_type_source"], "sales_report_fallback")
        self.assertEqual(merged["300-ORPHAN"]["type"], "Converter")
        self.assertEqual(merged["300-ORPHAN"]["debtor_type_source"], "sales_report_only")
        self.assertTrue(merged["300-ORPHAN"]["master_missing"])

    def test_current_converter_sale_gets_debtor_card_when_master_is_missing(self):
        sales = pd.DataFrame(
            [
                {
                    "debtor_code": "300-CONV",
                    "company_name": "Converter Shop",
                    "agent": "CJ",
                    "area_code": "GRP 2A",
                    "debtor_type": "Converter",
                    "item_group": "EVO",
                    "item_code": "EVO",
                    "paid_on": "Jul 26",
                    "tranx_mth_full": "Jul 26",
                    "qty_ctn": 3,
                    "date_parsed": pd.Timestamp("2026-07-02"),
                    "local_subtotal": 123,
                    "rm_ctn": 41,
                    "rm_ctn_rebate": 0,
                    "sales_type": "Target",
                }
            ]
        )

        original_supabase_get = process_data._supabase_get
        process_data._supabase_get = lambda *args, **kwargs: []
        try:
            cards = process_data.calc_debtor_cards(
                sales, pd.DataFrame(), ["CJ"], "Jul 26"
            )
        finally:
            process_data._supabase_get = original_supabase_get

        self.assertEqual(cards["CJ"]["total_debtors"], 1)
        self.assertEqual(cards["CJ"]["debtors"][0]["debtor_type"], "Converter")
        self.assertEqual(
            cards["CJ"]["debtors"][0]["debtor_type_source"], "sales_report_only"
        )

    def test_quality_audit_counts_orphans_mismatches_and_review_types(self):
        self.assertTrue(hasattr(process_data, "build_debtor_type_quality"))
        master = pd.DataFrame(
            [
                {"Code": "300-MATCH", "Debtor Type": "SH-Shop", "Agent": "CJ", "Area": "GRP 2A", "Active": "Checked"},
                {"Code": "300-MISMATCH", "Debtor Type": "P-Personal", "Agent": "CJ", "Area": "GRP 2A", "Active": "Checked"},
                {"Code": "300-STAFF", "Debtor Type": "Staff", "Agent": "CJ", "Area": "GRP 2A", "Active": "Checked"},
            ]
        )
        sales = pd.DataFrame(
            [
                {"debtor_code": "300-MATCH", "debtor_type": "SH-Shop", "agent": "CJ", "area_code": "GRP 2A"},
                {"debtor_code": "300-MISMATCH", "debtor_type": "Converter", "agent": "CJ", "area_code": "GRP 2A"},
                {"debtor_code": "300-ORPHAN", "debtor_type": "Converter", "agent": "CJ", "area_code": "GRP 2A"},
                {"debtor_code": "300-BLANK", "debtor_type": "", "agent": "CJ", "area_code": "GRP 2A"},
                {"debtor_code": "300-STAFF", "debtor_type": "Staff", "agent": "CJ", "area_code": "GRP 2A"},
            ]
        )

        quality = process_data.build_debtor_type_quality(sales, master, allowed_agents=["CJ"])

        self.assertTrue(quality["report_column_present"])
        self.assertEqual(quality["transaction_debtors"], 5)
        self.assertEqual(quality["missing_master_debtors"], 2)
        self.assertEqual(quality["type_mismatch_debtors"], 1)
        self.assertEqual(quality["report_converter_debtors"], 2)
        self.assertEqual(quality["resolved_converter_debtors"], 1)
        self.assertEqual(quality["review_required_types"], {"<blank>": 1, "Staff": 1})

    def test_converter_counts_as_brand_penetration_when_type_comes_from_sales(self):
        sales = pd.DataFrame(
            [
                {
                    "debtor_code": "300-CONV",
                    "company_name": "Converter Shop",
                    "agent": "CJ",
                    "area_code": "GRP 2A",
                    "debtor_type": "Converter",
                    "item_group": "EVO",
                    "item_code": "EVO",
                    "paid_on": "Jul 26",
                    "tranx_mth_full": "Jul 26",
                    "qty_ctn": 2,
                    "rm_ctn": 41,
                    "local_subtotal": 82,
                    "date_parsed": pd.Timestamp("2026-07-02"),
                }
            ]
        )
        debtor_info = process_data.merge_sales_debtor_type_fallback(
            {}, sales, current_month="Jul 26"
        )
        targets = {
            "agents": {
                "CJ": {
                    "brand_commission": {
                        "EVO": {"penetration_target": 1, "ctn_target": 1}
                    }
                }
            }
        }

        result = process_data.calc_brand_commission(
            sales,
            targets,
            ["CJ"],
            "Jul 26",
            ["Jun 26", "May 26", "Apr 26"],
            {"EVO": ["EVO"]},
            debtor_info=debtor_info,
        )

        self.assertEqual(result["CJ"]["EVO"]["penetration"]["count"], 1)
        self.assertTrue(result["CJ"]["EVO"]["penetration"]["hit"])


if __name__ == "__main__":
    unittest.main()
