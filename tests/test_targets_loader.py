import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import targets_loader


class TargetsLoaderTests(unittest.TestCase):
    def test_agent_replacements_apply_archive_and_inheritance(self):
        targets = {
            "agents": {
                "KEAN": {"active": True, "sales_progression": {"normal_t1": 100}},
                "XIAN": {"active": True, "sales_progression": {"normal_t1": 200}},
                "JW": {"active": True, "sales_progression": {"normal_t1": 50}},
                "SAM": {"active": True, "sales_progression": {"normal_t1": 80}},
            },
            "agent_replacements": {
                "KEAN": {"successor": "XIAN", "from_month": "Jul-26"},
                "JW": {"successor": "SAM", "from_month": "Jul-26"},
            },
        }

        result = targets_loader.apply_agent_replacements(targets)

        self.assertFalse(result["agents"]["KEAN"]["active"])
        self.assertTrue(result["agents"]["KEAN"]["archived"])
        self.assertEqual(result["agents"]["KEAN"]["archived_from_month"], "Jul-26")
        self.assertEqual(result["agents"]["XIAN"]["inherits_from"], "KEAN")
        self.assertEqual(result["agents"]["XIAN"]["inherit_from_month"], "Jul-26")

        self.assertFalse(result["agents"]["JW"]["active"])
        self.assertTrue(result["agents"]["JW"]["archived"])
        self.assertEqual(result["agents"]["SAM"]["inherits_from"], "JW")
        self.assertEqual(result["agents"]["SAM"]["inherit_from_month"], "Jul-26")


if __name__ == "__main__":
    unittest.main()
