"""Nutness : planning, réservations et notifications depuis Home Assistant."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType

from .api import NutnessApi, NutnessAuthError, NutnessError
from .const import CARD_URL, CONF_TOKEN, DOMAIN, STATIC_URL
from .coordinator import NutnessCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR, Platform.CALENDAR, Platform.EVENT, Platform.BUTTON]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type NutnessConfigEntry = ConfigEntry[NutnessCoordinator]

DATE = vol.Match(r"^\d{4}-\d{2}-\d{2}$")
TIME = vol.Match(r"^\d{1,2}:\d{2}(:\d{2})?$")
BASE = {vol.Optional("config_entry_id"): cv.string}
BOOKING_SCHEMA = vol.Schema({**BASE, vol.Required("date"): vol.Any(DATE, cv.date), vol.Required("time"): vol.Any(TIME, cv.time),
                             vol.Required("activity"): cv.string})
PLANNING_SCHEMA = vol.Schema({**BASE, vol.Optional("date"): vol.Any(DATE, cv.date), vol.Optional("week", default=True): cv.boolean})
REFRESH_SCHEMA = vol.Schema(BASE)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Actions et carte : enregistrées une fois pour toutes les entrées."""
    await hass.http.async_register_static_paths(
        [StaticPathConfig(STATIC_URL, str(Path(__file__).parent / "frontend"), cache_headers=True)]
    )
    add_extra_js_url(hass, CARD_URL)

    def coordinator_for(call: ServiceCall) -> NutnessCoordinator:
        entry_id = call.data.get("config_entry_id")
        entries = [e for e in hass.config_entries.async_entries(DOMAIN) if e.state is ConfigEntryState.LOADED]
        if entry_id:
            entries = [e for e in entries if e.entry_id == entry_id]
        if not entries:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="no_entry")
        if len(entries) > 1:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="several_entries")
        return entries[0].runtime_data

    def text(value: Any, fmt: str) -> str:
        return value if isinstance(value, str) else value.strftime(fmt)

    async def run(coordinator: NutnessCoordinator, coro, what: str = "") -> dict[str, Any]:
        try:
            r = await coro
        except NutnessAuthError as err:
            _LOGGER.warning("%s : clé refusée (%s)", what, err)
            coordinator.config_entry.async_start_reauth(hass)
            raise HomeAssistantError(str(err)) from err
        except NutnessError as err:
            _LOGGER.warning("%s : échec (%s)", what, err)
            raise HomeAssistantError(str(err)) from err
        if what:
            _LOGGER.info("%s : %s", what, r.get("status") if isinstance(r, dict) else r)
        return r

    async def book(call: ServiceCall) -> ServiceResponse:
        _LOGGER.info("Action %s reçue : %s", call.service, dict(call.data))
        c = coordinator_for(call)
        time = text(call.data["time"], "%H:%M")[:5].zfill(5)
        date = text(call.data["date"], "%Y-%m-%d")
        what = f"Réservation {date} {time} {call.data['activity']}"
        r = await run(c, c.api.book(date, time, call.data["activity"]), what)
        await c.async_request_refresh()
        return r

    async def cancel(call: ServiceCall) -> ServiceResponse:
        _LOGGER.info("Action %s reçue : %s", call.service, dict(call.data))
        c = coordinator_for(call)
        time = text(call.data["time"], "%H:%M")[:5].zfill(5)
        date = text(call.data["date"], "%Y-%m-%d")
        what = f"Annulation {date} {time} {call.data['activity']}"
        r = await run(c, c.api.cancel(date, time, call.data["activity"]), what)
        await c.async_request_refresh()
        return r

    async def planning(call: ServiceCall) -> ServiceResponse:
        c = coordinator_for(call)
        date = call.data.get("date")
        r = await run(c, c.api.classes(text(date, "%Y-%m-%d") if date else None, call.data["week"]))
        return {**r, "club": c.club}

    async def refresh(call: ServiceCall) -> ServiceResponse:
        c = coordinator_for(call)
        try:
            bookings = await c.async_refresh_from_club()
        except NutnessError as err:
            raise HomeAssistantError(str(err)) from err
        return {"bookings": bookings, "club": c.club}

    hass.services.async_register(DOMAIN, "reserver", book, BOOKING_SCHEMA, SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "annuler", cancel, BOOKING_SCHEMA, SupportsResponse.OPTIONAL)
    hass.services.async_register(DOMAIN, "planning", planning, PLANNING_SCHEMA, SupportsResponse.ONLY)
    hass.services.async_register(DOMAIN, "actualiser", refresh, REFRESH_SCHEMA, SupportsResponse.OPTIONAL)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: NutnessConfigEntry) -> bool:
    api = NutnessApi(async_get_clientsession(hass), entry.data[CONF_TOKEN])
    coordinator = NutnessCoordinator(hass, entry, api)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    # Les options (notifications) sont relues à chaque événement : rien à recharger quand elles changent.
    return True


async def async_unload_entry(hass: HomeAssistant, entry: NutnessConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_remove_entry(hass: HomeAssistant, entry: NutnessConfigEntry) -> None:
    """Intégration supprimée : la clé est révoquée côté serveur."""
    try:
        await NutnessApi(async_get_clientsession(hass), entry.data[CONF_TOKEN]).revoke()
    except NutnessError as err:
        _LOGGER.info("Révocation de la clé impossible (%s) : elle peut être révoquée sur nutness.cgrand.fr", err)
