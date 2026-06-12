import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class UpdateDashboardSourceSyncTests(unittest.TestCase):
    def test_update_dashboard_auto_pulls_when_only_behind_main(self):
        bat = (ROOT / "update_dashboard.bat").read_text(encoding="utf-8")
        self.assertIn("git rev-list --left-right --count HEAD...origin/main", bat)
        self.assertIn("LOCAL_AHEAD", bat)
        self.assertIn("LOCAL_BEHIND", bat)
        self.assertIn("Auto-pulling latest GitHub main", bat)
        self.assertIn("git pull --ff-only origin main", bat)
        self.assertIn("local commits or has diverged", bat)

    def test_update_dashboard_syncs_debtor_maintenance_from_desktop(self):
        bat = (ROOT / "update_dashboard.bat").read_text(encoding="utf-8")
        self.assertIn("DESKTOP_DEBTOR_FILE", bat)
        self.assertIn("LIVE_DEBTOR_FILE", bat)
        self.assertIn("Debtor Maintenance.xlsx", bat)
        self.assertIn("Could not sync desktop Debtor Maintenance", bat)


if __name__ == "__main__":
    unittest.main()
