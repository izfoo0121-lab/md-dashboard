from contextlib import redirect_stderr, redirect_stdout
import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import parse_qs, urlparse

from dashboard_snapshot_contract import (
    SnapshotValidationError,
    build_manager_artifact,
    checksum_payload,
    split_snapshot,
    validate_snapshot,
)
from publish_dashboard_snapshots import (
    PublishTransportError,
    PublishVerificationError,
    SupabaseRestTransport,
    main,
    publish_bundle,
)


def sample_campaign_group_progress():
    return {
        "camp_july_penetration": {
            "id": "camp_july_penetration",
            "name": "July Penetration Campaign",
            "groups": {
                "CENTRAL": {
                    "group": "CENTRAL",
                    "new_accounts": 4,
                    "converted_count": 2,
                }
            },
            "agents": {
                "BEN": {
                    "agent": "BEN",
                    "group": "CENTRAL",
                    "converted_debtors": [
                        {
                            "code": "B-CAMPAIGN-001",
                            "name": "Ben Campaign Debtor",
                            "ctn": 3,
                        }
                    ],
                    "not_converted_debtors": [],
                },
                "CJ": {
                    "agent": "CJ",
                    "group": "CENTRAL",
                    "converted_debtors": [],
                    "not_converted_debtors": [
                        {
                            "code": "C-PEER-SECRET-001",
                            "name": "CJ Peer Secret Debtor",
                            "ctn": 0,
                        }
                    ],
                },
            },
            "agent_rows": [
                {"agent": "BEN", "converted_count": 1},
                {"agent": "CJ", "converted_count": 0},
            ],
        }
    }


def sample_snapshot():
    return {
        "generated_at": "2026-07-14T12:00:00+00:00",
        "current_month": "Jul 26",
        "data_quality": {"typed_debtors": 2},
        "working_days": {"total": 27},
        "group_brand_targets": {"BEN": {"ZLB": 10}},
        "team": {"sales": 200},
        "config": {
            "zlb_brands": ["EVO", "BISON"],
            "brand_config": {
                "EVO": ["EVO-A", "EVO-B"],
                "BISON": ["BISON-A"],
            },
            "sku_rules_snapshot": {
                "version": "2026-07-14",
                "new_sku_groups": {
                    "EVO": {
                        "label": "Evolution",
                        "item_codes": ["EVO-A"],
                        "item_groups": ["EVO"],
                        "item_code_prefixes": ["EVO"],
                        "item_group_prefixes": ["EV"],
                        "manager_pin": "RULE-MANAGER-9988",
                    }
                },
                "other_sku_groups": {
                    "CMLT": {
                        "label": "CMLT",
                        "item_codes": ["CMLT"],
                        "access_secret": "RULE-ACCESS-SECRET",
                    }
                },
                "future_rule_secret": "FUTURE-RULE-SECRET",
            },
            "sku_rules": {
                "new_sku_groups": {
                    "BISON": {
                        "label": "Bison",
                        "item_codes": ["BISON-A"],
                        "admin_pin": "RULE-ADMIN-8877",
                    }
                }
            },
            "group_incentive": "RM 100",
            "agent_pins": {"BEN": "1001", "CJ": "1002"},
            "manager_pin": "9988",
            "admin_pin": "8877",
            "future_access_secret": "UNKNOWN-FUTURE-SECRET",
        },
        "campaign_group_progress": sample_campaign_group_progress(),
        "birthday_by_month": {"Jul 26": ["CJ debtor"]},
        "brand_penetration_candidates": ["CJ debtor"],
        "agents": {
            "BEN": {
                "debtor_cards": {
                    "debtors": [
                        {"debtor_code": "B001", "company_name": "Ben debtor"}
                    ]
                },
                "sales_progression": {"current": 100},
            },
            "CJ": {
                "debtor_cards": {
                    "debtors": [
                        {"debtor_code": "C001", "company_name": "CJ debtor"}
                    ]
                },
                "sales_progression": {"current": 100},
            },
        },
    }


def sample_bundle():
    return split_snapshot(sample_snapshot())


