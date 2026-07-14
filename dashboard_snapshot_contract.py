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
    }
)

SAFE_SKU_RULE_LIST_FIELDS = frozenset(
    {
        "item_codes",
        "item_groups",
        "item_code_prefixes",
        "item_group_prefixes",
    }
)


def _safe_scalar(value):
    return isinstance(value, (str, int, float, bool))


def _safe_scalar_list(value):
    if not isinstance(value, list):
        return None
    return [item for item in value if _safe_scalar(item)]


def _project_brand_config(value):
    if not isinstance(value, dict):
        return None
    projected = {}
    for brand, codes in value.items():
        safe_codes = _safe_scalar_list(codes)
        if isinstance(brand, str) and safe_codes is not None:
            projected[brand] = safe_codes
    return projected


def _project_sku_rule(rule):
    if isinstance(rule, list):
        return _safe_scalar_list(rule)
    if not isinstance(rule, dict):
        return None

    projected = {}
    label = rule.get("label")
    if _safe_scalar(label):
        projected["label"] = label
    for field in SAFE_SKU_RULE_LIST_FIELDS:
        values = _safe_scalar_list(rule.get(field))
        if values is not None:
            projected[field] = values
    return projected


def _project_sku_rule_groups(value):
    if not isinstance(value, dict):
        return None
    projected = {}
    for group, rule in value.items():
        safe_rule = _project_sku_rule(rule)
        if isinstance(group, str) and safe_rule is not None:
            projected[group] = safe_rule
    return projected


def _project_sku_rules(value):
    if not isinstance(value, dict):
        return None
    projected = {}
    for field in ("new_sku_groups", "other_sku_groups"):
        groups = _project_sku_rule_groups(value.get(field))
        if groups is not None:
            projected[field] = groups
    return projected


def project_safe_config(value):
    if not isinstance(value, dict):
        return {}

    projected = {}
    zlb_brands = _safe_scalar_list(value.get("zlb_brands"))
    if zlb_brands is not None:
        projected["zlb_brands"] = zlb_brands

    brand_config = _project_brand_config(value.get("brand_config"))
    if brand_config is not None:
        projected["brand_config"] = brand_config

    for field in ("sku_rules_snapshot", "sku_rules"):
        sku_rules = _project_sku_rules(value.get(field))
        if sku_rules is not None:
            projected[field] = sku_rules

    group_incentive = value.get("group_incentive")
    if _safe_scalar(group_incentive):
        projected["group_incentive"] = group_incentive

    return projected


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
        key: value
        for key, value in snapshot.items()
        if key not in {"agents", "config"}
    }
    if "config" in snapshot:
        safe_config = project_safe_config(snapshot["config"])
        shared_payload["config"] = safe_config
        manager_support_payload["config"] = safe_config

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
