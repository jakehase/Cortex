import os
import json
from pathlib import Path
import shlex
import subprocess

import pytest


SERVER_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = Path(__file__).resolve().parents[3]


def test_canonical_startup_bounds_glibc_native_arenas():
    startup = (SERVER_ROOT / "scripts" / "start_cortex_service.sh").read_text(encoding="utf-8")

    assert 'MALLOC_ARENA_MAX="${MALLOC_ARENA_MAX:-2}"' in startup
    assert 'MALLOC_TRIM_THRESHOLD_="${MALLOC_TRIM_THRESHOLD_:-131072}"' in startup
    assert 'MALLOC_TOP_PAD_="${MALLOC_TOP_PAD_:-131072}"' in startup
    assert startup.index("MALLOC_ARENA_MAX") < startup.index("python3 -m uvicorn")


def test_canonical_host_startup_is_bounded_and_supervises_required_workers():
    startup = (SERVER_ROOT / "scripts" / "start_cortex_service.sh").read_text(
        encoding="utf-8"
    )

    assert 'CORTEX_ENV="${CORTEX_ENV:-production}"' in startup
    assert '[[ "${CORTEX_ENV}" != "production" ]]' in startup
    assert "python3 -m cortex_server.runtime.release_verifier_worker" in startup
    assert "python3 -m cortex_server.runtime.release_manager_worker" in startup
    assert startup.count("/usr/bin/env -i") == 2
    assert 'CORTEX_RELEASE_CONTROLLER_STATE_DIR="${CORTEX_RELEASE_VERIFIER_STATE_DIR}"' in startup
    assert 'CORTEX_RELEASE_CONTROLLER_STATE_DIR="${CORTEX_RELEASE_MANAGER_STATE_DIR}"' in startup
    assert "python3 -m uvicorn cortex_server.main:app" in startup
    assert '--limit-concurrency "${CORTEX_LIMIT_CONCURRENCY}"' in startup
    assert "CORTEX_LIMIT_CONCURRENCY > 128" in startup
    assert "--timeout-keep-alive 5" in startup
    assert 'wait -n "${child_pids[@]}"' in startup
    assert "export CORTEX_RUNTIME_DELIVERY_PREALLOCATE_RECOVERY_RESERVE=true" in startup
    assert "preallocate_runtime_delivery_recovery_reserve(Path(" in startup
    assert startup.index("preallocate_runtime_delivery_recovery_reserve\n\nexport CORTEX_BASE_URL") < startup.index(
        "python3 -m uvicorn cortex_server.main:app"
    )


