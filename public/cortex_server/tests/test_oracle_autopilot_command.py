from types import SimpleNamespace

from cortex_server.routers.oracle import _extract_autopilot_status_mode, _run_autopilot_status_command


def test_extract_autopilot_status_mode_plain():
    assert _extract_autopilot_status_mode('/autopilot_status') is False
    assert _extract_autopilot_status_mode('/opt/clawdbot/scripts/autopilot_status.sh') is False
    assert _extract_autopilot_status_mode('autopilot status') is False


def test_extract_autopilot_status_mode_json():
    assert _extract_autopilot_status_mode('/autopilot_status --json') is True
    assert _extract_autopilot_status_mode('/opt/clawdbot/scripts/autopilot_status.sh --json') is True


def test_extract_autopilot_status_mode_none():
    assert _extract_autopilot_status_mode('what is cortex status') is None


def test_run_autopilot_status_command_success(monkeypatch):
    monkeypatch.setattr('cortex_server.routers.oracle._read_autopilot_status_cache', lambda *_: None)
    monkeypatch.setattr('cortex_server.routers.oracle.os.path.exists', lambda p: True)
    monkeypatch.setattr(
        'cortex_server.routers.oracle.subprocess.run',
        lambda *a, **k: SimpleNamespace(returncode=0, stdout='AUTOPILOT_STATUS GREEN\n', stderr='')
    )
    assert _run_autopilot_status_command(False) == 'AUTOPILOT_STATUS GREEN'


def test_run_autopilot_status_command_failure_falls_back(monkeypatch):
    monkeypatch.setattr('cortex_server.routers.oracle._read_autopilot_status_cache', lambda *_: None)
    monkeypatch.setattr('cortex_server.routers.oracle.os.path.exists', lambda p: True)
    monkeypatch.setattr(
        'cortex_server.routers.oracle.subprocess.run',
        lambda *a, **k: SimpleNamespace(returncode=1, stdout='', stderr='boom')
    )

    out = _run_autopilot_status_command(True)
    assert '"mode": "oracle_fallback"' in out
