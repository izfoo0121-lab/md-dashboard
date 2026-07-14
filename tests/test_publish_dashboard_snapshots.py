import json
import unittest

from dashboard_snapshot_contract import (
    SnapshotValidationError,
    build_manager_artifact,
    checksum_payload,
    split_snapshot,
    validate_snapshot,
)


def sample_snapshot():
    return {
        "generated_at": "2026-07-14T12:00:00+00:00",
        "current_month": "Jul 26",
        "data_quality": {"typed_debtors": 2},
        "working_days": {"total": 27},
        "group_brand_targets": {"BEN": {"ZLB": 10}},
        "team": {"sales": 200},
        "config": {"currency": "MYR"},
        "campaign_group_progress": {"groups": []},
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


class SnapshotContractTests(unittest.TestCase):
    def test_split_contains_one_agent_and_no_peer_debtors(self):
        bundle = split_snapshot(sample_snapshot())

        ben = bundle["agents"]["BEN"]["agent_payload"]

        self.assertEqual(["BEN"], list(ben["agents"]))
        self.assertNotIn("CJ", json.dumps(ben))

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
                "campaign_group_progress",
            },
            set(shared),
        )
        self.assertNotIn("birthday_by_month", shared)
        self.assertNotIn("brand_penetration_candidates", shared)

    def test_manager_support_does_not_duplicate_agents(self):
        support = split_snapshot(sample_snapshot())["shared"][
            "manager_support_payload"
        ]

        self.assertNotIn("agents", support)
        self.assertIn("birthday_by_month", support)

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


if __name__ == "__main__":
    unittest.main()
