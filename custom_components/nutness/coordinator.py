"""Mise à jour des cours du compte et relais des événements du serveur."""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import NutnessApi, NutnessAuthError, NutnessError
from .const import BUS_EVENT, CONF_NOTIFY, CONF_NOTIFY_EVENTS, DEFAULT_NOTIFY_EVENTS, DOMAIN, SCAN_INTERVAL

_LOGGER = logging.getLogger(__name__)

DAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."]
MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]


def short_name(activity: str, club: str | None) -> str:
    """« RPM Centre » → « RPM » (nom du club retiré en fin de nom)."""
    if club:
        activity = re.sub(rf"\s+{re.escape(club)}\s*$", "", activity, flags=re.IGNORECASE)
    return activity.strip()


def when(booking: dict[str, Any]) -> str:
    d = datetime.fromisoformat(booking["datetime"])
    return f"{DAYS[d.weekday()]} {d.day} {MONTHS[d.month - 1]} · {d.strftime('%H:%M').replace(':', 'h')}"


class NutnessCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Données : `bookings` (cours à venir), `friends` (amis et leurs cours) et `me` (compte relié)."""

    config_entry: ConfigEntry

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, api: NutnessApi) -> None:
        super().__init__(hass, _LOGGER, config_entry=entry, name=DOMAIN, update_interval=SCAN_INTERVAL)
        self.api = api
        self.me: dict[str, Any] = {}
        self.last_event_id: int | None = None
        self._listeners_events: list = []

    def on_event(self, listener) -> callable:
        """Abonnement aux événements du serveur (entité « événement »)."""
        self._listeners_events.append(listener)
        return lambda: self._listeners_events.remove(listener)

    @property
    def club(self) -> str | None:
        return self.me.get("club")

    async def _async_setup(self) -> None:
        try:
            self.me = await self.api.me()
            # Lecture fraîche auprès du club au démarrage : le suivi du serveur repart de là.
            await self.api.refresh()
        except NutnessAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except NutnessError as err:
            raise UpdateFailed(str(err)) from err

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            state = await self.api.state(self.last_event_id)
        except NutnessAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except NutnessError as err:
            raise UpdateFailed(str(err)) from err
        # Au premier passage on part du dernier événement : pas de rattrapage de l'historique.
        if self.last_event_id is not None:
            for event in state.get("events", []):
                self._dispatch(event)
        self.last_event_id = state.get("last_event_id", self.last_event_id or 0)
        return {"bookings": state.get("bookings", []), "friends": await self._friends()}

    async def _friends(self) -> list[dict[str, Any]]:
        """Amis acceptés et leurs cours : en cas d'échec on garde la liste précédente (les cours du compte priment)."""
        try:
            return (await self.api.friends()).get("friends", [])
        except NutnessAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except NutnessError as err:
            _LOGGER.debug("Amis indisponibles (%s)", err)
            return (self.data or {}).get("friends", [])

    async def async_refresh_from_club(self) -> list[dict[str, Any]]:
        """Bouton « Actualiser » : relecture auprès du club, puis état et événements."""
        try:
            await self.api.refresh()
        except NutnessAuthError as err:
            self.config_entry.async_start_reauth(self.hass)
            raise NutnessError(str(err)) from err
        await self.async_refresh()
        return self.data["bookings"] if self.data else []

    # ───── Événements ─────

    def _dispatch(self, event: dict[str, Any]) -> None:
        booking = event.get("booking") or {}
        kind = event.get("event")
        data = {
            "event": kind,
            "previous_status": event.get("previous_status"),
            "status": event.get("status"),
            "source": event.get("source"),
            "at": event.get("at"),
            "date": booking.get("date"),
            "time": booking.get("time"),
            "datetime": booking.get("datetime"),
            "activity": (booking.get("activities") or ["?"])[0],
            "waiting_position": booking.get("waiting_position"),
            "waiting_count": booking.get("waiting_count"),
            "error": booking.get("error"),
            "config_entry_id": self.config_entry.entry_id,
        }
        self.hass.bus.async_fire(BUS_EVENT, data)
        for listener in list(self._listeners_events):
            listener(kind, data)
        self._notify(kind, event, data)

    def _notify(self, kind: str, event: dict[str, Any], data: dict[str, Any]) -> None:
        options = self.config_entry.options
        targets = options.get(CONF_NOTIFY, [])
        wanted = options.get(CONF_NOTIFY_EVENTS, DEFAULT_NOTIFY_EVENTS)
        if not targets or not data.get("datetime"):
            return
        previous = event.get("previous_status")
        category = None
        if kind == "promoted":
            category, title = "promoted", "🎉 Place libérée, tu es inscrit"
        elif kind in ("booked", "waiting") and previous == "planned":
            category, title = "planned_done", "✅ Réservé" if kind == "booked" else "⏳ Liste d'attente"
        elif kind == "failed":
            category, title = "failed", "❌ Réservation automatique échouée"
        elif kind == "cancelled" and event.get("source") == "watcher":
            category, title = "cancelled", "🗑️ Cours annulé"
        if category is None or category not in wanted:
            return
        message = f"{short_name(data['activity'], self.club)} · {when(data)}"
        if kind == "waiting" and data.get("waiting_position"):
            message += f" · rang {data['waiting_position']}"
        tag = f"nutness-{data['date']}-{data['time']}"
        for target in targets:
            if target == "persistent_notification":
                self.hass.async_create_task(self.hass.services.async_call(
                    "persistent_notification", "create", {"title": title, "message": message, "notification_id": tag}))
            elif self.hass.services.has_service("notify", target):
                self.hass.async_create_task(self.hass.services.async_call(
                    "notify", target, {"title": title, "message": message, "data": {"tag": tag, "group": "nutness"}}))