def sample_analysis():
    return {
        "generated_at": "2026-07-14T12:00:00+00:00",
        "current_month": "Jul 26",
        "scope_area": "GRP 2A",
        "months": ["Jul 26"],
        "debtors": [
            {
                "debtor_code": "B001",
                "company_name": "Ben debtor",
                "agent": "BEN",
            }
        ],
        "records": [
            {
                "month": "Jul 26",
                "debtor_code": "B001",
                "agent": "BEN",
                "brand": "EVO",
                "sku": "EVO-A",
            }
        ],
        "data_quality": {"sales_rows": 1},
    }


def sample_analysis_artifact():
    return build_manager_artifact(
        "debtor_analysis",
        sample_analysis(),
        "2026-07-14T12:00:00+00:00",
    )


OLD_GENERATION = "00000000-0000-4000-8000-000000000001"
NEW_GENERATION = "00000000-0000-4000-8000-000000000002"


class FakeTransport:
    KEY_FIELDS = {
        "dashboard_snapshots": ("month", "generation_id"),
        "dashboard_agent_snapshots": ("month", "generation_id", "agent"),
        "dashboard_manager_artifacts": (
            "month_key",
            "generation_id",
            "artifact_key",
        ),
        "dashboard_active_snapshots": ("month_key",),
    }

    def __init__(
        self,
        readback_checksum=None,
        mutate_readback=None,
        ignore_deletes=False,
        fail_on_upsert=None,
    ):
        self.readback_checksum = readback_checksum
        self.mutate_readback = mutate_readback
        self.ignore_deletes = ignore_deletes
        self.fail_on_upsert = fail_on_upsert
        self.calls = []
        self.rows = {}

    def seed(self, table, row):
        key = tuple(row[field] for field in self.KEY_FIELDS[table])
        self.rows[(table, key)] = copy.deepcopy(row)

    def upsert(self, table, rows, on_conflict):
        self.calls.append(
            {
                "operation": "upsert",
                "table": table,
                "on_conflict": on_conflict,
                "authorization": "Bearer service-role",
            }
        )
        if table == self.fail_on_upsert:
            raise PublishTransportError(f"injected {table} upload failure")
        records = rows if isinstance(rows, list) else [rows]
        for row in records:
            key = tuple(row[field] for field in self.KEY_FIELDS[table])
            self.rows[(table, key)] = copy.deepcopy(row)

    def select_one(self, table, **filters):
        self.calls.append(
            {
                "operation": "select",
                "table": table,
                "filters": filters,
                "authorization": "Bearer service-role",
            }
        )
        key = tuple(filters[field] for field in self.KEY_FIELDS[table])
        row = copy.deepcopy(self.rows.get((table, key)))
        if row is None:
            return None
        if self.readback_checksum is not None and "checksum" in row:
            row["checksum"] = self.readback_checksum
        if self.mutate_readback is not None:
            row = self.mutate_readback(table, row)
        return row

    def select_many(self, table, **filters):
        self.calls.append(
            {
                "operation": "select",
                "table": table,
                "filters": filters,
                "authorization": "Bearer service-role",
            }
        )
        rows = []
        for (row_table, _key), stored in self.rows.items():
            if row_table != table:
                continue
            if any(stored.get(field) != value for field, value in filters.items()):
                continue
            row = copy.deepcopy(stored)
            if self.readback_checksum is not None and "checksum" in row:
                row["checksum"] = self.readback_checksum
            if self.mutate_readback is not None:
                row = self.mutate_readback(table, row)
            rows.append(row)
        return sorted(
            rows,
            key=lambda row: tuple(row[field] for field in self.KEY_FIELDS[table]),
        )

    def delete(self, table, **filters):
        self.calls.append(
            {
                "operation": "delete",
                "table": table,
                "filters": filters,
                "authorization": "Bearer service-role",
            }
        )
        if self.ignore_deletes:
            return 0
        keys = [
            stored_key
            for stored_key, row in self.rows.items()
            if stored_key[0] == table
            and all(row.get(field) == value for field, value in filters.items())
        ]
        for key in keys:
            del self.rows[key]
        return len(keys)

    def activate_generation(
        self,
        *,
        month_key,
        generation_id,
        shared_checksum,
        agent_checksums,
        artifact_checksums,
        activated_at,
    ):
        self.calls.append(
            {
                "operation": "activate",
                "table": "dashboard_active_snapshots",
                "month_key": month_key,
                "generation_id": generation_id,
                "authorization": "Bearer service-role",
            }
        )
        shared = self.rows.get(
            ("dashboard_snapshots", (month_key, generation_id))
        )
        agents = self.select_many(
            "dashboard_agent_snapshots",
            month=month_key,
            generation_id=generation_id,
        )
        artifacts = self.select_many(
            "dashboard_manager_artifacts",
            month_key=month_key,
            generation_id=generation_id,
        )
        if shared is None or shared.get("checksum") != shared_checksum:
            raise PublishVerificationError("activation shared checksum mismatch")
        if {row["agent"]: row["checksum"] for row in agents} != agent_checksums:
            raise PublishVerificationError("activation agent checksum mismatch")
        if {
            row["artifact_key"]: row["checksum"] for row in artifacts
        } != artifact_checksums:
            raise PublishVerificationError("activation artifact checksum mismatch")

        active = {
            "month_key": month_key,
            "generation_id": generation_id,
            "activated_at": activated_at,
            "shared_checksum": shared_checksum,
            "agent_count": len(agent_checksums),
            "agent_checksums": copy.deepcopy(agent_checksums),
            "artifact_checksums": copy.deepcopy(artifact_checksums),
        }
        self.seed("dashboard_active_snapshots", active)
        return copy.deepcopy(active)

    def cleanup_inactive_generations(self, *, month_key, active_generation_id):
        self.calls.append(
            {
                "operation": "cleanup",
                "table": "dashboard_snapshots",
                "month_key": month_key,
                "generation_id": active_generation_id,
                "authorization": "Bearer service-role",
            }
        )
        if self.ignore_deletes:
            return 0
        doomed = []
        for stored_key, row in self.rows.items():
            table = stored_key[0]
            if table == "dashboard_snapshots":
                matches_month = row.get("month") == month_key
            elif table == "dashboard_agent_snapshots":
                matches_month = row.get("month") == month_key
            elif table == "dashboard_manager_artifacts":
                matches_month = row.get("month_key") == month_key
            else:
                continue
            if matches_month and row.get("generation_id") != active_generation_id:
                doomed.append(stored_key)
        for key in doomed:
            del self.rows[key]
        return len(doomed)

    def read_active_resources(self, month_key):
        active = self.select_one(
            "dashboard_active_snapshots",
            month_key=month_key,
        )
        if active is None:
            return None
        generation_id = active["generation_id"]
        return {
            "active": active,
            "shared": self.select_one(
                "dashboard_snapshots",
                month=month_key,
                generation_id=generation_id,
            ),
            "agents": self.select_many(
                "dashboard_agent_snapshots",
                month=month_key,
                generation_id=generation_id,
            ),
            "artifacts": self.select_many(
                "dashboard_manager_artifacts",
                month_key=month_key,
                generation_id=generation_id,
            ),
        }


