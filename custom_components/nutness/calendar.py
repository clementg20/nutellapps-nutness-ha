"""Calendrier des cours réservés, en liste d'attente ou prévus."""

from __future__ import annotations

from datetime import datetime, timedelta

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import short_name
from .entity import NutnessEntity

LABELS = {"booked": "", "waiting": " ⏳", "planned": " 🕒", "failed": " ❌"}
DEFAULT_DURATION = timedelta(minutes=45)


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([NutnessCalendar(entry.runtime_data, "classes")])


class NutnessCalendar(NutnessEntity, CalendarEntity):
    def _events(self) -> list[CalendarEvent]:
        club = self.coordinator.club
        events = []
        for b in self.bookings:
            status = b.get("status")
            if status not in LABELS:
                continue
            start = datetime.fromisoformat(b["datetime"])
            end = start + DEFAULT_DURATION
            if b.get("end_time"):
                h, m = (int(x) for x in b["end_time"].split(":"))
                end = start.replace(hour=h, minute=m)
            if b.get("waiting_position"):
                detail = f"Liste d'attente : {b['waiting_position']}/{b.get('waiting_count') or '?'}"
            elif status == "planned":
                detail = f"Réservation automatique le {datetime.fromisoformat(b['scheduled_at']).strftime('%d/%m %Hh%M')}" if b.get("scheduled_at") else "Réservation prévue"
            else:
                detail = b.get("error") or ""
            events.append(CalendarEvent(
                start=start, end=end, summary=f"{short_name((b.get('activities') or ['?'])[0], club)}{LABELS[status]}",
                description=detail or None, location=club, uid=f"nutness-{b['id']}",
            ))
        return events

    @property
    def event(self) -> CalendarEvent | None:
        now = datetime.now().astimezone()
        return next((e for e in self._events() if e.end > now), None)

    async def async_get_events(self, hass: HomeAssistant, start_date: datetime, end_date: datetime) -> list[CalendarEvent]:
        return [e for e in self._events() if e.end > start_date and e.start < end_date]
