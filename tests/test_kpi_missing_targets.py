import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import process_data


class KpiMissingTargetsTests(unittest.TestCase):
    def test_brand_kpi_without_target_is_excluded_from_score(self):
        kpi = process_data.calc_kpi(
            ["CJ"],
            {},
            {"CJ": {"tiers": {"normal_t1": {"pct": 0}}}},
            {
                "CJ": {
                    "SUKUN": {
                        "penetration": {"count": 1, "target": 0},
                        "ctn": {"sold": 57, "target": 0},
                    }
                }
            },
            {"CJ": {"debtors": [], "total_new_sku": 0, "activation_rate": 0}},
            birthday_camp={"by_agent": {}},
            cur_month="Jul 26",
        )

        sukun_pen = kpi["CJ"]["items"]["sukun_pen"]
        sukun_target = kpi["CJ"]["items"]["sukun_target"]

        self.assertIsNone(sukun_pen["target"])
        self.assertTrue(sukun_pen["target_missing"])
        self.assertEqual(sukun_pen["max_score"], 0.0)
        self.assertEqual(sukun_pen["score"], 0.0)

        self.assertIsNone(sukun_target["target"])
        self.assertTrue(sukun_target["target_missing"])
        self.assertEqual(sukun_target["max_score"], 0.0)
        self.assertEqual(sukun_target["score"], 0.0)


if __name__ == "__main__":
    unittest.main()
