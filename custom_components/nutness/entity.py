"""Base commune des entités : un appareil « service » par compte relié."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, VERSION
from .coordinator import NutnessCoordinator


class NutnessEntity(CoordinatorEntity[NutnessCoordinator]):
    _attr_has_entity_name = True

    def __init__(self, coordinator: NutnessCoordinator, key: str) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_translation_key = key
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=entry.title,
            manufacturer="Nutness",
            model=coordinator.club or "Nutness",
            sw_version=VERSION,
            entry_type=DeviceEntryType.SERVICE,
            configuration_url="https://nutness.cgrand.fr",
        )

    @property
    def bookings(self) -> list[dict]:
        return (self.coordinator.data or {}).get("bookings", [])
