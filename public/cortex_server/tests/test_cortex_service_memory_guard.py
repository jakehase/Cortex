from pathlib import Path


SERVER_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = Path(__file__).resolve().parents[3]


def test_canonical_startup_bounds_glibc_native_arenas():
    startup = (SERVER_ROOT / "scripts" / "start_cortex_service.sh").read_text(encoding="utf-8")

    assert 'MALLOC_ARENA_MAX="${MALLOC_ARENA_MAX:-2}"' in startup
    assert 'MALLOC_TRIM_THRESHOLD_="${MALLOC_TRIM_THRESHOLD_:-131072}"' in startup
    assert 'MALLOC_TOP_PAD_="${MALLOC_TOP_PAD_:-131072}"' in startup
    assert 'CORTEX_HOST="${CORTEX_HOST:-127.0.0.1}"' in startup
    assert startup.index("MALLOC_ARENA_MAX") < startup.index("python3 -m uvicorn")


def test_ct101_dropin_has_root_fix_and_last_resort_cgroup_boundary():
    dropin = (WORKSPACE_ROOT / "deploy" / "systemd" / "cortex-memory-guard.conf").read_text(encoding="utf-8")

    assert "Environment=MALLOC_ARENA_MAX=2" in dropin
    assert "Environment=MALLOC_TRIM_THRESHOLD_=131072" in dropin
    assert "Environment=CORTEX_L22_PREALLOCATE_RECOVERY_RESERVE=true" in dropin
    assert "Environment=CORTEX_L22_RECOVERY_RESERVE_BYTES=268435456" in dropin
    assert "Environment=CORTEX_L22_CODEC_MAX_CONTENT_BYTES=524288" in dropin
    assert "Environment=CODEC_DURABLE_MAX_SESSIONS=128" in dropin
    assert "MemoryHigh=2G" in dropin
    assert "MemoryMax=3G" in dropin
    assert "MemorySwapMax=512M" in dropin
    assert "OOMPolicy=stop" in dropin
