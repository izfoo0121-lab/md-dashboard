import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import openpyxl
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
    def test_sku_report_builder_honors_configured_source_paths(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            sales_path = Path(temp_dir) / "sales.xlsx"
            debtor_path = Path(temp_dir) / "debtors.xlsx"
            with patch.dict(
                os.environ,
                {
                    "MD_SALES_FILE": str(sales_path),
                    "MD_DEBTOR_FILE": str(debtor_path),
                },
            ):
                builder = load_sku_report_builder()

        self.assertEqual(builder.SALES_XLSX, sales_path)
        self.assertEqual(builder.DEBTOR_XLSX, debtor_path)

    def test_debtor_analysis_uses_converter_from_sales_when_master_is_missing(self):
        sales = pd.DataFrame(
            [
                {
                    "tranx_mth_full": "Jul 26",
                    "debtor_code": "300-CONV",
                    "company_name": "Converter Shop",
                    "agent": "CJ",
                    "area_code": "GRP 2A",
                    "debtor_type": "Converter",
                    "item_group": "EVO",
                    "item_code": "EVO",
                    "sales_type": "Target",
                    "paid_on": "Jul 26",
                    "qty_ctn": 2,
                    "local_subtotal": 82,
                    "rm_ctn": 41,
                    "rm_ctn_rebate": 0,
                    "doc_no": "IV-CONV",
                    "date_parsed": pd.Timestamp("2026-07-02"),
                }
            ]
        )

        data = process_data.build_debtor_analysis_data(
            sales, pd.DataFrame(), "Jul 26", allowed_agents=["CJ"]
        )

        self.assertEqual(len(data["debtors"]), 1)
        self.assertEqual(data["debtors"][0]["debtor_type"], "Converter")
        self.assertEqual(data["debtors"][0]["debtor_type_source"], "sales_report_only")
        self.assertEqual(data["records"][0]["debtor_type"], "Converter")
        self.assertEqual(data["data_quality"]["missing_master_debtors"], 1)

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
        normalized_sales = pd.DataFrame(
            [
                {
                    "doc_no": "IV-CJ",
                    "date_parsed": pd.Timestamp("2026-07-01"),
                    "debtor_code": "300-CJ",
                    "company_name": "CJ Shop",
                    "agent": "CJ",
                    "area_code": "GRP 2A",
                    "debtor_type": "SH-Shop",
                    "item_code": "EVO",
                    "item_desc": "EVO",
                    "local_subtotal": 100,
                    "qty_ctn": 1,
                },
                {
                    "doc_no": "IV-KEAN",
                    "date_parsed": pd.Timestamp("2026-07-01"),
                    "debtor_code": "300-KEAN",
                    "company_name": "Kean Shop",
                    "agent": "KEAN",
                    "area_code": "GRP 2A",
                    "debtor_type": "Converter",
                    "item_code": "EVO",
                    "item_desc": "EVO",
                    "local_subtotal": 200,
                    "qty_ctn": 2,
                },
                {
                    "doc_no": "IV-BOY",
                    "date_parsed": pd.Timestamp("2026-07-01"),
                    "debtor_code": "300-BOY",
                    "company_name": "Boy Shop",
                    "agent": "BOY",
                    "area_code": "GRP 2A",
                    "debtor_type": "SH-Shop",
                    "item_code": "EVO",
                    "item_desc": "EVO",
                    "local_subtotal": 300,
                    "qty_ctn": 3,
                },
                {
                    "doc_no": "IV-GRP3",
                    "date_parsed": pd.Timestamp("2026-07-01"),
                    "debtor_code": "300-GRP3",
                    "company_name": "Group 3 Shop",
                    "agent": "CJ",
                    "area_code": "GRP 3A",
                    "debtor_type": "SH-Shop",
                    "item_code": "EVO",
                    "item_desc": "EVO",
                    "local_subtotal": 400,
                    "qty_ctn": 4,
                },
            ]
        )

        with patch.object(
            builder.dashboard_processor,
            "load_sales_report",
            return_value=normalized_sales,
        ):
            rows = builder.load_sales(
                miracle_only=False, scope="GRP 2A", allowed_agents={"CJ", "KEAN"}
            )

        self.assertEqual(sorted(rows["agent"].unique().tolist()), ["CJ", "KEAN"])
        self.assertEqual(set(rows["area_code"].unique().tolist()), {"GRP 2A"})

    def test_sku_report_loader_supports_detected_sheet_header_and_inserted_debtor_type(self):
        builder = load_sku_report_builder()
        workbook = openpyxl.Workbook()
        cover = workbook.active
        cover.title = "Cover"
        cover.append(["Archived sales export"])
        sales = workbook.create_sheet("MD Archive")
        sales.append(["Reference row"])
        sales.append([
            "Tranx Mth", "Doc. No.", "Date", "Debtor Code", "Company Name",
            "Sales Agent", "Area Code", "Item Group", "Item Code",
            "Item Description", "UOM", "Smallest Qty", "Unit Price", "Discount",
            "Local SubTotal", "Rebate", "PAID ON", "Debtor Type", "UNIQ CODE",
            "RM / CTN", "RM / CTN (REBATE)", "Sales type", "Comm Rate",
            "QTY (CTN)", "QTY (MC)", "RM / MC", "> Shop Price Comm",
        ])
        sales.append([
            "Jul", "IV-CONV", "2026-07-02", "300-CONV", "Converter Shop",
            "CJ", "GRP 2A", "EVO", "EVO", "EVO", "CTN", 2, 41, 0, 82,
            0, "Jul 26", "Converter", "UNIQ-CONV", 41, 41, "Target", 1.8,
            2, 0, 0, 3.6,
        ])
        handle = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
        handle.close()
        workbook.save(handle.name)
        workbook.close()
        try:
            with patch.object(builder, "SALES_XLSX", Path(handle.name)):
                rows = builder.load_sales(miracle_only=False, allowed_agents={"CJ"})
        finally:
            os.unlink(handle.name)

        self.assertEqual(rows.iloc[0]["debtor_type"], "Converter")
        self.assertEqual(rows.iloc[0]["qty_ctn"], 2)

    def test_sku_report_load_debtors_filters_all_group_master_to_group2a(self):
        builder = load_sku_report_builder()
        workbook = pd.DataFrame(
            [
                {"Code": "300-2A", "Company Name": "2A Shop", "Debtor Type": "CONVERTER", "Agent": "CJ", "Area": "GRP 2A", "Active": "Checked"},
                {"Code": "300-3", "Company Name": "3 Shop", "Debtor Type": "Converter", "Agent": "CJ", "Area": "GRP 3", "Active": "Checked"},
            ]
        )

        with patch.object(builder.pd, "read_excel", return_value=workbook):
            debtors = builder.load_debtors(allowed_agents={"CJ"})

        self.assertEqual(set(debtors), {"300-2A"})
        self.assertEqual(debtors["300-2A"]["type"], "Converter")

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

    def test_sku_gap_uses_converter_type_from_sales_when_master_is_missing(self):
        builder = load_sku_report_builder()
        rows = pd.DataFrame(
            [
                {
                    "period_key": "2026-07",
                    "state": "Pahang",
                    "agent": "CJ",
                    "debtor_code": "300-CONV",
                    "company_name": "Converter Shop",
                    "debtor_type": "Converter",
                    "sku": "EVO",
                    "desc": "EVO",
                    "sales": 82,
                    "qty_ctn": 2,
                    "doc_no": "IV-CONV",
                    "date": pd.Timestamp("2026-07-02"),
                }
            ]
        )

        data = builder.build_sku_gap(rows, {})

        self.assertEqual(data["debtors"]["300-CONV"]["maintType"], "Converter")
        self.assertIn("Converter", data["typeOptions"])


if __name__ == "__main__":
    unittest.main()
