import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
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


class SupabaseRestTransport:
    READBACK_COLUMNS = {
        "dashboard_snapshots": "month,checksum",
        "dashboard_agent_snapshots": "month,agent,checksum",
        "dashboard_manager_artifacts": "artifact_key,checksum",
    }

    def __init__(self, base_url, service_key, timeout=30, opener=None):
        self.base_url = str(base_url).rstrip("/")
        self.service_key = service_key
        self.timeout = timeout
        self._opener = opener or urlopen

    def _request(self, method, table, query=None, payload=None, prefer=None):
        url = f"{self.base_url}/rest/v1/{quote(table, safe='')}"
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
        request = Request(url, data=body, headers=headers, method=method)

        try:
            response = self._opener(request, timeout=self.timeout)
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:500]
            raise PublishTransportError(
                f"{table} request failed with HTTP {error.code}: {detail}"
            ) from error
        except (TimeoutError, URLError) as error:
            raise PublishTransportError(f"{table} request failed: {error}") from error

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


def publish_bundle(bundle, manager_artifacts, transport, source_version):
    source_version = str(source_version or "").strip()
    if not source_version:
        raise PublishVerificationError("source version is required")

    shared = dict(bundle["shared"], source_version=source_version)
    agent_rows = list(bundle["agents"].values())
    expected_agents = {row["agent"]: row for row in agent_rows}
    artifact_rows = list(manager_artifacts)

    transport.upsert("dashboard_snapshots", shared, on_conflict="month")
    current_agents = _index_agent_readback(
        transport.select_many(
            "dashboard_agent_snapshots",
            month=shared["month"],
        )
    )
    stale_agents = sorted(set(current_agents) - set(expected_agents))
    for agent in stale_agents:
        transport.delete(
            "dashboard_agent_snapshots",
            month=shared["month"],
            agent=agent,
        )

    transport.upsert(
        "dashboard_agent_snapshots",
        agent_rows,
        on_conflict="month,agent",
    )
    transport.upsert(
        "dashboard_manager_artifacts",
        artifact_rows,
        on_conflict="artifact_key",
    )

    shared_back = transport.select_one(
        "dashboard_snapshots", month=shared["month"]
    )
    _verify_readback("shared snapshot", shared, shared_back, ("month",))

    verified = {shared["month"]}
    agent_rows_back = transport.select_many(
        "dashboard_agent_snapshots",
        month=shared["month"],
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
            ("month", "agent"),
        )
        verified.add(agent)

    for row in artifact_rows:
        back = transport.select_one(
            "dashboard_manager_artifacts",
            artifact_key=row["artifact_key"],
        )
        _verify_readback(
            f"{row['artifact_key']} artifact",
            row,
            back,
            ("artifact_key",),
        )
        verified.add(row["artifact_key"])

    return {
        "verified_keys": sorted(verified),
        "agent_count": len(agent_rows),
        "deleted_agents": stale_agents,
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

        analysis = _load_json(args.analysis_input)
        if not isinstance(analysis, dict):
            raise SnapshotValidationError("debtor analysis must be a JSON object")
        analysis_month = str(analysis.get("current_month") or "").strip()
        if analysis_month and analysis_month != bundle["shared"]["month"]:
            raise SnapshotValidationError("debtor analysis month mismatch")
        generated_at = str(
            analysis.get("generated_at") or snapshot["generated_at"]
        ).strip()
        if not generated_at:
            raise SnapshotValidationError("debtor analysis generated_at is required")
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