class FakeResponse:
    def __init__(self, payload=b""):
        self.payload = payload

    def read(self):
        return self.payload

    def close(self):
        pass


class SnapshotContractTests(unittest.TestCase):
    def test_split_contains_one_agent_and_no_peer_debtors(self):
        bundle = split_snapshot(sample_snapshot())

        ben = bundle["agents"]["BEN"]["agent_payload"]

        self.assertEqual(["BEN"], list(ben["agents"]))
        self.assertNotIn("CJ", json.dumps(ben))

    def test_assembled_agent_data_excludes_peer_campaign_identifiers(self):
        bundle = split_snapshot(sample_snapshot())
        assembled = {
            **bundle["shared"]["shared_payload"],
            **bundle["agents"]["BEN"]["agent_payload"],
        }
        encoded = json.dumps(assembled, sort_keys=True)

        self.assertNotIn('"CJ"', encoded)
        self.assertNotIn("C-PEER-SECRET-001", encoded)
        self.assertNotIn("CJ Peer Secret Debtor", encoded)

    def test_shared_payload_has_no_agents_block(self):
        bundle = split_snapshot(sample_snapshot())

        self.assertNotIn("agents", bundle["shared"]["shared_payload"])

    def test_month_mismatch_is_rejected(self):
        with self.assertRaisesRegex(SnapshotValidationError, "month mismatch"):
            validate_snapshot(sample_snapshot(), expected_month="Jun 26")

    def test_empty_snapshot_is_rejected(self):
        snapshot = sample_snapshot()
        for block in snapshot["agents"].values():
            block["debtor_cards"]["debtors"] = []

        with self.assertRaisesRegex(SnapshotValidationError, "too few debtor"):
            validate_snapshot(snapshot, expected_month="Jul 26")

    def test_malformed_debtor_cards_are_rejected(self):
        snapshot = sample_snapshot()
        snapshot["agents"]["BEN"]["debtor_cards"] = None

        with self.assertRaises(Exception) as caught:
            validate_snapshot(snapshot)
        self.assertIsInstance(caught.exception, SnapshotValidationError)
        self.assertIn("debtor records", str(caught.exception))

    def test_shared_payload_uses_safe_allowlist(self):
        shared = split_snapshot(sample_snapshot())["shared"]["shared_payload"]

        self.assertEqual(
            {
                "generated_at",
                "current_month",
                "data_quality",
                "working_days",
                "group_brand_targets",
                "team",
                "config",
            },
            set(shared),
        )
        self.assertNotIn("campaign_group_progress", shared)
        self.assertNotIn("birthday_by_month", shared)
        self.assertNotIn("brand_penetration_candidates", shared)

    def test_config_projection_recursively_excludes_credentials_and_unknown_keys(self):
        bundle = split_snapshot(sample_snapshot())
        shared = bundle["shared"]["shared_payload"]
        assembled_agent = {
            **shared,
            **bundle["agents"]["BEN"]["agent_payload"],
        }
        manager_support = bundle["shared"]["manager_support_payload"]

        for label, payload in {
            "shared": shared,
            "agent": assembled_agent,
            "manager_support": manager_support,
        }.items():
            encoded = json.dumps(payload, sort_keys=True)
            with self.subTest(label=label):
                for forbidden in (
                    "agent_pins",
                    "manager_pin",
                    "admin_pin",
                    "access_secret",
                    "future_access_secret",
                    "1001",
                    "1002",
                    "9988",
                    "8877",
                    "RULE-MANAGER-9988",
                    "RULE-ADMIN-8877",
                    "RULE-ACCESS-SECRET",
                    "FUTURE-RULE-SECRET",
                    "UNKNOWN-FUTURE-SECRET",
                ):
                    self.assertNotIn(forbidden, encoded)

                config = payload["config"]
                self.assertEqual(
                    {
                        "zlb_brands",
                        "brand_config",
                        "sku_rules_snapshot",
                        "sku_rules",
                        "group_incentive",
                    },
                    set(config),
                )
                self.assertEqual(["EVO", "BISON"], config["zlb_brands"])
                self.assertEqual(
                    ["EVO-A", "EVO-B"],
                    config["brand_config"]["EVO"],
                )
                self.assertEqual(
                    ["EVO-A"],
                    config["sku_rules_snapshot"]["new_sku_groups"]["EVO"][
                        "item_codes"
                    ],
                )
                self.assertEqual("RM 100", config["group_incentive"])

    def test_manager_support_does_not_duplicate_agents(self):
        support = split_snapshot(sample_snapshot())["shared"][
            "manager_support_payload"
        ]

        self.assertNotIn("agents", support)
        self.assertIn("birthday_by_month", support)
        self.assertEqual(
            sample_campaign_group_progress(),
            support["campaign_group_progress"],
        )

    def test_manager_artifact_is_checksummed_separately(self):
        row = build_manager_artifact(
            "debtor_analysis", {"months": ["Jul 26"]}, "2026-07-14"
        )

        self.assertEqual("debtor_analysis", row["artifact_key"])
        self.assertEqual("2026-07-14", row["generated_at"])
        self.assertEqual(64, len(row["checksum"]))

    def test_checksum_is_stable_across_key_order(self):
        self.assertEqual(
            checksum_payload({"a": 1, "b": 2}),
            checksum_payload({"b": 2, "a": 1}),
        )

    def test_non_finite_snapshot_value_is_rejected(self):
        snapshot = sample_snapshot()
        snapshot["team"]["sales"] = float("nan")

        with self.assertRaisesRegex(SnapshotValidationError, "finite JSON"):
            validate_snapshot(snapshot)


