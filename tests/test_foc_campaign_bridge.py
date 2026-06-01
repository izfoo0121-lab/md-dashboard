import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import process_data


class FocCampaignBridgeTests(unittest.TestCase):
    def test_foc_package_prefers_debtor_then_rule_then_campaign_default(self):
        camp = {
            "default_foc_item": "LAM",
            "default_foc_qty": 1,
            "default_foc_unit": "ctn",
        }
        rule = {
            "foc_item": "SUKUN",
            "foc_qty": 2,
            "foc_unit": "pack",
        }
        debtor = {
            "foc_item": "EVO",
            "foc_qty": 3,
            "foc_unit": "packs",
            "foc_item_2": "TR PK",
            "foc_qty_2": 1,
            "foc_unit_2": "box",
        }

        package = process_data.campaign_foc_package(camp, rule, debtor)

        self.assertEqual(package["foc_item"], "EVO")
        self.assertEqual(package["foc_qty"], 3)
        self.assertEqual(package["foc_unit"], "packs")
        self.assertEqual(package["foc_item_2"], "TR PK")
        self.assertEqual(package["foc_qty_2"], 1)
        self.assertEqual(package["foc_unit_2"], "box")
        self.assertEqual(package["foc_package"], "EVO x 3 packs + TR PK x 1 box")

        rule_package = process_data.campaign_foc_package(camp, rule, {})
        self.assertEqual(rule_package["foc_item"], "SUKUN")
        self.assertEqual(rule_package["foc_unit"], "packs")
        self.assertEqual(rule_package["foc_package"], "SUKUN x 2 packs")

        default_package = process_data.campaign_foc_package(camp, {}, {})
        self.assertEqual(default_package["foc_item"], "LAM")
        self.assertEqual(default_package["foc_unit"], "ctn")
        self.assertEqual(default_package["foc_package"], "LAM x 1 ctn")

    def test_foc_package_normalizes_common_units(self):
        self.assertEqual(process_data.normalize_foc_unit("pack"), "packs")
        self.assertEqual(process_data.normalize_foc_unit("PACKS"), "packs")
        self.assertEqual(process_data.normalize_foc_unit("carton"), "ctn")
        self.assertEqual(process_data.normalize_foc_unit("pcs"), "piece")


if __name__ == "__main__":
    unittest.main()
