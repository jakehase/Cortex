from __future__ import annotations

import pytest

import run as cortex_run


def test_alternate_launcher_defaults_to_loopback_without_reload():
    config = cortex_run.launch_config({})

    assert cortex_run._loopback_host(config["host"])
    assert config["reload"] is False


@pytest.mark.parametrize("port", ["not-an-integer", "0", "65536"])
def test_alternate_launcher_rejects_invalid_ports(port):
    with pytest.raises(RuntimeError, match="CORTEX_PORT"):
        cortex_run.launch_config({"CORTEX_PORT": port})


@pytest.mark.parametrize(
    "environment",
    [
        {"CORTEX_HOST": "0.0.0.0"},
        {
            "CORTEX_HOST": "0.0.0.0",
            "CORTEX_WRITE_AUTH_MODE": "token_required",
            "CORTEX_WRITE_TOKEN": "   ",
        },
        {
            "CORTEX_HOST": "0.0.0.0",
            "CORTEX_WRITE_AUTH_MODE": "token_required",
            "CORTEX_WRITE_TOKEN": f" {'x' * 31} ",
        },
    ],
)
def test_non_loopback_launcher_requires_token_mode_and_trimmed_32_byte_token(environment):
    with pytest.raises(RuntimeError, match="token_required mode.*32-byte write token"):
        cortex_run.launch_config(environment)


def test_non_loopback_launcher_allows_explicit_authenticated_bind():
    config = cortex_run.launch_config(
        {
            "CORTEX_HOST": "0.0.0.0",
            "CORTEX_PORT": "18888",
            "CORTEX_WRITE_AUTH_MODE": "token_required",
            "CORTEX_WRITE_TOKEN": f" {'x' * 32} ",
        }
    )

    assert config == {"host": "0.0.0.0", "port": 18888, "reload": False}


def test_non_loopback_launcher_rejects_reload_even_with_authentication():
    with pytest.raises(RuntimeError, match="reload is not allowed on a non-loopback bind"):
        cortex_run.launch_config(
            {
                "CORTEX_HOST": "0.0.0.0",
                "CORTEX_WRITE_AUTH_MODE": "token_required",
                "CORTEX_WRITE_TOKEN": "x" * 32,
                "CORTEX_RELOAD": "true",
            }
        )
