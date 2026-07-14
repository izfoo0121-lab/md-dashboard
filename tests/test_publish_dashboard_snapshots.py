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
        "config": {"currency": "MYR"},
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


def sample_analysis_artifact():
    return build_manager_artifact(
        "debtor_analysis",
        {"current_month": "Jul 26", "months": ["Jul 26"]},
        "2026-07-14T12:00:00+00:00",
    )


class FakeTransport:
    KEY_FIELDS = {
        "dashboard_snapshots": ("month",),
        "dashboard_agent_snapshots": ("month", "agent"),
        "dashboard_manager_artifacts": ("artifact_key",),
    }

    def __init__(self, readback_checksum=None, mutate_readback=None):
        self.readback_checksum = readback_checksum
        self.mutate_readback = mutate_readback
        self.calls = []
        self.rows = {}

    def upsert(self, table, rows, on_conflict):
        self.calls.append(
            {
                "operation": "upsert",
                "table": table,
                "on_conflict": on_conflict,
                "authorization": "Bearer service-role",
            }
        )
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
        if self.readback_checksum is not None:
            row["checksum"] = self.readback_checksum
        if self.mutate_readback is not None:
            row = self.mutate_readback(table, row)
        return row


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
    def test_publish_uses_service_transport_and_reads_rows_back(self):
        transport = FakeTransport()

        result = publish_bundle(
            sample_bundle(),
            [sample_analysis_artifact()],
            transport,
            source_version="abc123",
        )

        self.assertEqual(
            {"Jul 26", "BEN", "CJ", "debtor_analysis"},
            set(result["verified_keys"]),
        )
        self.assertTrue(
            all("service-role" in call["authorization"] for call in transport.calls)
        )
        self.assertEqual(
            4,
            sum(call["operation"] == "select" for call in transport.calls),
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
            {"month": "Jul 26", "checksum": "abc"},
            on_conflict="month",
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
            return FakeResponse(b'[{"month":"Jul 26","checksum":"abc"}]')

        transport = SupabaseRestTransport(
            "https://example.supabase.co",
            "service-role-secret",
            opener=opener,
        )

        row = transport.select_one("dashboard_snapshots", month="Jul 26")

        query = parse_qs(urlparse(requests[0].full_url).query)
        self.assertEqual(["month,checksum"], query["select"])
        self.assertEqual(["eq.Jul 26"], query["month"])
        self.assertEqual("abc", row["checksum"])

    def test_dry_run_validates_files_without_credentials_or_transport(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            snapshot_path = Path(temp_dir) / "dashboard_data.json"
            analysis_path = Path(temp_dir) / "debtor_analysis_data.json"
            snapshot_path.write_text(json.dumps(sample_snapshot()), encoding="utf-8")
            analysis_path.write_text(
                json.dumps(
                    {
                        "generated_at": "2026-07-14T12:00:00+00:00",
                        "current_month": "Jul 26",
                        "months": ["Jul 26"],
                    }
                ),
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
                json.dumps(
                    {
                        "generated_at": "2026-07-14T12:00:00+00:00",
                        "current_month": "Jul 26",
                        "months": ["Jul 26"],
                    }
                ),
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
