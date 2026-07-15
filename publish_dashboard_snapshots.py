import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from dashboard_snapshot_contract import (
    SnapshotValidationError,
    build_manager_artifact,
    canonical_json_bytes,
    checksum_payload,
    split_snapshot,
    validate_snapshot,
)


class PublishError(RuntimeError):
    pass


class PublishTransportError(PublishError):
    pass


class PublishVerificationError(PublishError):
    pass


DEBTOR_ANALYSIS_DEBTOR_IDENTITY_FIELDS = (
    "debtor_code",
    "company_name",
    "agent",
)
DEBTOR_ANALYSIS_RECORD_IDENTITY_FIELDS = (
    "month",
    "debtor_code",
    "agent",
    "brand",
    "sku",
)


def _require_identity_fields(rows, fields, label):
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise SnapshotValidationError(
                f"debtor analysis {label}[{index}] is malformed"
            )
        missing = [
            field
            for field in fields
            if not str(row.get(field) or "").strip()
        ]
        if missing:
            raise SnapshotValidationError(
                f"debtor analysis {label}[{index}] is missing "
                f"{', '.join(missing)}"
            )


def validate_debtor_analysis(analysis, expected_month):
    if not isinstance(analysis, dict) or not analysis:
        raise SnapshotValidationError("debtor analysis must be a non-empty object")

    generated_at = str(analysis.get("generated_at") or "").strip()
    if not generated_at:
        raise SnapshotValidationError("debtor analysis generated_at is required")
    scope_area = str(analysis.get("scope_area") or "").strip()
    if not scope_area:
        raise SnapshotValidationError("debtor analysis scope_area is required")

    month = str(analysis.get("current_month") or "").strip()
    if not month:
        raise SnapshotValidationError("debtor analysis current_month is required")
    if month != expected_month:
        raise SnapshotValidationError("debtor analysis month mismatch")

    months = analysis.get("months")
    if (
        not isinstance(months, list)
        or not months
        or any(not str(value or "").strip() for value in months)
    ):
        raise SnapshotValidationError("debtor analysis months are incomplete")
    if month not in {str(value).strip() for value in months}:
        raise SnapshotValidationError(
            "debtor analysis current month is missing from months"
        )

    debtors = analysis.get("debtors")
    if not isinstance(debtors, list) or not debtors:
        raise SnapshotValidationError("debtor analysis debtors are incomplete")
    records = analysis.get("records")
    if not isinstance(records, list) or not records:
        raise SnapshotValidationError("debtor analysis records are incomplete")
    data_quality = analysis.get("data_quality")
    if not isinstance(data_quality, dict) or not data_quality:
        raise SnapshotValidationError("debtor analysis data_quality is incomplete")

    _require_identity_fields(
        debtors,
        DEBTOR_ANALYSIS_DEBTOR_IDENTITY_FIELDS,
        "debtors",
    )
    _require_identity_fields(
        records,
        DEBTOR_ANALYSIS_RECORD_IDENTITY_FIELDS,
        "records",
    )
    month_set = {str(value).strip() for value in months}
    if any(str(row["month"]).strip() not in month_set for row in records):
        raise SnapshotValidationError(
            "debtor analysis records contain an unknown month"
        )

    try:
        canonical_json_bytes(analysis)
    except (TypeError, ValueError) as error:
        raise SnapshotValidationError(
            "debtor analysis must contain only finite JSON values"
        ) from error
    return analysis


