from pathlib import Path

import pytest

from cortex_server.modules.diplomat import TheDiplomat


_STATE_ENVIRONMENT = (
    "CORTEX_DIPLOMAT_STATE_DIR",
    "ORCHESTRATOR_RUNTIME_DELIVERY_ROOT",
    "CORTEX_ARTIFACT_ROOT",
    "XDG_STATE_HOME",
)


def _clear_state_environment(monkeypatch):
    for name in _STATE_ENVIRONMENT:
        monkeypatch.delenv(name, raising=False)


def test_diplomat_uses_explicit_absolute_state_directory(tmp_path):
    diplomat = TheDiplomat(state_dir=tmp_path / "diplomat")

    assert diplomat.message_log == tmp_path / "diplomat" / "diplomat_log.txt"
    assert diplomat.pending_requests_file == tmp_path / "diplomat" / "pending_requests.json"


def test_diplomat_prefers_dedicated_configured_state_directory(tmp_path, monkeypatch):
    _clear_state_environment(monkeypatch)
    monkeypatch.setenv("CORTEX_DIPLOMAT_STATE_DIR", str(tmp_path / "dedicated"))
    monkeypatch.setenv("ORCHESTRATOR_RUNTIME_DELIVERY_ROOT", str(tmp_path / "runtime"))

    diplomat = TheDiplomat()

    assert diplomat.message_log == tmp_path / "dedicated" / "diplomat_log.txt"


def test_diplomat_uses_durable_runtime_root_before_artifact_root(tmp_path, monkeypatch):
    _clear_state_environment(monkeypatch)
    monkeypatch.setenv("ORCHESTRATOR_RUNTIME_DELIVERY_ROOT", str(tmp_path / "runtime"))
    monkeypatch.setenv("CORTEX_ARTIFACT_ROOT", str(tmp_path / "artifacts"))

    diplomat = TheDiplomat()

    assert diplomat.message_log == tmp_path / "runtime" / "diplomat" / "diplomat_log.txt"


def test_diplomat_falls_back_to_user_state_not_working_tree(tmp_path, monkeypatch):
    _clear_state_environment(monkeypatch)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    working_tree = tmp_path / "working-tree"
    working_tree.mkdir()
    monkeypatch.chdir(working_tree)

    diplomat = TheDiplomat()
    diplomat._log_message("TEST", "state isolation", True)

    expected = tmp_path / "home" / ".local" / "state" / "cortex" / "diplomat" / "diplomat_log.txt"
    assert diplomat.message_log == expected
    assert expected.is_file()
    assert not (Path.cwd() / "cortex_server" / "knowledge" / "evolution" / "diplomat_log.txt").exists()


@pytest.mark.parametrize(
    "name",
    (
        "CORTEX_DIPLOMAT_STATE_DIR",
        "ORCHESTRATOR_RUNTIME_DELIVERY_ROOT",
        "CORTEX_ARTIFACT_ROOT",
        "XDG_STATE_HOME",
    ),
)
def test_diplomat_rejects_relative_mutable_state_roots(name, monkeypatch):
    _clear_state_environment(monkeypatch)
    monkeypatch.setenv(name, "relative/state")

    with pytest.raises(ValueError, match="must be an absolute path"):
        TheDiplomat()
