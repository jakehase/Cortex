from __future__ import annotations

import os
from pathlib import Path
import sqlite3
import subprocess


WATCHDOG = Path(__file__).resolve().parents[1] / "scripts" / "cortex_health_watchdog.sh"


def _write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


def _database(path: Path, *, codec_bytes: int = 0, other_bytes: int = 0) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS structured_memory (content TEXT NOT NULL, memory_type TEXT NOT NULL)"
        )
        if codec_bytes:
            connection.execute(
                "INSERT INTO structured_memory(content, memory_type) VALUES (?, 'codec_state')",
                ("x" * codec_bytes,),
            )
        if other_bytes:
            connection.execute(
                "INSERT INTO structured_memory(content, memory_type) VALUES (?, 'project')",
                ("y" * other_bytes,),
            )
        connection.commit()
    finally:
        connection.close()


def _environment(tmp_path: Path, database: Path) -> tuple[dict[str, str], Path]:
    curl = tmp_path / "curl"
    systemctl = tmp_path / "systemctl"
    systemctl_log = tmp_path / "systemctl.log"
    memory_stat = tmp_path / "memory.stat"
    memory_current = tmp_path / "memory.current"
    memory_stat.write_text("anon 4096\n", encoding="utf-8")
    memory_current.write_text("8192\n", encoding="utf-8")
    _write_executable(
        curl,
        "#!/usr/bin/env bash\n"
        "case \"$*\" in\n"
        "  */health*) printf '%s\\n' '{\"readiness\":true}' ;;\n"
        "  */ready*) printf '%s\\n' '{\"ready\":true}' ;;\n"
        "  *) printf '%s\\n' '{\"success\":true}' ;;\n"
        "esac\n",
    )
    _write_executable(
        systemctl,
        f"#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> {systemctl_log}\n",
    )
    environment = os.environ.copy()
    environment.update(
        {
            "CORTEX_WATCHDOG_STATE_FILE": str(tmp_path / "state"),
            "CORTEX_WATCHDOG_LOCK_FILE": str(tmp_path / "lock"),
            "CORTEX_WATCHDOG_MEMORY_FILE": str(memory_stat),
            "CORTEX_WATCHDOG_MEMORY_CURRENT_FILE": str(memory_current),
            "CORTEX_WATCHDOG_DATABASE_FILE": str(database),
            "CORTEX_WATCHDOG_CURL_BIN": str(curl),
            "CORTEX_WATCHDOG_SYSTEMCTL_BIN": str(systemctl),
            "CORTEX_WATCHDOG_SCOPED_PROBE_MODE": "plain",
            "CORTEX_WATCHDOG_DATABASE_LIMIT_BYTES": str(1024 * 1024),
            "CORTEX_WATCHDOG_DATABASE_GROWTH_LIMIT_BYTES": str(1024 * 1024),
            "CORTEX_WATCHDOG_CODEC_RECORD_LIMIT_BYTES": "1024",
            "CORTEX_WATCHDOG_NOW": "100",
        }
    )
    return environment, systemctl_log


def _run(environment: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(WATCHDOG)],
        env=environment,
        text=True,
        capture_output=True,
        check=False,
    )


def test_watchdog_defaults_to_admin_plus_signed_principal_for_aggregate_l22(tmp_path):
    database = tmp_path / "unused.sqlite3"
    environment, systemctl_log = _environment(tmp_path, database)
    environment["CORTEX_WATCHDOG_DATABASE_FILE"] = str(tmp_path / "missing.sqlite3")
    environment.pop("CORTEX_WATCHDOG_SCOPED_PROBE_MODE")

    server_root = tmp_path / "server"
    server_root.mkdir()
    auth_env = tmp_path / "cortex.env"
    auth_env.write_text("CORTEX_ADMIN_TOKEN=present-for-wrapper-test\n", encoding="utf-8")
    python_log = tmp_path / "python.log"
    python_wrapper = tmp_path / "python-wrapper"
    _write_executable(
        python_wrapper,
        "#!/usr/bin/env bash\n"
        "if (( $# > 4 )); then\n"
        f"  printf '%s\\n' \"$*\" >> {python_log}\n"
        "  cat >/dev/null\n"
        "  exit 0\n"
        "fi\n"
        "exec python3 \"$@\"\n",
    )
    environment.update(
        {
            "CORTEX_WATCHDOG_PYTHON_BIN": str(python_wrapper),
            "CORTEX_WATCHDOG_AUTH_ENV_FILE": str(auth_env),
            "CORTEX_WATCHDOG_SERVER_ROOT": str(server_root),
        }
    )

    result = _run(environment)

    assert result.returncode == 0, result.stderr
    invocation = python_log.read_text(encoding="utf-8")
    assert "signed_admin" in invocation
    assert "/l22/status" in invocation
    state = Path(environment["CORTEX_WATCHDOG_STATE_FILE"]).read_text(encoding="utf-8")
    assert "last_reason=healthy" in state
    assert not systemctl_log.exists()


def test_watchdog_derives_live_l22_database_from_canonical_environment(tmp_path):
    database = tmp_path / "derived.sqlite3"
    _database(database, codec_bytes=128)
    environment, systemctl_log = _environment(tmp_path, database)
    environment.pop("CORTEX_WATCHDOG_DATABASE_FILE")
    auth_env = tmp_path / "cortex.env"
    auth_env.write_text(f"CORTEX_L22_STRUCTURED_DB={database}\n", encoding="utf-8")
    environment["CORTEX_WATCHDOG_AUTH_ENV_FILE"] = str(auth_env)

    result = _run(environment)

    assert result.returncode == 0, result.stderr
    state = Path(environment["CORTEX_WATCHDOG_STATE_FILE"]).read_text(encoding="utf-8")
    assert "last_reason=healthy" in state
    assert "codec_max_record_bytes=128" in state
    assert not systemctl_log.exists()


