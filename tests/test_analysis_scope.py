import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import process_data


def load_sku_report_builder():
    builder_path = ROOT / "reports" / "miracle-2a-sku-strength" / "build_report_data.py"
    spec = importlib.util.spec_from_file_location("sku_strength_build_report_data", builder_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AnalysisScopeTests(unittest.TestCase):
    def test_debtor_analysis_respects_allowed_dashboard_agents(self):
        sales = pd.DataFrame(
            [
                {
                    "tranx_mth_full": "Jul 26",
                    "debtor_code": "300-CJ",
                    "company_name": "CJ Shop",
                    "agent": "CJ",
                    "area_code": "GRP 2A",
                    "item_group": "EVO",
                    "item_code": "EVO",
                    "sales_type": "Target",
                    "paid_on": "Jul 26",
                    "qty_ctn": 2,
                    "local_subtotal": 200,
                    "rm_ctn": 100,
                    "rm_ctn_rebate": 0,
                    "doc_no": "IV-CJ",
                    "date_parsed": pd.Timestamp("2026-07-02"),
                },
                {
                    "tranx_mth_full": "Jul 26",
                    "debtor_code": "300-BOY",
                    "company_name": "Boy Shop",
                    "agent": "BOY",
                    "area_code": "GRP 2A",
                    "item_group": "EVO",
                    "item_code": "EVO",
                    "sales_type": "Target",
                    "paid_on": "Jul 26",
                    "qty_ctn": 3,
                    "local_subtotal": 300,
                    "rm_ctn": 100,
                    "rm_ctn_rebate": 0,
                    "doc_no": "IV-BOY",
                    "date_parsed": pd.Timestamp("2026-07-02"),
                },
            ]
        )
        debtors = pd.DataFrame(
            [
                {
                    "Code": "300-CJ",
                    "Company Name": "CJ Shop",
                    "Agent": "CJ",
                    "Debtor Type": "SH-Shop",
                    "Area": "GRP 2A",
                    "Active": "Checked",
                    "Phone 1": "",
                },
                {
                    "Code": "300-BOY",
                    "Company Name": "Boy Shop",
                    "Agent": "BOY",
                    "Debtor Type": "SH-Shop",
                    "Area": "GRP 2A",
                    "Active": "Checked",
                    "Phone 1": "",
                },
            ]
        )

        data = process_data.build_debtor_analysis_data(
            sales, debtors, "Jul 26", allowed_agents=["CJ"]
        )

        self.assertEqual({row["agent"] for row in data["records"]}, {"CJ"})
        self.assertEqual({debtor["agent"] for debtor in data["debtors"]}, {"CJ"})

    def test_sku_report_load_sales_uses_area_and_dashboard_agent_scope(self):
        builder = load_sku_report_builder()
        workbook = pd.DataFrame(
            [
                {
                    "Doc. No.": "IV-CJ",
                    "Date": "2026-07-01",
                    "Debtor Code": "300-CJ",
                    "Company Name": "CJ Shop",
                    "Sales Agent": "CJ",
                    "Area Code": "GRP 2A",
                    "Item Code": "EVO",
                    "Item Description": "EVO",
                    "Local SubTotal": 100,
                    "QTY (CTN)": 1,
                },
                {
                    "Doc. No.": "IV-KEAN",
                    "Date": "2026-07-01",
                    "Debtor Code": "300-KEAN",
                    "Company Name": "Kean Shop",
                    "Sales Agent": "KEAN",
                    "Area Code": "GRP 2A",
                    "Item Code": "EVO",
                    "Item Description": "EVO",
                    "Local SubTotal": 200,
                    "QTY (CTN)": 2,
                },
                {
                    "Doc. No.": "IV-BOY",
                    "Date": "2026-07-01",
                    "Debtor Code": "300-BOY",
                    "Company Name": "Boy Shop",
                    "Sales Agent": "BOY",
                    "Area Code": "GRP 2A",
                    "Item Code": "EVO",
                    "Item Description": "EVO",
                    "Local SubTotal": 300,
                    "QTY (CTN)": 3,
                },
                {
                    "Doc. No.": "IV-GRP3",
                    "Date": "2026-07-01",
                    "Debtor Code": "300-GRP3",
                    "Company Name": "Group 3 Shop",
                    "Sales Agent": "CJ",
                    "Area Code": "GRP 3A",
                    "Item Code": "EVO",
                    "Item Description": "EVO",
                    "Local SubTotal": 400,
                    "QTY (CTN)": 4,
                },
            ]
        )

        with patch.object(builder.pd, "read_excel", return_value=workbook):
            rows = builder.load_sales(
                miracle_only=False, scope="GRP 2A", allowed_agents={"CJ", "KEAN"}
            )

        self.assertEqual(sorted(rows["agent"].unique().tolist()), ["CJ", "KEAN"])
        self.assertEqual(set(rows["area_code"].unique().tolist()), {"GRP 2A"})

    def test_sku_gap_debtor_base_uses_visible_report_agents(self):
        builder = load_sku_report_builder()
        rows = pd.DataFrame(
            [
                {
                    "period_key": "2026-07",
                    "state": "Pahang",
                    "agent": "CJ",
                    "debtor_code": "300-CJ",
                    "company_name": "CJ Shop",
                    "sku": "EVO",
                    "desc": "EVO",
                    "sales": 100,
                    "qty_ctn": 1,
                    "doc_no": "IV-CJ",
                    "date": pd.Timestamp("2026-07-01"),
                },
                {
                    "period_key": "2026-07",
                    "state": "GRP 2A",
                    "agent": "KEAN",
                    "debtor_code": "300-KEAN",
                    "company_name": "Kean Shop",
                    "sku": "EVO",
                    "desc": "EVO",
                    "sales": 200,
                    "qty_ctn": 2,
                    "doc_no": "IV-KEAN",
                    "date": pd.Timestamp("2026-07-01"),
                },
            ]
        )
        debtors = {
            "300-CJ": {"name": "CJ Shop", "type": "SH-Shop", "agent": "CJ", "status": "Active"},
            "300-KEAN": {"name": "Kean Shop", "type": "SH-Shop", "agent": "KEAN", "status": "Active"},
            "300-BOY": {"name": "Boy Shop", "type": "SH-Shop", "agent": "BOY", "status": "Active"},
        }

        data = builder.build_sku_gap(rows, debtors)

        self.assertIn("300-CJ", data["debtors"])
        self.assertIn("300-KEAN", data["debtors"])
        self.assertNotIn("300-BOY", data["debtors"])


if __name__ == "__main__":
    unittest.main()
