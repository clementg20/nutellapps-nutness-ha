"""Entité « événement » : chaque changement signalé par le serveur (réservé, place libérée…)."""

from __future__ import annotations

from homeassistant.components.event import EventEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import EVENT_TYPES
from .entity import NutnessEntity


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([NutnessEventEntity(entry.runtime_data, "booking_event")])


class NutnessEventEntity(NutnessEntity, EventEntity):
    _attr_event_types = EVENT_TYPES

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(self.coordinator.on_event(self._handle))

    @callback
    def _handle(self, kind: str, data: dict) -> None:
        if kind not in EVENT_TYPES:
            return
        self._trigger_event(kind, {k: v for k, v in data.items() if k not in ("event", "config_entry_id")})
        self.async_write_ha_state()