def test_watchdog_records_healthy_store_metrics_without_restarting(tmp_path):
    database = tmp_path / "healthy.sqlite3"
    _database(database, codec_bytes=128)
    environment, systemctl_log = _environment(tmp_path, database)

    result = _run(environment)

    assert result.returncode == 0, result.stderr
    state = Path(environment["CORTEX_WATCHDOG_STATE_FILE"]).read_text(encoding="utf-8")
    assert "last_reason=healthy" in state
    assert "codec_max_record_bytes=128" in state
    assert not systemctl_log.exists()


def test_watchdog_fails_closed_on_oversized_codec_record(tmp_path):
    database = tmp_path / "oversized.sqlite3"
    _database(database, codec_bytes=1025)
    environment, systemctl_log = _environment(tmp_path, database)

    result = _run(environment)

    assert result.returncode == 1
    assert systemctl_log.read_text(encoding="utf-8").strip() == "stop cortex.service"
    state = Path(environment["CORTEX_WATCHDOG_STATE_FILE"]).read_text(encoding="utf-8")
    assert "last_reason=fail_closed:codec_record_size_threshold_exceeded" in state


def test_watchdog_fails_closed_on_sudden_database_growth(tmp_path):
    database = tmp_path / "growth.sqlite3"
    _database(database, codec_bytes=128)
    environment, systemctl_log = _environment(tmp_path, database)
    environment["CORTEX_WATCHDOG_DATABASE_LIMIT_BYTES"] = str(8 * 1024 * 1024)
    environment["CORTEX_WATCHDOG_DATABASE_GROWTH_LIMIT_BYTES"] = "4096"
    first = _run(environment)
    assert first.returncode == 0, first.stderr

    _database(database, other_bytes=128 * 1024)
    environment["CORTEX_WATCHDOG_NOW"] = "130"
    second = _run(environment)

    assert second.returncode == 1
    assert systemctl_log.read_text(encoding="utf-8").strip() == "stop cortex.service"
    state = Path(environment["CORTEX_WATCHDOG_STATE_FILE"]).read_text(encoding="utf-8")
    assert "last_reason=fail_closed:database_growth_threshold_exceeded" in state


def test_watchdog_verifies_recovery_before_recording_restart_completed(tmp_path):
    database = tmp_path / "missing.sqlite3"
    environment, systemctl_log = _environment(tmp_path, database)
    marker = tmp_path / "started"
    curl = Path(environment["CORTEX_WATCHDOG_CURL_BIN"])
    systemctl = Path(environment["CORTEX_WATCHDOG_SYSTEMCTL_BIN"])
    _write_executable(
        curl,
        "#!/usr/bin/env bash\n"
        f"[[ -e {marker} ]] || exit 1\n"
        "case \"$*\" in\n"
        "  */health*) printf '%s\\n' '{\"readiness\":true}' ;;\n"
        "  */ready*) printf '%s\\n' '{\"ready\":true}' ;;\n"
        "  *) printf '%s\\n' '{\"success\":true}' ;;\n"
        "esac\n",
    )
    _write_executable(
        systemctl,
        f"#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> {systemctl_log}\n"
        f"[[ \"${{1:-}}\" != start ]] || touch {marker}\n",
    )
    environment.update(
        {
            "CORTEX_WATCHDOG_FAILURES_BEFORE_RESTART": "1",
            "CORTEX_WATCHDOG_RESTART_COOLDOWN_SECONDS": "0",
            "CORTEX_WATCHDOG_RECOVERY_VERIFY_TIMEOUT_SECONDS": "1",
            "CORTEX_WATCHDOG_RECOVERY_VERIFY_INTERVAL_SECONDS": "0",
        }
    )

    result = _run(environment)

    assert result.returncode == 0, result.stderr
    assert systemctl_log.read_text(encoding="utf-8").splitlines() == [
        "stop cortex.service",
        "start cortex.service",
    ]
    state = Path(environment["CORTEX_WATCHDOG_STATE_FILE"]).read_text(encoding="utf-8")
    assert "failures=0" in state
    assert "last_reason=restart_completed:health_probe_failed" in state


def test_watchdog_records_restart_failed_when_recovery_never_returns(tmp_path):
    database = tmp_path / "missing.sqlite3"
    environment, systemctl_log = _environment(tmp_path, database)
    curl = Path(environment["CORTEX_WATCHDOG_CURL_BIN"])
    _write_executable(curl, "#!/usr/bin/env bash\nexit 1\n")
    environment.update(
        {
            "CORTEX_WATCHDOG_FAILURES_BEFORE_RESTART": "1",
            "CORTEX_WATCHDOG_RESTART_COOLDOWN_SECONDS": "0",
            "CORTEX_WATCHDOG_RECOVERY_VERIFY_TIMEOUT_SECONDS": "0",
            "CORTEX_WATCHDOG_RECOVERY_VERIFY_INTERVAL_SECONDS": "0",
        }
    )

    result = _run(environment)

    assert result.returncode == 1
    assert systemctl_log.read_text(encoding="utf-8").splitlines() == [
        "stop cortex.service",
        "start cortex.service",
    ]
    state = Path(environment["CORTEX_WATCHDOG_STATE_FILE"]).read_text(encoding="utf-8")
    assert "failures=1" in state
    assert "last_reason=restart_failed:health_probe_failed" in state
    assert "restart_completed" not in state
