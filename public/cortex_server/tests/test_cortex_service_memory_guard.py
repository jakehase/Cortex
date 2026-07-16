from pathlib import Path


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
    assert "python3 -m uvicorn cortex_server.main:app" in startup
    assert '--limit-concurrency "${CORTEX_LIMIT_CONCURRENCY}"' in startup
    assert "CORTEX_LIMIT_CONCURRENCY > 128" in startup
    assert "--timeout-keep-alive 5" in startup
    assert 'wait -n "${child_pids[@]}"' in startup


def test_ct101_dropin_has_root_fix_and_last_resort_cgroup_boundary():
    dropin = (WORKSPACE_ROOT / "deploy" / "systemd" / "cortex-memory-guard.conf").read_text(encoding="utf-8")

    assert "Environment=MALLOC_ARENA_MAX=2" in dropin
    assert "Environment=MALLOC_TRIM_THRESHOLD_=131072" in dropin
    assert "MemoryHigh=2G" in dropin
    assert "MemoryMax=3G" in dropin
    assert "MemorySwapMax=512M" in dropin
    assert "OOMPolicy=stop" in dropin
