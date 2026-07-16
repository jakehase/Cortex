import os
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
    assert 'CORTEX_RELEASE_CONTROLLER_STATE_DIR="${CORTEX_RELEASE_VERIFIER_STATE_DIR}"' in startup
    assert 'CORTEX_RELEASE_CONTROLLER_STATE_DIR="${CORTEX_RELEASE_MANAGER_STATE_DIR}"' in startup
    assert "python3 -m uvicorn cortex_server.main:app" in startup
    assert '--limit-concurrency "${CORTEX_LIMIT_CONCURRENCY}"' in startup
    assert "CORTEX_LIMIT_CONCURRENCY > 128" in startup
    assert "--timeout-keep-alive 5" in startup
    assert 'wait -n "${child_pids[@]}"' in startup


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


def test_ct101_dropin_has_root_fix_and_last_resort_cgroup_boundary():
    dropin = (WORKSPACE_ROOT / "deploy" / "systemd" / "cortex-memory-guard.conf").read_text(encoding="utf-8")

    assert "Environment=MALLOC_ARENA_MAX=2" in dropin
    assert "Environment=MALLOC_TRIM_THRESHOLD_=131072" in dropin
    assert "MemoryHigh=2G" in dropin
    assert "MemoryMax=3G" in dropin
    assert "MemorySwapMax=512M" in dropin
    assert "OOMPolicy=stop" in dropin
