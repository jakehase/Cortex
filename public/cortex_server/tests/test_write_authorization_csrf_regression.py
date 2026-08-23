import asyncio

import httpx
import pytest
from fastapi import FastAPI

from cortex_server.middleware.write_authorization import WriteAuthorizationMiddleware


def _write_app(*, token="csrf-regression-secret"):
    app = FastAPI()
    app.add_middleware(
        WriteAuthorizationMiddleware,
        mode="token_or_loopback",
        token=token,
        header_name="x-test-write-token",
        allowed_origins={"http://localhost", "https://console.example"},
    )

    @app.post("/bodyless-write")
    async def bodyless_write():
        return {"mutated": True}

    return app


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "headers",
    [
        {"origin": "https://hostile.example"},
        {"origin": "null"},
        {"origin": "https://console.example.evil.invalid"},
        {"sec-fetch-site": "cross-site"},
        {"sec-fetch-site": "malformed"},
        {"origin": "http://localhost", "sec-fetch-site": "cross-site"},
    ],
)
async def test_loopback_browser_write_requires_token_for_untrusted_context(headers):
    transport = httpx.ASGITransport(app=_write_app(), client=("127.0.0.1", 43100))
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
        response = await client.post("/bodyless-write", headers=headers)

    assert response.status_code == 403
    assert response.json() == {
        "success": False,
        "error": "write authorization required",
        "authorizationMode": "token_or_loopback",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"origin": "http://localhost", "sec-fetch-site": "same-origin"},
        {"origin": "https://console.example", "sec-fetch-site": "same-site"},
    ],
)
async def test_loopback_address_never_replaces_transport_authentication(headers):
    transport = httpx.ASGITransport(app=_write_app(), client=("::1", 43101))
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
        response = await client.post("/bodyless-write", headers=headers)

    assert response.status_code == 403
    assert response.json()["error"] == "write authorization required"


@pytest.mark.asyncio
async def test_valid_token_overrides_cross_site_metadata_without_weakening_other_requests():
    transport = httpx.ASGITransport(app=_write_app(), client=("127.0.0.1", 43102))
    hostile = {"origin": "https://hostile.example", "sec-fetch-site": "cross-site"}
    authorized = {**hostile, "x-test-write-token": "csrf-regression-secret"}
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
        denied, allowed = await asyncio.gather(
            client.post("/bodyless-write", headers=hostile),
            client.post("/bodyless-write", headers=authorized),
        )

    assert denied.status_code == 403
    assert allowed.status_code == 200
    assert allowed.json() == {"mutated": True}


@pytest.mark.asyncio
async def test_untrusted_loopback_browser_fails_closed_when_token_is_unconfigured():
    transport = httpx.ASGITransport(app=_write_app(token=""), client=("127.0.0.1", 43103))
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
        response = await client.post(
            "/bodyless-write", headers={"origin": "https://hostile.example"}
        )

    assert response.status_code == 403
    assert response.json()["error"] == "write authorization is not configured"
