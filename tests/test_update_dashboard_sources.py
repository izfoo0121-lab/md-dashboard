import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class UpdateDashboardSourceSyncTests(unittest.TestCase):
    def test_update_dashboard_syncs_debtor_maintenance_from_desktop(self):
        bat = (ROOT / "update_dashboard.bat").read_text(encoding="utf-8")
        self.assertIn("DESKTOP_DEBTOR_FILE", bat)
        self.assertIn("LIVE_DEBTOR_FILE", bat)
        self.assertIn("Debtor Maintenance.xlsx", bat)
        self.assertIn("Could not sync desktop Debtor Maintenance", bat)


if __name__ == "__main__":
    unittest.main()
