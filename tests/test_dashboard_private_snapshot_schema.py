from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "migrations" / "2026-07-14_dashboard_private_snapshots.sql"


class DashboardPrivateSnapshotSchemaTests(unittest.TestCase):
    def test_migration_declares_the_private_gateway_schema(self):
        self.assertTrue(MIGRATION.is_file(), f"missing migration: {MIGRATION.name}")
        sql = " ".join(MIGRATION.read_text(encoding="utf-8").lower().split())

        required_fragments = (
            "create table if not exists public.dashboard_snapshots",
            "manager_support_payload jsonb not null",
            "create table if not exists public.dashboard_agent_snapshots",
            "primary key (month, agent)",
            "create table if not exists public.dashboard_manager_artifacts",
            "artifact_key text primary key",
            "create table if not exists public.dashboard_sessions",
            "token_hash text primary key",
            "role text not null check (role in ('agent', 'manager'))",
            "create table if not exists public.dashboard_login_attempts",
            "failures integer not null check (failures >= 0)",
            "dashboard_agent_snapshots_agent_month_idx",
            "dashboard_sessions_expires_idx",
        )
        for fragment in required_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, sql)

        private_tables = (
            "dashboard_snapshots",
            "dashboard_agent_snapshots",
            "dashboard_manager_artifacts",
            "dashboard_sessions",
            "dashboard_login_attempts",
        )
        for table in private_tables:
            with self.subTest(table=table, protection="rls"):
                self.assertIn(
                    f"alter table public.{table} enable row level security", sql
                )
            with self.subTest(table=table, protection="grants"):
                self.assertIn(
                    f"revoke all on public.{table} from anon, authenticated", sql
                )

        self.assertNotIn("create policy", sql)


if __name__ == "__main__":
    unittest.main()
