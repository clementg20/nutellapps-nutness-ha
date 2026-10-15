"""Capteur « Prochain cours » : la date du prochain cours, et tous les cours à venir en attributs."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import short_name
from .entity import NutnessEntity

ACTIVE = ("booked", "waiting", "planned")


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([NutnessNextClassSensor(entry.runtime_data, "next_class")])


class NutnessNextClassSensor(NutnessEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_icon = "mdi:dumbbell"

    def _next(self) -> dict | None:
        return next((b for b in self.bookings if b.get("status") in ACTIVE), None)

    @property
    def native_value(self) -> datetime | None:
        b = self._next()
        return datetime.fromisoformat(b["datetime"]) if b else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        club = self.coordinator.club
        b = self._next()
        return {
            "activity": short_name(b["activities"][0], club) if b and b.get("activities") else None,
            "status": b.get("status") if b else None,
            "club": club,
            "count": sum(1 for x in self.bookings if x.get("status") in ACTIVE),
            "nutness_bookings": [
                {
                    "date": x["date"],
                    "time": x["time"],
                    "datetime": x["datetime"],
                    "activity": (x.get("activities") or ["?"])[0],
                    "status": x.get("status"),
                    "waiting_position": x.get("waiting_position"),
                    "waiting_count": x.get("waiting_count"),
                    "scheduled_at": x.get("scheduled_at"),
                    "error": x.get("error"),
                }
                for x in self.bookings
            ],
        }
