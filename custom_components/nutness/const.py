"""Constantes de l'intégration Nutness."""

from datetime import timedelta

DOMAIN = "nutness"
SITE = "https://nutness.cgrand.fr"
API_BASE = f"{SITE}/ha/v1"
AUTHORIZE_URL = f"{SITE}/autoriser"
VERSION = "1.0.1"

SCAN_INTERVAL = timedelta(minutes=5)
CONF_TOKEN = "token"
CONF_NOTIFY = "notify"
CONF_NOTIFY_EVENTS = "notify_events"

# Événements du service (journal /state) et ceux qui méritent une notification.
EVENT_TYPES = ["booked", "waiting", "promoted", "waiting_position", "cancelled", "planned", "failed"]
NOTIFY_CHOICES = ["promoted", "planned_done", "failed", "cancelled"]
DEFAULT_NOTIFY_EVENTS = ["promoted", "planned_done", "failed", "cancelled"]

BUS_EVENT = "nutness_event"
STATIC_URL = "/nutness_static"
CARD_URL = f"{STATIC_URL}/nutness-card.js?v={VERSION}"