def test_canonical_host_controller_environments_are_role_isolated(tmp_path):
    startup = (SERVER_ROOT / "scripts" / "start_cortex_service.sh").read_text(
        encoding="utf-8"
    )
    verifier_environment_path = tmp_path / "verifier-environment.json"
    manager_environment_path = tmp_path / "manager-environment.json"

    def probe(path: Path) -> str:
        code = (
            "import json,os,pathlib;"
            f"pathlib.Path({str(path)!r}).write_text("
            "json.dumps(dict(os.environ),sort_keys=True),encoding='utf-8')"
        )
        return f"/usr/bin/python3 -c {shlex.quote(code)}"

    executable = tmp_path / "start_cortex_service.sh"
    executable.write_text(
        startup.replace(
            "cd /root/clawd/public/cortex_server",
            f"cd {shlex.quote(str(SERVER_ROOT))}",
        )
        .replace(
            "preallocate_runtime_delivery_recovery_reserve\n\nexport CORTEX_BASE_URL",
            ": # startup reserve preallocation exercised separately\n\nexport CORTEX_BASE_URL",
        )
        .replace(
            "/usr/bin/python3 -m cortex_server.runtime.release_verifier_worker",
            probe(verifier_environment_path),
        )
        .replace(
            "/usr/bin/python3 -m cortex_server.runtime.release_manager_worker",
            probe(manager_environment_path),
        )
        .replace(
            "/usr/bin/python3 -m uvicorn cortex_server.main:app \\\n  --host \"${CORTEX_HOST}\" \\\n  --port \"${CORTEX_PORT}\" \\\n  --limit-concurrency \"${CORTEX_LIMIT_CONCURRENCY}\" \\\n  --timeout-keep-alive 5 \\\n  --ws-max-size 4096 &",
            "/usr/bin/python3 -c 'import time; time.sleep(10)' &",
        )
        .replace(
            'wait -n "${child_pids[@]}"\nstatus=$?',
            'wait "${child_pids[0]}"\nverifier_status=$?\n'
            'wait "${child_pids[1]}"\nmanager_status=$?\n'
            'status=$(( verifier_status || manager_status ))',
        ),
        encoding="utf-8",
    )
    environment = _launcher_environment(
        CORTEX_RELEASE_VERIFIER_STATE_DIR="/var/lib/cortex/verifier",
        CORTEX_RELEASE_MANAGER_STATE_DIR="/var/lib/cortex/manager",
        CORTEX_RELEASE_VERIFIER_HEALTH_PORT="18991",
        CORTEX_RELEASE_MANAGER_HEALTH_PORT="18992",
        CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN_HEADER="x-verifier-artifact",
        CORTEX_UNRELATED_AUTHORITY_SECRET="must-not-be-inherited",
    )

    completed = subprocess.run(
        ["/usr/bin/bash", str(executable)],
        cwd=SERVER_ROOT,
        env=environment,
        text=True,
        capture_output=True,
        timeout=5,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    verifier_environment = json.loads(verifier_environment_path.read_text(encoding="utf-8"))
    manager_environment = json.loads(manager_environment_path.read_text(encoding="utf-8"))
    common_names = {
        "PATH",
        "LANG",
        "PYTHONUNBUFFERED",
        "MALLOC_ARENA_MAX",
        "MALLOC_TRIM_THRESHOLD_",
        "MALLOC_TOP_PAD_",
        "CORTEX_ENV",
        "CORTEX_BASE_URL",
        "CORTEX_RELEASE_MEASUREMENT_URL",
        "CORTEX_RELEASE_CONTROLLER_REQUIRE_EXISTING_STATE",
        "CORTEX_RELEASE_CONTROLLER_ROLE",
        "CORTEX_RELEASE_CONTROLLER_STATE_DIR",
        "CORTEX_HANDOFF_RECIPIENT",
        "CORTEX_HANDOFF_RECIPIENT_SECRET",
        "CORTEX_HANDOFF_HEALTH_PORT",
        "CORTEX_HANDOFF_HEALTH_MAX_CONNECTIONS",
        "CORTEX_HANDOFF_HEALTH_SOCKET_TIMEOUT_SECONDS",
        "CORTEX_HANDOFF_READY_MAX_AGE_SECONDS",
        "CORTEX_HANDOFF_POLL_SECONDS",
        "CORTEX_RELEASE_CLOCK_DIVERGENCE_SECONDS",
    }
    verifier_only = {
        "CORTEX_RELEASE_VERIFIER_ID",
        "CORTEX_RELEASE_VERIFIER_ATTESTATION_SECRET",
        "CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN",
        "CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN_HEADER",
    }
    assert set(verifier_environment) == common_names | verifier_only
    assert set(manager_environment) == common_names
    assert verifier_environment["CORTEX_HANDOFF_RECIPIENT_SECRET"] == "v" * 32
    assert manager_environment["CORTEX_HANDOFF_RECIPIENT_SECRET"] == "m" * 32
    assert verifier_environment["CORTEX_RELEASE_CONTROLLER_ROLE"] == "verifier"
    assert manager_environment["CORTEX_RELEASE_CONTROLLER_ROLE"] == "manager"


def _launcher_environment(**overrides: str) -> dict[str, str]:
    environment = os.environ.copy()
    for name in (
        "CORTEX_RELEASE_VERIFIER_STATE_DIR",
        "CORTEX_RELEASE_MANAGER_STATE_DIR",
    ):
        environment.pop(name, None)
    environment.update(
        {
            "CORTEX_RELEASE_VERIFIER_RECIPIENT_SECRET": "v" * 32,
            "CORTEX_RELEASE_MANAGER_RECIPIENT_SECRET": "m" * 32,
            "CORTEX_RELEASE_VERIFIER_ID": "host-release-verifier",
            "CORTEX_RELEASE_VERIFIER_ATTESTATION_SECRET": "a" * 32,
            "CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN": "t" * 32,
            **overrides,
        }
    )
    return environment


@pytest.mark.parametrize(
    ("overrides", "error"),
    [
        ({"CORTEX_RELEASE_MANAGER_STATE_DIR": "/var/lib/cortex/manager"}, "VERIFIER_STATE_DIR"),
        (
            {
                "CORTEX_RELEASE_VERIFIER_STATE_DIR": "relative/verifier",
                "CORTEX_RELEASE_MANAGER_STATE_DIR": "/var/lib/cortex/manager",
            },
            "must be an absolute path",
        ),
        (
            {
                "CORTEX_RELEASE_VERIFIER_STATE_DIR": "/tmp/cortex/verifier",
                "CORTEX_RELEASE_MANAGER_STATE_DIR": "/var/lib/cortex/manager",
            },
            "must use durable storage",
        ),
        (
            {
                "CORTEX_RELEASE_VERIFIER_STATE_DIR": "/var/lib/cortex/controller/verifier",
                "CORTEX_RELEASE_MANAGER_STATE_DIR": "/var/lib/cortex/controller/../controller/verifier",
            },
            "must be distinct",
        ),
    ],
)
def test_canonical_host_rejects_unsafe_controller_state_directories(
    tmp_path, overrides, error
):
    startup = SERVER_ROOT / "scripts" / "start_cortex_service.sh"
    executable = tmp_path / "start_cortex_service.sh"
    executable.write_text(
        startup.read_text(encoding="utf-8").replace(
            "cd /root/clawd/public/cortex_server",
            f"cd {shlex.quote(str(SERVER_ROOT))}",
        ),
        encoding="utf-8",
    )

    completed = subprocess.run(
        ["/usr/bin/bash", str(executable)],
        cwd=SERVER_ROOT,
        env=_launcher_environment(**overrides),
        text=True,
        capture_output=True,
        timeout=5,
        check=False,
    )

    assert completed.returncode != 0
    assert error in completed.stderr


def test_canonical_host_fails_before_uvicorn_when_reserve_is_not_proven(tmp_path):
    startup = (SERVER_ROOT / "scripts" / "start_cortex_service.sh").read_text(
        encoding="utf-8"
    )
    uvicorn_marker = tmp_path / "uvicorn-started"
    executable = tmp_path / "start_cortex_service.sh"
    executable.write_text(
        startup.replace(
            "cd /root/clawd/public/cortex_server",
            f"cd {shlex.quote(str(SERVER_ROOT))}",
        )
        .replace(
            "preallocate_runtime_delivery_recovery_reserve\n\nexport CORTEX_BASE_URL",
            "/usr/bin/python3 -c 'raise SystemExit(73)'\n\nexport CORTEX_BASE_URL",
        )
        .replace(
            "/usr/bin/python3 -m uvicorn cortex_server.main:app \\\n",
            f"/usr/bin/python3 -c {shlex.quote(f'from pathlib import Path; Path({str(uvicorn_marker)!r}).touch()')} \\\n",
        ),
        encoding="utf-8",
    )

    completed = subprocess.run(
        ["/usr/bin/bash", str(executable)],
        cwd=SERVER_ROOT,
        env=_launcher_environment(
            CORTEX_RELEASE_VERIFIER_STATE_DIR="/var/lib/cortex/verifier",
            CORTEX_RELEASE_MANAGER_STATE_DIR="/var/lib/cortex/manager",
            ORCHESTRATOR_RUNTIME_DELIVERY_ROOT=str(tmp_path / "runtime-delivery"),
        ),
        text=True,
        capture_output=True,
        timeout=5,
        check=False,
    )

    assert completed.returncode == 73
    assert not uvicorn_marker.exists()


def test_ct101_dropin_has_root_fix_and_last_resort_cgroup_boundary():
    dropin = (WORKSPACE_ROOT / "deploy" / "systemd" / "cortex-memory-guard.conf").read_text(encoding="utf-8")

    assert "Environment=MALLOC_ARENA_MAX=2" in dropin
    assert "Environment=MALLOC_TRIM_THRESHOLD_=131072" in dropin
    assert "MemoryHigh=2G" in dropin
    assert "MemoryMax=3G" in dropin
    assert "MemorySwapMax=512M" in dropin
    assert "OOMPolicy=stop" in dropin
