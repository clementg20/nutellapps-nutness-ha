"""Bouton « Actualiser » : relecture immédiate auprès du club."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api import NutnessError
from .entity import NutnessEntity


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([NutnessRefreshButton(entry.runtime_data, "refresh")])


class NutnessRefreshButton(NutnessEntity, ButtonEntity):
    _attr_icon = "mdi:refresh"

    async def async_press(self) -> None:
        try:
            await self.coordinator.async_refresh_from_club()
        except NutnessError as err:
            raise HomeAssistantError(str(err)) from err