class SnapshotPublisherTests(unittest.TestCase):
    def _seed_active_generation(self, transport):
        transport.seed(
            "dashboard_snapshots",
            {
                "month": "Jul 26",
                "generation_id": OLD_GENERATION,
                "shared_payload": {"team": {"sales": 10}},
                "manager_support_payload": {},
                "checksum": "old-shared-checksum",
                "generated_at": "2026-06-01T00:00:00+00:00",
                "source_version": "old-source",
            },
        )
        transport.seed(
            "dashboard_agent_snapshots",
            {
                "month": "Jul 26",
                "generation_id": OLD_GENERATION,
                "agent": "ARCHIVED",
                "agent_payload": {
                    "agents": {
                        "ARCHIVED": {
                            "debtor_cards": {
                                "debtors": [
                                    {
                                        "debtor_code": "OLD-001",
                                        "company_name": "Archived Peer Debtor",
                                    }
                                ]
                            }
                        }
                    }
                },
                "checksum": "old-agent-checksum",
                "generated_at": "2026-06-01T00:00:00+00:00",
            },
        )
        transport.seed(
            "dashboard_manager_artifacts",
            {
                "month_key": "Jul 26",
                "generation_id": OLD_GENERATION,
                "artifact_key": "debtor_analysis",
                "payload": {"current_month": "Jul 26", "records": ["old"]},
                "checksum": "old-artifact-checksum",
                "generated_at": "2026-06-01T00:00:00+00:00",
            },
        )
        transport.seed(
            "dashboard_active_snapshots",
            {
                "month_key": "Jul 26",
                "generation_id": OLD_GENERATION,
                "activated_at": "2026-06-01T00:00:00+00:00",
                "shared_checksum": "old-shared-checksum",
                "agent_count": 1,
                "agent_checksums": {"ARCHIVED": "old-agent-checksum"},
                "artifact_checksums": {
                    "debtor_analysis": "old-artifact-checksum"
                },
            },
        )

    def _assert_analysis_rejected_without_writes(self, analysis):
        with tempfile.TemporaryDirectory() as temp_dir:
            snapshot_path = Path(temp_dir) / "dashboard_data.json"
            analysis_path = Path(temp_dir) / "debtor_analysis_data.json"
            snapshot_path.write_text(json.dumps(sample_snapshot()), encoding="utf-8")
            analysis_path.write_text(json.dumps(analysis), encoding="utf-8")
            transport = FakeTransport()
            errors = io.StringIO()
            output = io.StringIO()

            with redirect_stderr(errors), redirect_stdout(output):
                exit_code = main(
                    [
                        "--input",
                        str(snapshot_path),
                        "--analysis-input",
                        str(analysis_path),
                        "--month",
                        "Jul 26",
                        "--source-version",
                        "abc123",
                    ],
                    environ={
                        "SUPABASE_URL": "https://example.supabase.co",
                        "SUPABASE_SERVICE_KEY": "service-role-secret",
                    },
                    transport_factory=lambda *_args, **_kwargs: transport,
                )

        self.assertEqual(1, exit_code)
        self.assertEqual(
            [],
            [
                call
                for call in transport.calls
                if call["operation"] in {"upsert", "delete"}
            ],
        )
        self.assertIn("debtor analysis", errors.getvalue().lower())

    def test_empty_debtor_analysis_is_rejected_before_any_write(self):
        self._assert_analysis_rejected_without_writes({})

    def test_missing_debtor_analysis_is_rejected_before_any_write(self):
        transport = FakeTransport()

        with self.assertRaisesRegex(
            SnapshotValidationError,
            "debtor analysis artifact is required",
        ):
            publish_bundle(
                sample_bundle(),
                [],
                transport,
                source_version="abc123",
                generation_id_factory=lambda: NEW_GENERATION,
            )

        self.assertEqual(
            [],
            [
                call
                for call in transport.calls
                if call["operation"] in {"upsert", "delete", "activate"}
            ],
        )

    def test_debtor_analysis_requires_matching_month_before_any_write(self):
        missing_month = sample_analysis()
        del missing_month["current_month"]
        mismatched_month = sample_analysis()
        mismatched_month["current_month"] = "Jun 26"

        for label, analysis in {
            "missing": missing_month,
            "mismatched": mismatched_month,
        }.items():
            with self.subTest(label=label):
                self._assert_analysis_rejected_without_writes(analysis)

    def test_incomplete_debtor_analysis_is_rejected_before_any_write(self):
        cases = {}
        for field in ("months", "debtors", "records"):
            analysis = sample_analysis()
            analysis[field] = []
            cases[f"empty_{field}"] = analysis

        empty_quality = sample_analysis()
        empty_quality["data_quality"] = {}
        cases["empty_data_quality"] = empty_quality

        missing_debtor_identity = sample_analysis()
        del missing_debtor_identity["debtors"][0]["debtor_code"]
        cases["missing_debtor_identity"] = missing_debtor_identity

        missing_record_identity = sample_analysis()
        del missing_record_identity["records"][0]["sku"]
        cases["missing_record_identity"] = missing_record_identity

        for label, analysis in cases.items():
            with self.subTest(label=label):
                self._assert_analysis_rejected_without_writes(analysis)

    def test_publish_uses_service_transport_and_reads_rows_back(self):
        transport = FakeTransport()

        result = publish_bundle(
            sample_bundle(),
            [sample_analysis_artifact()],
            transport,
            source_version="abc123",
            generation_id_factory=lambda: NEW_GENERATION,
        )

        self.assertEqual(
            {"Jul 26", "BEN", "CJ", "debtor_analysis"},
            set(result["verified_keys"]),
        )
        self.assertTrue(
            all("service-role" in call["authorization"] for call in transport.calls)
        )
        self.assertEqual(NEW_GENERATION, result["generation_id"])
        self.assertGreaterEqual(
            sum(call["operation"] == "select" for call in transport.calls),
            4,
        )

    def test_failed_staging_leaves_previous_generation_visible(self):
        transport = FakeTransport(
            fail_on_upsert="dashboard_manager_artifacts"
        )
        self._seed_active_generation(transport)

        with self.assertRaisesRegex(
            PublishTransportError,
            "injected dashboard_manager_artifacts upload failure",
        ):
            publish_bundle(
                sample_bundle(),
                [sample_analysis_artifact()],
                transport,
                source_version="abc123",
                generation_id_factory=lambda: NEW_GENERATION,
            )

        visible = transport.read_active_resources("Jul 26")
        self.assertEqual(OLD_GENERATION, visible["active"]["generation_id"])
        self.assertEqual(OLD_GENERATION, visible["shared"]["generation_id"])
        self.assertEqual(
            {OLD_GENERATION},
            {row["generation_id"] for row in visible["agents"]},
        )
        self.assertEqual(
            {OLD_GENERATION},
            {row["generation_id"] for row in visible["artifacts"]},
        )
        self.assertFalse(
            any(call["operation"] == "activate" for call in transport.calls)
        )

    def test_successful_publish_atomically_advances_all_active_resources(self):
        transport = FakeTransport()
        self._seed_active_generation(transport)

        result = publish_bundle(
            sample_bundle(),
            [sample_analysis_artifact()],
            transport,
            source_version="abc123",
            generation_id_factory=lambda: NEW_GENERATION,
        )
        visible = transport.read_active_resources("Jul 26")
        manager_rows = visible["agents"]
        manager_agents = {
            row["agent"]: row["agent_payload"]["agents"][row["agent"]]
            for row in manager_rows
        }

        self.assertEqual(NEW_GENERATION, result["generation_id"])
        self.assertEqual(NEW_GENERATION, visible["active"]["generation_id"])
        self.assertEqual(NEW_GENERATION, visible["shared"]["generation_id"])
        self.assertEqual(
            {NEW_GENERATION},
            {row["generation_id"] for row in manager_rows},
        )
        self.assertEqual(
            {NEW_GENERATION},
            {row["generation_id"] for row in visible["artifacts"]},
        )
        self.assertEqual({"BEN", "CJ"}, set(manager_agents))
        self.assertNotIn("ARCHIVED", json.dumps(manager_agents))
        self.assertNotIn("Archived Peer Debtor", json.dumps(manager_agents))
        operations = [call["operation"] for call in transport.calls]
        self.assertLess(operations.index("activate"), operations.index("cleanup"))

    def test_publish_fails_unless_final_agent_count_and_list_are_exact(self):
        transport = FakeTransport()
        transport.seed(
            "dashboard_agent_snapshots",
            {
                "month": "Jul 26",
                "generation_id": NEW_GENERATION,
                "agent": "ARCHIVED",
                "agent_payload": {"agents": {"ARCHIVED": {}}},
                "checksum": "stale-checksum",
                "generated_at": "2026-06-01T00:00:00+00:00",
            },
        )

        with self.assertRaisesRegex(
            PublishVerificationError,
            "agent snapshot set mismatch",
        ):
            publish_bundle(
                sample_bundle(),
                [sample_analysis_artifact()],
                transport,
                source_version="abc123",
                generation_id_factory=lambda: NEW_GENERATION,
            )

    def test_publish_verifies_agent_checksums_from_complete_month_readback(self):
        def change_ben_checksum(table, row):
            if table == "dashboard_agent_snapshots" and row["agent"] == "BEN":
                row["checksum"] = "wrong"
            return row

        transport = FakeTransport(mutate_readback=change_ben_checksum)

        with self.assertRaisesRegex(
            PublishVerificationError,
            "BEN snapshot checksum mismatch",
        ):
            publish_bundle(
                sample_bundle(),
                [sample_analysis_artifact()],
                transport,
                source_version="abc123",
            )

    def test_publish_fails_when_readback_checksum_differs(self):
        transport = FakeTransport(readback_checksum="wrong")

        with self.assertRaisesRegex(
            PublishVerificationError, "shared snapshot checksum mismatch"
        ):
            publish_bundle(
                sample_bundle(),
                [sample_analysis_artifact()],
                transport,
                source_version="abc123",
            )

    def test_publish_fails_when_readback_identity_differs(self):
        def change_ben_agent(table, row):
            if table == "dashboard_agent_snapshots" and row["agent"] == "BEN":
                row["agent"] = "CJ"
            return row

        transport = FakeTransport(mutate_readback=change_ben_agent)

        with self.assertRaisesRegex(PublishVerificationError, "identity mismatch"):
            publish_bundle(
                sample_bundle(),
                [sample_analysis_artifact()],
                transport,
                source_version="abc123",
            )

    def test_rest_transport_keeps_service_key_in_request_headers(self):
        requests = []

        def opener(request, timeout):
            requests.append((request, timeout))
            return FakeResponse()

        transport = SupabaseRestTransport(
            "https://example.supabase.co",
            "service-role-secret",
            timeout=7,
            opener=opener,
        )

        transport.upsert(
            "dashboard_snapshots",
            {
                "month": "Jul 26",
                "generation_id": NEW_GENERATION,
                "checksum": "abc",
            },
            on_conflict="month,generation_id",
        )

        request, timeout = requests[0]
        headers = {key.lower(): value for key, value in request.header_items()}
        self.assertEqual("Bearer service-role-secret", headers["authorization"])
        self.assertEqual("service-role-secret", headers["apikey"])
        self.assertEqual(7, timeout)
        self.assertNotIn("service-role-secret", request.full_url)

    def test_rest_transport_readback_selects_only_identity_and_checksum(self):
        requests = []

        def opener(request, timeout):
            requests.append(request)
            return FakeResponse(
                (
                    '[{"month":"Jul 26","generation_id":"'
                    + NEW_GENERATION
                    + '","checksum":"abc"}]'
                ).encode("utf-8")
            )

        transport = SupabaseRestTransport(
            "https://example.supabase.co",
            "service-role-secret",
            opener=opener,
        )

        row = transport.select_one(
            "dashboard_snapshots",
            month="Jul 26",
            generation_id=NEW_GENERATION,
        )

        query = parse_qs(urlparse(requests[0].full_url).query)
        self.assertEqual(["month,generation_id,checksum"], query["select"])
        self.assertEqual(["eq.Jul 26"], query["month"])
        self.assertEqual([f"eq.{NEW_GENERATION}"], query["generation_id"])
        self.assertEqual("abc", row["checksum"])

    def test_rest_transport_lists_and_cleans_by_generation(self):
        requests = []
        responses = iter(
            [
                FakeResponse(
                    (
                        '[{"month":"Jul 26","generation_id":"'
                        + NEW_GENERATION
                        + '","agent":"BEN","checksum":"abc"}]'
                    ).encode("utf-8")
                ),
                FakeResponse(),
            ]
        )

        def opener(request, timeout):
            requests.append(request)
            return next(responses)

        transport = SupabaseRestTransport(
            "https://example.supabase.co",
            "service-role-secret",
            opener=opener,
        )

        rows = transport.select_many(
            "dashboard_agent_snapshots",
            month="Jul 26",
            generation_id=NEW_GENERATION,
        )
        transport.cleanup_inactive_generations(
            month_key="Jul 26",
            active_generation_id=NEW_GENERATION,
        )

        list_query = parse_qs(urlparse(requests[0].full_url).query)
        delete_query = parse_qs(urlparse(requests[1].full_url).query)
        self.assertEqual(
            ["month,generation_id,agent,checksum"],
            list_query["select"],
        )
        self.assertEqual(["eq.Jul 26"], list_query["month"])
        self.assertEqual(
            [f"eq.{NEW_GENERATION}"],
            list_query["generation_id"],
        )
        self.assertEqual(["eq.Jul 26"], delete_query["month"])
        self.assertEqual(
            [f"neq.{NEW_GENERATION}"],
            delete_query["generation_id"],
        )
        self.assertEqual("DELETE", requests[1].method)
        self.assertEqual("BEN", rows[0]["agent"])

    def test_rest_transport_activates_generation_through_rpc(self):
        requests = []
        active = {
            "month_key": "Jul 26",
            "generation_id": NEW_GENERATION,
            "activated_at": "2026-07-15T00:00:00+00:00",
            "shared_checksum": "shared",
            "agent_count": 2,
            "agent_checksums": {"BEN": "ben", "CJ": "cj"},
            "artifact_checksums": {"debtor_analysis": "analysis"},
        }

        def opener(request, timeout):
            requests.append(request)
            return FakeResponse(json.dumps(active).encode("utf-8"))

        transport = SupabaseRestTransport(
            "https://example.supabase.co",
            "service-role-secret",
            opener=opener,
        )

        result = transport.activate_generation(
            month_key="Jul 26",
            generation_id=NEW_GENERATION,
            shared_checksum="shared",
            agent_checksums={"BEN": "ben", "CJ": "cj"},
            artifact_checksums={"debtor_analysis": "analysis"},
            activated_at="2026-07-15T00:00:00+00:00",
        )

        request = requests[0]
        self.assertTrue(
            request.full_url.endswith(
                "/rest/v1/rpc/dashboard_activate_snapshot_generation"
            )
        )
        self.assertEqual("POST", request.method)
        self.assertEqual(
            NEW_GENERATION,
            json.loads(request.data)["p_generation_id"],
        )
        self.assertEqual(NEW_GENERATION, result["generation_id"])

    def test_dry_run_validates_files_without_credentials_or_transport(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            snapshot_path = Path(temp_dir) / "dashboard_data.json"
            analysis_path = Path(temp_dir) / "debtor_analysis_data.json"
            snapshot_path.write_text(json.dumps(sample_snapshot()), encoding="utf-8")
            analysis_path.write_text(
                json.dumps(sample_analysis()),
                encoding="utf-8",
            )
            output = io.StringIO()

            with redirect_stdout(output):
                exit_code = main(
                    [
                        "--input",
                        str(snapshot_path),
                        "--analysis-input",
                        str(analysis_path),
                        "--month",
                        "Jul 26",
                        "--source-version",
                        "abc123",
                        "--dry-run",
                    ],
                    environ={},
                    transport_factory=lambda *_args, **_kwargs: self.fail(
                        "dry-run created a transport"
                    ),
                )

        summary = json.loads(output.getvalue())
        self.assertEqual(0, exit_code)
        self.assertTrue(summary["dry_run"])
        self.assertEqual(["BEN", "CJ"], summary["agents"])
        self.assertEqual(["debtor_analysis"], summary["manager_artifacts"])

    def test_live_publish_requires_supabase_environment(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            snapshot_path = Path(temp_dir) / "dashboard_data.json"
            analysis_path = Path(temp_dir) / "debtor_analysis_data.json"
            snapshot_path.write_text(json.dumps(sample_snapshot()), encoding="utf-8")
            analysis_path.write_text(
                json.dumps(sample_analysis()),
                encoding="utf-8",
            )
            errors = io.StringIO()

            with redirect_stderr(errors):
                exit_code = main(
                    [
                        "--input",
                        str(snapshot_path),
                        "--analysis-input",
                        str(analysis_path),
                        "--month",
                        "Jul 26",
                        "--source-version",
                        "abc123",
                    ],
                    environ={},
                )

        self.assertEqual(2, exit_code)
        self.assertIn("SUPABASE_URL", errors.getvalue())
        self.assertIn("SUPABASE_SERVICE_KEY", errors.getvalue())


if __name__ == "__main__":
    unittest.main()
