"""Client de l'API Nutness (https://nutness.cgrand.fr/ha/v1)."""

from __future__ import annotations

import asyncio
from typing import Any

import aiohttp

from .const import API_BASE, VERSION

TIMEOUT = aiohttp.ClientTimeout(total=70)
HEADERS = {"User-Agent": f"HomeAssistant-Nutness/{VERSION}"}


class NutnessError(Exception):
    """Erreur renvoyée par l'API (le message est celui du serveur)."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class NutnessAuthError(NutnessError):
    """Clé révoquée ou compte retiré : il faut reconnecter l'intégration."""


async def _request(
    session: aiohttp.ClientSession,
    method: str,
    path: str,
    *,
    token: str | None = None,
    params: dict[str, Any] | None = None,
    json: dict[str, Any] | None = None,
) -> Any:
    headers = dict(HEADERS)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        async with session.request(
            method, f"{API_BASE}{path}", headers=headers, params=params, json=json, timeout=TIMEOUT
        ) as resp:
            if resp.status == 204:
                return None
            try:
                body = await resp.json(content_type=None)
            except (aiohttp.ContentTypeError, ValueError):
                body = None
            detail = body.get("detail") if isinstance(body, dict) else None
            if resp.status == 401:
                raise NutnessAuthError(detail or "Clé refusée", resp.status)
            if resp.status >= 400 and resp.status not in (202, 410):
                raise NutnessError(detail or f"HTTP {resp.status}", resp.status)
            return body
    except (aiohttp.ClientError, asyncio.TimeoutError) as err:
        raise NutnessError(f"Serveur Nutness injoignable ({type(err).__name__})") from err


async def start_link(session: aiohttp.ClientSession, name: str) -> dict[str, Any]:
    """Demande un code de liaison (sans clé)."""
    return await _request(session, "POST", "/link", json={"name": name})


async def poll_link(session: aiohttp.ClientSession, device_code: str) -> dict[str, Any]:
    """État de la demande : pending, approved (avec la clé), denied, expired ou invalid."""
    return await _request(session, "POST", "/link/token", json={"device_code": device_code})


class NutnessApi:
    """Appels authentifiés d'une entrée de configuration."""

    def __init__(self, session: aiohttp.ClientSession, token: str) -> None:
        self._session = session
        self._token = token

    async def _call(self, method: str, path: str, **kwargs: Any) -> Any:
        return await _request(self._session, method, path, token=self._token, **kwargs)

    async def me(self) -> dict[str, Any]:
        return await self._call("GET", "/me")

    async def state(self, after: int | None) -> dict[str, Any]:
        return await self._call("GET", "/state", params=None if after is None else {"after": after})

    async def refresh(self) -> dict[str, Any]:
        return await self._call("POST", "/refresh")

    async def classes(self, date: str | None, week: bool) -> dict[str, Any]:
        params = {"week": "true" if week else "false"}
        if date:
            params["date"] = date
        return await self._call("GET", "/classes", params=params)

    async def activities(self) -> dict[str, Any]:
        return await self._call("GET", "/activities")

    async def book(self, date: str, time: str, activity: str) -> dict[str, Any]:
        return await self._call("POST", "/bookings", json={"date": date, "time": time, "activity": activity})

    async def cancel(self, date: str, time: str, activity: str) -> dict[str, Any]:
        return await self._call("POST", "/bookings/cancel", json={"date": date, "time": time, "activity": activity})

    async def revoke(self) -> None:
        await self._call("DELETE", "/token")
