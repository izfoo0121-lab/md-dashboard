import copy
import hashlib
from pathlib import Path
import unittest
import uuid


ROOT = Path(__file__).resolve().parents[1]
BASE_MIGRATION = ROOT / "migrations" / "2026-07-14_dashboard_private_snapshots.sql"
BASE_LOGIN_RPC_MIGRATION = (
    ROOT / "migrations" / "2026-07-14_dashboard_login_attempt_rpc.sql"
)
ACTIVATION_BRIDGE_MIGRATION = (
    ROOT / "migrations" / "2026-07-15_dashboard_snapshot_activation.sql"
)
UPGRADE_MIGRATION = (
    ROOT / "migrations" / "2026-07-16_dashboard_secure_gateway_upgrade.sql"
)


def _normalized_sql(path):
    return " ".join(path.read_text(encoding="utf-8").lower().split())


def _generation_id(month):
    digest = hashlib.md5(
        f"dashboard-snapshot-generation:{month}".encode("utf-8"),
        usedforsecurity=False,
    ).hexdigest()
    return str(uuid.UUID(digest))


def _apply_upgrade_model(legacy):
    state = copy.deepcopy(legacy)
    state.setdefault("active", {})

    for snapshot in state["snapshots"]:
        snapshot.setdefault("generation_id", _generation_id(snapshot["month"]))

    generations = {
        snapshot["month"]: snapshot["generation_id"]
        for snapshot in state["snapshots"]
    }
    for row in state["agents"]:
        row.setdefault("generation_id", generations[row["month"]])

    only_month = next(iter(generations), None) if len(generations) == 1 else None
    for row in state["artifacts"]:
        month = row.get("month_key") or row.get("payload", {}).get("current_month")
        month = month or only_month
        if month not in generations:
            raise ValueError("manager artifact month cannot be resolved")
        row["month_key"] = month
        row.setdefault("generation_id", generations[month])

    for row in state["login_attempts"]:
        if "attempts" not in row:
            row["attempts"] = row.pop("failures")

    for snapshot in state["snapshots"]:
        month = snapshot["month"]
        if month in state["active"]:
            continue
        generation_id = snapshot["generation_id"]
        agents = [
            row
            for row in state["agents"]
            if row["month"] == month and row["generation_id"] == generation_id
        ]
        artifacts = [
            row
            for row in state["artifacts"]
            if row["month_key"] == month
            and row["generation_id"] == generation_id
        ]
        state["active"][month] = {
            "month_key": month,
            "generation_id": generation_id,
            "shared_checksum": snapshot["checksum"],
            "agent_count": len(agents),
            "agent_checksums": {
                row["agent"]: row["checksum"] for row in agents
            },
            "artifact_checksums": {
                row["artifact_key"]: row["checksum"] for row in artifacts
            },
        }

    state["contract"] = {
        "snapshot_pk": ("month", "generation_id"),
        "agent_pk": ("month", "generation_id", "agent"),
        "artifact_pk": ("month_key", "generation_id", "artifact_key"),
        "login_counter": "attempts",
        "functions": {"dashboard_reserve_login_attempt", "dashboard_activate_snapshot_generation"},
    }
    return state