class SupabaseRestTransport:
    READBACK_COLUMNS = {
        "dashboard_snapshots": "month,generation_id,checksum",
        "dashboard_agent_snapshots": "month,generation_id,agent,checksum",
        "dashboard_manager_artifacts": (
            "month_key,generation_id,artifact_key,checksum"
        ),
        "dashboard_active_snapshots": (
            "month_key,generation_id,activated_at,shared_checksum,agent_count,"
            "agent_checksums,artifact_checksums"
        ),
    }

    def __init__(self, base_url, service_key, timeout=180, opener=None):
        self.base_url = str(base_url).rstrip("/")
        self.service_key = service_key
        self.timeout = timeout
        self._opener = opener or urlopen

    def _request(self, method, table, query=None, payload=None, prefer=None):
        resource_path = "/".join(
            quote(part, safe="") for part in str(table).split("/")
        )
        url = f"{self.base_url}/rest/v1/{resource_path}"
        if query:
            url = f"{url}?{urlencode(query)}"

        headers = {
            "Accept": "application/json",
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        body = canonical_json_bytes(payload) if payload is not None else None
        last_error = None
        for attempt in range(3):
            request = Request(url, data=body, headers=headers, method=method)
            try:
                response = self._opener(request, timeout=self.timeout)
                break
            except HTTPError as error:
                detail = error.read().decode("utf-8", errors="replace")[:500]
                last_error = PublishTransportError(
                    f"{table} request failed with HTTP {error.code}: {detail}"
                )
                if error.code < 500 or attempt == 2:
                    raise last_error from error
            except (TimeoutError, URLError) as error:
                last_error = PublishTransportError(
                    f"{table} request failed: {error}"
                )
                if attempt == 2:
                    raise last_error from error
            time.sleep(2 ** attempt)
        else:
            raise last_error or PublishTransportError(f"{table} request failed")

        try:
            raw = response.read()
        finally:
            response.close()

        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise PublishTransportError(
                f"{table} returned an invalid JSON response"
            ) from error

    def upsert(self, table, rows, on_conflict):
        records = rows if isinstance(rows, list) else [rows]
        for row in records:
            self._request(
                "POST",
                table,
                query={"on_conflict": on_conflict},
                payload=row,
                prefer="resolution=merge-duplicates,return=minimal",
            )
        return len(records)

    def select_one(self, table, **filters):
        columns = self.READBACK_COLUMNS.get(table)
        if columns is None:
            raise PublishTransportError(f"{table} readback is not supported")
        query = {"select": columns, "limit": 2}
        query.update({key: f"eq.{value}" for key, value in filters.items()})
        rows = self._request("GET", table, query=query)
        if rows in (None, []):
            return None
        if not isinstance(rows, list) or len(rows) != 1:
            raise PublishTransportError(
                f"{table} readback returned an unexpected row count"
            )
        if not isinstance(rows[0], dict):
            raise PublishTransportError(f"{table} readback returned a malformed row")
        return rows[0]

    def select_many(self, table, **filters):
        columns = self.READBACK_COLUMNS.get(table)
        if columns is None:
            raise PublishTransportError(f"{table} readback is not supported")
        query = {"select": columns}
        query.update({key: f"eq.{value}" for key, value in filters.items()})
        rows = self._request("GET", table, query=query)
        if rows is None:
            return []
        if not isinstance(rows, list) or any(
            not isinstance(row, dict) for row in rows
        ):
            raise PublishTransportError(
                f"{table} readback returned malformed rows"
            )
        return rows

    def delete(self, table, **filters):
        if table != "dashboard_agent_snapshots" or not filters:
            raise PublishTransportError(f"{table} delete is not supported")
        query = {key: f"eq.{value}" for key, value in filters.items()}
        self._request(
            "DELETE",
            table,
            query=query,
            prefer="return=minimal",
        )

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
        result = self._request(
            "POST",
            "rpc/dashboard_activate_snapshot_generation",
            payload={
                "p_month_key": month_key,
                "p_generation_id": generation_id,
                "p_shared_checksum": shared_checksum,
                "p_agent_checksums": agent_checksums,
                "p_artifact_checksums": artifact_checksums,
                "p_activated_at": activated_at,
            },
        )
        if isinstance(result, list) and len(result) == 1:
            result = result[0]
        if not isinstance(result, dict):
            raise PublishTransportError(
                "dashboard snapshot activation returned a malformed row"
            )
        return result

    def cleanup_inactive_generations(self, *, month_key, active_generation_id):
        self._request(
            "DELETE",
            "dashboard_snapshots",
            query={
                "month": f"eq.{month_key}",
                "generation_id": f"neq.{active_generation_id}",
            },
            prefer="return=minimal",
        )


def _verify_readback(label, expected, actual, identity_fields):
    if not isinstance(actual, dict):
        raise PublishVerificationError(f"{label} readback row is missing")
    for field in identity_fields:
        if actual.get(field) != expected.get(field):
            raise PublishVerificationError(f"{label} identity mismatch")
    if actual.get("checksum") != expected.get("checksum"):
        raise PublishVerificationError(f"{label} checksum mismatch")


def _index_agent_readback(rows):
    if not isinstance(rows, list):
        raise PublishVerificationError("agent snapshot readback is malformed")
    indexed = {}
    for row in rows:
        if not isinstance(row, dict):
            raise PublishVerificationError("agent snapshot readback is malformed")
        agent = str(row.get("agent") or "").strip()
        if not agent or agent in indexed:
            raise PublishVerificationError("agent snapshot identity mismatch")
        indexed[agent] = row
    return indexed


def _index_artifact_readback(rows):
    if not isinstance(rows, list):
        raise PublishVerificationError("manager artifact readback is malformed")
    indexed = {}
    for row in rows:
        if not isinstance(row, dict):
            raise PublishVerificationError("manager artifact readback is malformed")
        artifact_key = str(row.get("artifact_key") or "").strip()
        if not artifact_key or artifact_key in indexed:
            raise PublishVerificationError("manager artifact identity mismatch")
        indexed[artifact_key] = row
    return indexed


def _verify_active_generation(expected, actual):
    if not isinstance(actual, dict):
        raise PublishVerificationError("active snapshot readback row is missing")
    exact_fields = (
        "month_key",
        "generation_id",
        "shared_checksum",
        "agent_count",
        "agent_checksums",
        "artifact_checksums",
    )
    if any(actual.get(field) != expected.get(field) for field in exact_fields):
        raise PublishVerificationError("active snapshot generation mismatch")


def _new_generation_id(generation_id_factory):
    raw = str(generation_id_factory()).strip()
    try:
        parsed = uuid.UUID(raw)
    except (AttributeError, TypeError, ValueError) as error:
        raise PublishVerificationError("generation id must be a UUID") from error
    return str(parsed)


def publish_bundle(
    bundle,
    manager_artifacts,
    transport,
    source_version,
    generation_id_factory=uuid.uuid4,
    activated_at_factory=lambda: datetime.now(timezone.utc).isoformat(),
):
    source_version = str(source_version or "").strip()
    if not source_version:
        raise PublishVerificationError("source version is required")

    generation_id = _new_generation_id(generation_id_factory)
    month_key = bundle["shared"]["month"]
    shared = dict(
        bundle["shared"],
        source_version=source_version,
        generation_id=generation_id,
    )
    agent_rows = [
        dict(row, generation_id=generation_id)
        for row in bundle["agents"].values()
    ]
    expected_agents = {row["agent"]: row for row in agent_rows}
    artifact_rows = [
        dict(
            row,
            month_key=month_key,
            generation_id=generation_id,
        )
        for row in manager_artifacts
    ]
    for row in artifact_rows:
        if row.get("artifact_key") == "debtor_analysis":
            validate_debtor_analysis(row.get("payload"), month_key)

    expected_artifacts = {
        row["artifact_key"]: row for row in artifact_rows
    }
    if len(expected_artifacts) != len(artifact_rows):
        raise PublishVerificationError("manager artifact keys must be unique")
    if "debtor_analysis" not in expected_artifacts:
        raise SnapshotValidationError("debtor analysis artifact is required")

    transport.upsert(
        "dashboard_snapshots",
        shared,
        on_conflict="month,generation_id",
    )
    transport.upsert(
        "dashboard_agent_snapshots",
        agent_rows,
        on_conflict="month,generation_id,agent",
    )
    transport.upsert(
        "dashboard_manager_artifacts",
        artifact_rows,
        on_conflict="month_key,generation_id,artifact_key",
    )

    shared_back = transport.select_one(
        "dashboard_snapshots",
        month=month_key,
        generation_id=generation_id,
    )
    _verify_readback(
        "shared snapshot",
        shared,
        shared_back,
        ("month", "generation_id"),
    )

    verified = {month_key}
    agent_rows_back = transport.select_many(
        "dashboard_agent_snapshots",
        month=month_key,
        generation_id=generation_id,
    )
    agents_back = _index_agent_readback(agent_rows_back)
    if (
        len(agent_rows_back) != len(expected_agents)
        or set(agents_back) != set(expected_agents)
    ):
        raise PublishVerificationError("agent snapshot set mismatch")
    for agent, row in sorted(expected_agents.items()):
        back = agents_back[agent]
        _verify_readback(
            f"{agent} snapshot",
            row,
            back,
            ("month", "generation_id", "agent"),
        )
        verified.add(agent)

    artifact_rows_back = transport.select_many(
        "dashboard_manager_artifacts",
        month_key=month_key,
        generation_id=generation_id,
    )
    artifacts_back = _index_artifact_readback(artifact_rows_back)
    if (
        len(artifact_rows_back) != len(expected_artifacts)
        or set(artifacts_back) != set(expected_artifacts)
    ):
        raise PublishVerificationError("manager artifact set mismatch")
    for artifact_key, row in sorted(expected_artifacts.items()):
        _verify_readback(
            f"{artifact_key} artifact",
            row,
            artifacts_back[artifact_key],
            ("month_key", "generation_id", "artifact_key"),
        )
        verified.add(artifact_key)

    active_expected = {
        "month_key": month_key,
        "generation_id": generation_id,
        "shared_checksum": shared["checksum"],
        "agent_count": len(expected_agents),
        "agent_checksums": {
            agent: row["checksum"] for agent, row in sorted(expected_agents.items())
        },
        "artifact_checksums": {
            artifact_key: row["checksum"]
            for artifact_key, row in sorted(expected_artifacts.items())
        },
    }
    activated_at = str(activated_at_factory()).strip()
    activated = transport.activate_generation(
        month_key=month_key,
        generation_id=generation_id,
        shared_checksum=shared["checksum"],
        agent_checksums=active_expected["agent_checksums"],
        artifact_checksums=active_expected["artifact_checksums"],
        activated_at=activated_at,
    )
    _verify_active_generation(active_expected, activated)
    active_back = transport.select_one(
        "dashboard_active_snapshots",
        month_key=month_key,
    )
    _verify_active_generation(active_expected, active_back)

    cleaned_rows = transport.cleanup_inactive_generations(
        month_key=month_key,
        active_generation_id=generation_id,
    )

    return {
        "verified_keys": sorted(verified),
        "generation_id": generation_id,
        "agent_count": len(agent_rows),
        "cleaned_rows": cleaned_rows,
        "manager_artifact_count": len(artifact_rows),
    }


def _load_json(path):
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _resolve_source_version(snapshot, explicit, environ):
    source_version = str(
        explicit or environ.get("DASHBOARD_SOURCE_VERSION") or ""
    ).strip()
    if source_version:
        return source_version

    try:
        result = subprocess.run(
            ["git", "rev-parse", "--verify", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        source_version = result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        source_version = ""
    return source_version or f"snapshot-{checksum_payload(snapshot)[:12]}"


def _build_summary(bundle, artifacts, source_version, dry_run, result=None):
    summary = {
        "dry_run": dry_run,
        "month": bundle["shared"]["month"],
        "source_version": source_version,
        "agents": sorted(bundle["agents"]),
        "manager_artifacts": sorted(row["artifact_key"] for row in artifacts),
        "checksums": {
            "shared": bundle["shared"]["checksum"],
            "agents": {
                agent: row["checksum"]
                for agent, row in sorted(bundle["agents"].items())
            },
            "manager_artifacts": {
                row["artifact_key"]: row["checksum"] for row in artifacts
            },
        },
    }
    if result is not None:
        summary["verified_keys"] = result["verified_keys"]
    return summary


def _parser():
    parser = argparse.ArgumentParser(
        description="Publish private Sales Dashboard snapshots to Supabase."
    )
    parser.add_argument("--input", default="dashboard_data.json")
    parser.add_argument(
        "--analysis-input", default="debtor_analysis_data.json"
    )
    parser.add_argument("--month")
    parser.add_argument("--source-version")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv=None, environ=None, transport_factory=SupabaseRestTransport):
    args = _parser().parse_args(argv)
    environ = os.environ if environ is None else environ

    if not args.dry_run:
        required = ("SUPABASE_URL", "SUPABASE_SERVICE_KEY")
        missing = [name for name in required if not str(environ.get(name) or "").strip()]
        if missing:
            print(
                f"ERROR: required environment variables missing: {', '.join(missing)}",
                file=sys.stderr,
            )
            return 2

    try:
        snapshot = _load_json(args.input)
        validate_snapshot(snapshot, expected_month=args.month)
        bundle = split_snapshot(snapshot)

        analysis = validate_debtor_analysis(
            _load_json(args.analysis_input),
            bundle["shared"]["month"],
        )
        generated_at = str(analysis["generated_at"]).strip()
        artifacts = [
            build_manager_artifact("debtor_analysis", analysis, generated_at)
        ]
        source_version = _resolve_source_version(
            snapshot, args.source_version, environ
        )

        if args.dry_run:
            print(
                json.dumps(
                    _build_summary(bundle, artifacts, source_version, True),
                    sort_keys=True,
                )
            )
            return 0

        transport = transport_factory(
            environ["SUPABASE_URL"], environ["SUPABASE_SERVICE_KEY"]
        )
        result = publish_bundle(bundle, artifacts, transport, source_version)
        print(
            json.dumps(
                _build_summary(bundle, artifacts, source_version, False, result),
                sort_keys=True,
            )
        )
        return 0
    except (
        OSError,
        json.JSONDecodeError,
        SnapshotValidationError,
        PublishError,
        TypeError,
        ValueError,
    ) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
