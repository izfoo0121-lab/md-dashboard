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
        self.assertNotIn("commit(s)", bat)

    def test_update_dashboard_uses_configured_sources_without_copying_workbooks(self):
        bat = (ROOT / "update_dashboard.bat").read_text(encoding="utf-8")
        self.assertIn("if not defined MD_SALES_FILE", bat)
        self.assertIn("if not defined MD_DEBTOR_FILE", bat)
        self.assertIn("Using sales source", bat)
        self.assertIn("Using debtor source", bat)
        self.assertIn("%MD_SALES_FILE%", bat)
        self.assertIn("%MD_DEBTOR_FILE%", bat)
        self.assertIn("Debtor Maintenance.xlsx", bat)
        self.assertNotIn("Copy-Item", bat)

    def test_update_dashboard_runs_smoke_tests_before_commit(self):
        bat = (ROOT / "update_dashboard.bat").read_text(encoding="utf-8")
        self.assertIn("[5a/5] Running smoke tests", bat)
        self.assertIn("%PYTHON% -m unittest discover -s tests -p \"test_*.py\"", bat)
        self.assertIn("node tests\\sales_dashboard_version.test.cjs", bat)
        self.assertIn("node tests\\sku_reports_converter.test.cjs", bat)
        self.assertLess(bat.index("[5a/5] Running smoke tests"), bat.index("git commit -m"))

    def test_update_dashboard_stages_only_generated_outputs(self):
        bat = (ROOT / "update_dashboard.bat").read_text(encoding="utf-8")
        self.assertIn("git add dashboard_data.json debtor_analysis_data.json", bat)
        self.assertIn("git add data_*.json months_index.json", bat)
        self.assertNotIn("git add process_data.py", bat)
        self.assertNotIn("git add sales_dashboard.html", bat)
        self.assertNotIn("git add accounts.html", bat)
        self.assertNotIn("build_report_data.py 2>nul", bat)

    def test_update_dashboard_rejects_pre_staged_files_before_processing(self):
        bat = (ROOT / "update_dashboard.bat").read_text(encoding="utf-8")
        self.assertIn("Checking for pre-staged files", bat)
        self.assertIn("git diff --cached --quiet", bat)
        self.assertIn("Pre-staged files detected", bat)
        self.assertLess(
            bat.index("Checking for pre-staged files"),
            bat.index("%PYTHON% process_data.py"),
        )

    def test_update_dashboard_skips_commit_when_nothing_staged(self):
        bat = (ROOT / "update_dashboard.bat").read_text(encoding="utf-8")
        self.assertIn("git diff --cached --quiet", bat)
        self.assertIn("No staged dashboard changes to commit", bat)
        self.assertIn("goto SUCCESS", bat)

    def test_update_dashboard_does_not_stage_targets_json_by_default(self):
        bat = (ROOT / "update_dashboard.bat").read_text(encoding="utf-8")
        self.assertNotIn("git add dashboard_data.json debtor_analysis_data.json history.json targets.json dashboard_version.json", bat)
        self.assertIn("git add dashboard_data.json debtor_analysis_data.json history.json dashboard_version.json", bat)

    def test_repo_ignores_local_runtime_artifacts(self):
        ignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
        for pattern in [".cache/", "__pycache__/", "*.log", "*.bak", "*.xlsx"]:
            self.assertIn(pattern, ignore)


if __name__ == "__main__":
    unittest.main()