class DashboardPrivateSnapshotSchemaTests(unittest.TestCase):
    def test_base_migrations_preserve_the_67b3a62_contract(self):
        self.assertTrue(BASE_MIGRATION.is_file())
        self.assertTrue(BASE_LOGIN_RPC_MIGRATION.is_file())
        schema_sql = _normalized_sql(BASE_MIGRATION)
        rpc_sql = _normalized_sql(BASE_LOGIN_RPC_MIGRATION)

        self.assertIn("month text primary key", schema_sql)
        self.assertIn("primary key (month, agent)", schema_sql)
        self.assertIn("artifact_key text primary key", schema_sql)
        self.assertIn(
            "failures integer not null check (failures >= 0)",
            schema_sql,
        )
        self.assertNotIn("generation_id", schema_sql)
        self.assertNotIn("dashboard_active_snapshots", schema_sql)
        self.assertIn(
            "create or replace function public.dashboard_record_login_failure",
            rpc_sql,
        )
        self.assertNotIn("dashboard_reserve_login_attempt", rpc_sql)

    def test_function_only_activation_migration_is_safe_for_legacy_schema(self):
        self.assertTrue(ACTIVATION_BRIDGE_MIGRATION.is_file())
        sql = _normalized_sql(ACTIVATION_BRIDGE_MIGRATION)

        self.assertIn("superseded", sql)
        self.assertNotIn(
            "create or replace function public.dashboard_activate_snapshot_generation",
            sql,
        )

    def test_forward_upgrade_transforms_the_legacy_contract(self):
        self.assertTrue(
            UPGRADE_MIGRATION.is_file(),
            f"missing migration: {UPGRADE_MIGRATION.name}",
        )
        sql = _normalized_sql(UPGRADE_MIGRATION)

        required_fragments = (
            "alter table public.dashboard_snapshots add column if not exists generation_id uuid",
            "md5('dashboard-snapshot-generation:' || month)::uuid",
            "alter table public.dashboard_agent_snapshots add column if not exists generation_id uuid",
            "alter table public.dashboard_manager_artifacts add column if not exists month_key text",
            "alter table public.dashboard_manager_artifacts add column if not exists generation_id uuid",
            "primary key (month, generation_id)",
            "primary key (month, generation_id, agent)",
            "primary key (month_key, generation_id, artifact_key)",
            "create table if not exists public.dashboard_active_snapshots",
            "insert into public.dashboard_active_snapshots",
            "agent_checksums",
            "artifact_checksums",
            "add column if not exists attempts integer",
            "drop column if exists failures",
            "drop function if exists public.dashboard_record_login_failure",
            "create or replace function public.dashboard_reserve_login_attempt",
            "create or replace function public.dashboard_activate_snapshot_generation",
        )
        for fragment in required_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, sql)

        self.assertNotIn("truncate table", sql)
        self.assertNotIn("delete from public.dashboard_snapshots", sql)
        self.assertNotIn("delete from public.dashboard_agent_snapshots", sql)
        self.assertNotIn("delete from public.dashboard_manager_artifacts", sql)

    def test_base_then_upgrade_model_preserves_and_activates_legacy_data(self):
        legacy = {
            "snapshots": [
                {
                    "month": "Jul 26",
                    "checksum": "shared-checksum",
                    "generated_at": "2026-07-14T12:00:00Z",
                }
            ],
            "agents": [
                {"month": "Jul 26", "agent": "BEN", "checksum": "ben"},
                {"month": "Jul 26", "agent": "CJ", "checksum": "cj"},
            ],
            "artifacts": [
                {
                    "artifact_key": "debtor_analysis",
                    "checksum": "analysis",
                    "payload": {"current_month": "Jul 26"},
                }
            ],
            "login_attempts": [
                {
                    "bucket_key": "network",
                    "window_started_at": "2026-07-14T12:00:00Z",
                    "failures": 4,
                }
            ],
        }

        upgraded = _apply_upgrade_model(legacy)
        upgraded_twice = _apply_upgrade_model(upgraded)
        generation_id = _generation_id("Jul 26")

        self.assertEqual(legacy["snapshots"][0]["checksum"], "shared-checksum")
        self.assertEqual(generation_id, upgraded["snapshots"][0]["generation_id"])
        self.assertEqual(
            {generation_id},
            {row["generation_id"] for row in upgraded["agents"]},
        )
        self.assertEqual(generation_id, upgraded["artifacts"][0]["generation_id"])
        self.assertEqual("Jul 26", upgraded["artifacts"][0]["month_key"])
        self.assertEqual(4, upgraded["login_attempts"][0]["attempts"])
        self.assertNotIn("failures", upgraded["login_attempts"][0])
        self.assertEqual(
            {
                "month_key": "Jul 26",
                "generation_id": generation_id,
                "shared_checksum": "shared-checksum",
                "agent_count": 2,
                "agent_checksums": {"BEN": "ben", "CJ": "cj"},
                "artifact_checksums": {"debtor_analysis": "analysis"},
            },
            upgraded["active"]["Jul 26"],
        )
        self.assertEqual(upgraded, upgraded_twice)

    def test_base_then_upgrade_model_is_safe_with_no_existing_rows(self):
        upgraded = _apply_upgrade_model(
            {
                "snapshots": [],
                "agents": [],
                "artifacts": [],
                "login_attempts": [],
            }
        )

        self.assertEqual({}, upgraded["active"])
        self.assertEqual("attempts", upgraded["contract"]["login_counter"])
        self.assertEqual(
            ("month", "generation_id"),
            upgraded["contract"]["snapshot_pk"],
        )

    def test_activation_rpc_verifies_generation_before_pointer_switch(self):
        self.assertTrue(UPGRADE_MIGRATION.is_file())
        sql = _normalized_sql(UPGRADE_MIGRATION)

        self.assertIn("from public.dashboard_agent_snapshots", sql)
        self.assertIn("from public.dashboard_manager_artifacts", sql)
        self.assertIn("jsonb_each_text(p_agent_checksums)", sql)
        self.assertIn("jsonb_each_text(p_artifact_checksums)", sql)
        self.assertIn("insert into public.dashboard_active_snapshots", sql)
        self.assertIn(
            "on conflict on constraint dashboard_active_snapshots_pkey do update",
            sql,
        )

    def test_login_attempt_reservation_rpc_is_replaced_by_the_upgrade(self):
        self.assertTrue(UPGRADE_MIGRATION.is_file())
        sql = _normalized_sql(UPGRADE_MIGRATION)

        self.assertIn("insert into public.dashboard_login_attempts", sql)
        self.assertIn("current_attempt.attempts + 1", sql)
        self.assertIn("reserved_count <= p_max_attempts", sql)
        self.assertIn(
            "grant execute on function public.dashboard_reserve_login_attempt",
            sql,
        )

    def test_upgrade_rejects_duplicate_pins_before_declaring_uniqueness(self):
        self.assertTrue(UPGRADE_MIGRATION.is_file())
        sql = _normalized_sql(UPGRADE_MIGRATION)

        duplicate_check = "group by pin having count(*) > 1"
        unique_index = (
            "create unique index if not exists dashboard_agent_pins_pin_uidx "
            "on public.agent_pins(pin)"
        )
        self.assertIn("create table if not exists public.agent_pins", sql)
        self.assertIn(duplicate_check, sql)
        self.assertIn(
            "duplicate agent pin values must be resolved before secure gateway upgrade",
            sql,
        )
        self.assertIn(unique_index, sql)
        self.assertLess(sql.index(duplicate_check), sql.index(unique_index))
        self.assertIn("alter table public.agent_pins enable row level security", sql)
        self.assertIn(
            "revoke all on public.agent_pins from anon, authenticated",
            sql,
        )


if __name__ == "__main__":
    unittest.main()
