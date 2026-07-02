import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import process_data


class ConfigurableBrandBehaviorTests(unittest.TestCase):
    def test_team_summary_uses_configured_brand_keys(self):
        targets = {
            "brand_config": {"CMX": ["CMX"]},
            "agents": {
                "BEN": {
                    "sales_progression": {"normal_t1": 100},
                },
            },
        }
        sales_prog = {"BEN": {"normal_ctn": 50}}
        brand_comm = {
            "BEN": {
                "CMX": {
                    "comm_earned": 12.5,
                    "both_hit": True,
                    "status": "both_hit",
                },
            },
        }

        team = process_data.calc_team_summary(
            sales_prog=sales_prog,
            brand_comm=brand_comm,
            agents=["BEN"],
            targets=targets,
            cur_month="Jun 26",
        )

        self.assertIn("CMX", team["brand_summary"])
        self.assertEqual(team["brand_summary"]["CMX"]["total_comm"], 12.5)
        self.assertEqual(team["leaderboard"][0]["brands_earned"], 1)

    def test_required_auto_brand_gets_default_item_mapping(self):
        config = process_data._brand_config_with_required_defaults(
            {"SUKUN": ["SKNR", "SKNW"]},
            ["CMP"],
        )

        self.assertEqual(config["SUKUN"], ["SKNR", "SKNW"])
        self.assertEqual(config["CMP"], ["CMP"])

    def test_legacy_group_brand_sukun_config_migrates_to_cmp(self):
        targets = {
            "group_brand_config": {
                "SUKUN": ["SKNR", "SKNW"],
                "EVO": ["EVO"],
            },
            "group_brand_targets": {
                "SUKUN": 7800,
                "EVO": 11000,
            },
        }

        config = process_data.normalize_group_brand_config(targets)

        self.assertEqual(list(config.keys()), ["CMP", "EVO"])
        self.assertEqual(config["CMP"], ["CMP"])
        self.assertEqual(targets["group_brand_targets"]["CMP"], 7800)
        self.assertNotIn("SUKUN", targets["group_brand_targets"])

    def test_penetration_snapshot_uses_configured_auto_brands(self):
        original_target_file = process_data.TARGETS_FILE
        original_sync = process_data.sync_targets_to_supabase
        with tempfile.TemporaryDirectory() as tmp:
            process_data.TARGETS_FILE = str(Path(tmp) / "targets.json")
            process_data.sync_targets_to_supabase = lambda targets: None
            try:
                targets = {
                    "penetration_auto_brands": ["iFACE", "CMP", "BISON", "TR20"],
                    "agents": {
                        "BEN": {
                            "brand_commission": {
                                "SUKUN": {"penetration_target": 7, "pen_auto": True},
                            },
                        },
                    },
                    "penetration_snapshots": {
                        "Jun 26": {"BEN": {"SUKUN": 20}},
                    },
                    "penetration_snapshot_meta": {
                        "Jun 26": {
                            "pool_version": "dm_active_nonpersonal_debtorwide_v2",
                            "penetration_auto_brands": ["iFACE", "SUKUN", "BISON", "TR20"],
                        },
                    },
                }
                brand_comm = {
                    "BEN": {
                        "SUKUN": {"non_buyers": 20},
                        "CMP": {"non_buyers": 40},
                        "BISON": {"non_buyers": 0},
                    },
                }

                result = process_data.save_penetration_snapshot(brand_comm, targets, "Jun 26")
            finally:
                process_data.TARGETS_FILE = original_target_file
                process_data.sync_targets_to_supabase = original_sync

        ben_comm = result["agents"]["BEN"]["brand_commission"]
        self.assertEqual(ben_comm["CMP"]["penetration_target"], 2)
        self.assertIs(ben_comm["CMP"]["pen_auto"], True)
        self.assertIs(ben_comm["BISON"]["pen_auto"], True)
        self.assertEqual(ben_comm["BISON"]["penetration_target"], 0)
        self.assertIs(ben_comm["SUKUN"]["pen_auto"], False)
        self.assertEqual(ben_comm["SUKUN"]["penetration_target"], 7)
        self.assertEqual(
            result["penetration_snapshot_meta"]["Jun 26"]["penetration_auto_brands"],
            ["iFACE", "CMP", "BISON", "TR20"],
        )


if __name__ == "__main__":
    unittest.main()
