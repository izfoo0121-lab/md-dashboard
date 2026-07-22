import unittest
import json
import tempfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import targets_loader


class TargetsLoaderTests(unittest.TestCase):
    def test_optional_table_failure_keeps_core_agent_and_monthly_targets(self):
        table_rows = {
            "targets_agents": [{
                "agent": "BEN",
                "active": True,
                "sales_progression": {"normal_t1": 850},
            }],
            "targets_monthly": [{
                "month": "Jul 26",
                "agent": "BEN",
                "active": True,
                "sales_progression": {"normal_t1": 900},
            }],
        }

        class FakeQuery:
            def __init__(self, table):
                self.table = table

            def select(self, _columns):
                return self

            def execute(self):
                if self.table == "targets_pins":
                    raise RuntimeError("permission denied for table targets_pins")
                return type("Response", (), {"data": table_rows.get(self.table, [])})()

        class FakeClient:
            def table(self, name):
                return FakeQuery(name)

        original_has_supabase = targets_loader.HAS_SUPABASE
        original_create_client = targets_loader.create_client
        try:
            targets_loader.HAS_SUPABASE = True
            targets_loader.create_client = lambda *_args, **_kwargs: FakeClient()

            result = targets_loader.load_targets_from_supabase()
        finally:
            targets_loader.HAS_SUPABASE = original_has_supabase
            targets_loader.create_client = original_create_client

        self.assertIsNotNone(result)
        self.assertEqual(result["agents"]["BEN"]["sales_progression"]["normal_t1"], 850)
        self.assertEqual(
            result["monthly_targets"]["Jul 26"]["BEN"]["sales_progression"]["normal_t1"],
            900,
        )
        self.assertEqual(result["agent_pins"], {})

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

    def test_save_file_backup_writes_cache_without_mutating_tracked_targets(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            tracked_targets = tmp_path / "targets.json"
            cache_backup = tmp_path / ".cache" / "targets.latest.json"
            tracked_targets.write_text('{"tracked": true}', encoding="utf-8")

            original_targets_file = targets_loader.TARGETS_FILE
            original_backup_file = targets_loader.BACKUP_FILE
            try:
                targets_loader.TARGETS_FILE = tracked_targets
                targets_loader.BACKUP_FILE = cache_backup

                targets_loader.save_file_backup({
                    "_loaded_at": "2026-07-05T12:00:00",
                    "agents": {"XIAN": {"active": True}},
                })
            finally:
                targets_loader.TARGETS_FILE = original_targets_file
                targets_loader.BACKUP_FILE = original_backup_file

            self.assertEqual(json.loads(tracked_targets.read_text(encoding="utf-8")), {"tracked": True})
            self.assertTrue(cache_backup.exists())
            self.assertEqual(
                json.loads(cache_backup.read_text(encoding="utf-8"))["agents"],
                {"XIAN": {"active": True}},
            )


if __name__ == "__main__":
    unittest.main()
