import hashlib
import json


class SnapshotValidationError(ValueError):
    pass


SAFE_SHARED_KEYS = frozenset(
    {
        "generated_at",
        "current_month",
        "data_quality",
        "working_days",
        "group_brand_targets",
        "team",
        "config",
        "campaign_group_progress",
    }
)


def canonical_json_bytes(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def checksum_payload(value):
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def validate_snapshot(snapshot, expected_month=None, min_total_debtors=1):
    if not isinstance(snapshot, dict):
        raise SnapshotValidationError("snapshot must be a JSON object")

    month = str(snapshot.get("current_month") or "").strip()
    if not month or (expected_month and month != expected_month):
        raise SnapshotValidationError("snapshot month mismatch")

    generated_at = str(snapshot.get("generated_at") or "").strip()
    if not generated_at:
        raise SnapshotValidationError("snapshot generated_at is required")

    agents = snapshot.get("agents")
    if not isinstance(agents, dict) or not agents:
        raise SnapshotValidationError("snapshot has no agents")

    total_debtors = 0
    for agent, block in agents.items():
        if not isinstance(block, dict):
            raise SnapshotValidationError(f"{agent} snapshot is malformed")
        debtor_cards = block.get("debtor_cards")
        debtors = debtor_cards.get("debtors") if isinstance(debtor_cards, dict) else None
        if not isinstance(debtors, list):
            raise SnapshotValidationError(f"{agent} debtor records are malformed")
        total_debtors += len(debtors)

    if total_debtors < min_total_debtors:
        raise SnapshotValidationError("snapshot has too few debtor records")

    try:
        canonical_json_bytes(snapshot)
    except (TypeError, ValueError) as error:
        raise SnapshotValidationError(
            "snapshot must contain only finite JSON values"
        ) from error

    return snapshot


def split_snapshot(snapshot):
    validate_snapshot(snapshot)
    shared_payload = {
        key: value for key, value in snapshot.items() if key in SAFE_SHARED_KEYS
    }
    manager_support_payload = {
        key: value for key, value in snapshot.items() if key != "agents"
    }

    return {
        "shared": {
            "month": snapshot["current_month"],
            "generated_at": snapshot["generated_at"],
            "shared_payload": shared_payload,
            "manager_support_payload": manager_support_payload,
            "data_quality": snapshot.get("data_quality") or {},
            "checksum": checksum_payload(shared_payload),
        },
        "agents": {
            agent: {
                "month": snapshot["current_month"],
                "agent": agent,
                "agent_payload": {"agents": {agent: block}},
                "checksum": checksum_payload({"agents": {agent: block}}),
                "generated_at": snapshot["generated_at"],
            }
            for agent, block in snapshot["agents"].items()
        },
    }


def build_manager_artifact(artifact_key, payload, generated_at):
    return {
        "artifact_key": artifact_key,
        "generated_at": generated_at,
        "payload": payload,
        "checksum": checksum_payload(payload),
    }
