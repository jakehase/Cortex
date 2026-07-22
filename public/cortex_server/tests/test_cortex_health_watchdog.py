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
