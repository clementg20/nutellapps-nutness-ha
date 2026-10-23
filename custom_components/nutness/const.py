"""Constantes de l'intégration Nutness."""

from datetime import timedelta

DOMAIN = "nutness"
SITE = "https://nutness.cgrand.fr"
API_BASE = f"{SITE}/ha/v1"
AUTHORIZE_URL = f"{SITE}/autoriser"
VERSION = "1.0.8"

SCAN_INTERVAL = timedelta(minutes=5)
CONF_TOKEN = "token"
CONF_NOTIFY = "notify"
CONF_NOTIFY_EVENTS = "notify_events"

# Événements du service (journal /state) et ceux qui méritent une notification.
EVENT_TYPES = ["booked", "waiting", "promoted", "waiting_position", "cancelled", "planned", "failed"]
NOTIFY_CHOICES = ["promoted", "planned_booked", "planned_waiting", "failed", "cancelled"]
DEFAULT_NOTIFY_EVENTS = ["promoted", "planned_waiting", "failed", "cancelled"]
# Choix des versions ≤ 1.0.7 : « planned_done » couvrait prévu → réservé et prévu → liste d'attente.
LEGACY_NOTIFY_EVENTS = {"planned_done": "planned_waiting"}


def notify_events(options) -> list[str]:
    """Événements à notifier, choix des anciennes versions convertis."""
    wanted = [LEGACY_NOTIFY_EVENTS.get(e, e) for e in options.get(CONF_NOTIFY_EVENTS, DEFAULT_NOTIFY_EVENTS)]
    return [e for e in NOTIFY_CHOICES if e in wanted]

BUS_EVENT = "nutness_event"
STATIC_URL = "/nutness_static"
CARD_URL = f"{STATIC_URL}/nutness-card.js?v={VERSION}"
