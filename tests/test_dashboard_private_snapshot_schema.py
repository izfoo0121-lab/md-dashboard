from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "migrations" / "2026-07-14_dashboard_private_snapshots.sql"
LOGIN_ATTEMPT_RPC_MIGRATION = (
    ROOT / "migrations" / "2026-07-14_dashboard_login_attempt_rpc.sql"
)
ACTIVATION_RPC_MIGRATION = (
    ROOT / "migrations" / "2026-07-15_dashboard_snapshot_activation.sql"
)


class DashboardPrivateSnapshotSchemaTests(unittest.TestCase):
    def test_migration_declares_the_private_gateway_schema(self):
        self.assertTrue(MIGRATION.is_file(), f"missing migration: {MIGRATION.name}")
        sql = " ".join(MIGRATION.read_text(encoding="utf-8").lower().split())

        required_fragments = (
            "create table if not exists public.dashboard_snapshots",
            "primary key (month, generation_id)",
            "manager_support_payload jsonb not null",
            "create table if not exists public.dashboard_agent_snapshots",
            "primary key (month, generation_id, agent)",
            "create table if not exists public.dashboard_manager_artifacts",
            "primary key (month_key, generation_id, artifact_key)",
            "create table if not exists public.dashboard_active_snapshots",
            "month_key text primary key",
            "agent_checksums jsonb not null",
            "artifact_checksums jsonb not null",
            "create table if not exists public.dashboard_sessions",
            "token_hash text primary key",
            "role text not null check (role in ('agent', 'manager'))",
            "create table if not exists public.dashboard_login_attempts",
            "attempts integer not null check (attempts >= 0)",
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
            "dashboard_active_snapshots",
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
        self.assertGreaterEqual(sql.count("generation_id uuid not null"), 4)
        self.assertIn(
            "foreign key (month, generation_id) references "
            "public.dashboard_snapshots(month, generation_id)",
            sql,
        )

    def test_activation_rpc_verifies_generation_before_pointer_switch(self):
        self.assertTrue(
            ACTIVATION_RPC_MIGRATION.is_file(),
            f"missing migration: {ACTIVATION_RPC_MIGRATION.name}",
        )
        sql = " ".join(
            ACTIVATION_RPC_MIGRATION.read_text(encoding="utf-8")
            .lower()
            .split()
        )

        self.assertIn(
            "create or replace function "
            "public.dashboard_activate_snapshot_generation",
            sql,
        )
        self.assertIn("from public.dashboard_agent_snapshots", sql)
        self.assertIn("from public.dashboard_manager_artifacts", sql)
        self.assertIn("jsonb_each_text(p_agent_checksums)", sql)
        self.assertIn("jsonb_each_text(p_artifact_checksums)", sql)
        self.assertIn(
            "p_agent_checksums is null or "
            "jsonb_typeof(p_agent_checksums) <> 'object'",
            sql,
        )
        self.assertIn(
            "p_artifact_checksums is null or "
            "jsonb_typeof(p_artifact_checksums) <> 'object'",
            sql,
        )
        self.assertIn("if p_activated_at is null", sql)
        self.assertIn(
            "shared_checksum text, agent_count integer, "
            "agent_checksums jsonb, artifact_checksums jsonb",
            sql,
        )
        self.assertIn("insert into public.dashboard_active_snapshots", sql)
        self.assertIn(
            "on conflict on constraint dashboard_active_snapshots_pkey "
            "do update",
            sql,
        )
        self.assertIn(
            "grant execute on function "
            "public.dashboard_activate_snapshot_generation",
            sql,
        )

    def test_login_attempt_reservation_rpc_is_atomic_and_idempotently_declared(self):
        self.assertTrue(
            LOGIN_ATTEMPT_RPC_MIGRATION.is_file(),
            f"missing migration: {LOGIN_ATTEMPT_RPC_MIGRATION.name}",
        )
        sql = " ".join(
            LOGIN_ATTEMPT_RPC_MIGRATION.read_text(encoding="utf-8")
            .lower()
            .split()
        )

        self.assertIn(
            "create or replace function public.dashboard_reserve_login_attempt",
            sql,
        )
        self.assertIn("insert into public.dashboard_login_attempts", sql)
        self.assertIn(
            "on conflict on constraint dashboard_login_attempts_pkey do update",
            sql,
        )
        self.assertIn("current_attempt.attempts + 1", sql)
        self.assertIn("reserved_count <= p_max_attempts", sql)
        self.assertIn(
            "grant execute on function public.dashboard_reserve_login_attempt",
            sql,
        )


if __name__ == "__main__":
    unittest.main()
