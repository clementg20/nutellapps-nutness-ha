# Nutness

> **Intégration privée.** Elle ne fonctionne que pour les personnes invitées : il faut un compte
> autorisé sur [nutness.cgrand.fr](https://nutness.cgrand.fr). Sans invitation, rien ne s'installe
> utilement. Pas de support public.

Planning, réservations et listes d'attente de cours de sport, depuis Home Assistant. Les
inscriptions ouvrent 72 h avant chaque cours : une réservation demandée plus tôt est faite
automatiquement à l'ouverture.

## Installation (personnes invitées)

1. **HACS** :

   [![Ouvrir dans HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=clementg20&repository=nutellapps-nutness-ha&category=integration)

   Télécharger, puis redémarrer Home Assistant.

2. **Ajouter l'intégration** :

   [![Ajouter l'intégration](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=nutness)

   Une page Nutness s'ouvre : se connecter, saisir ses identifiants du club (une seule fois), puis
   **Autoriser**. Home Assistant termine tout seul.

3. **Carte** : modifier un tableau de bord → Ajouter une carte → **Nutness**. Le planning s'ouvre
   dans une fenêtre (option « Planning dans une fenêtre » pour l'afficher sous la carte).

## Ce que l'intégration apporte

| Élément | Rôle |
|---|---|
| Carte `custom:nutness-card` | Prochains cours, planning de la semaine, réserver ou annuler (deux appuis), filtre des activités, bulles des amis à côté de leurs cours |
| `sensor.…_prochain_cours` | Date du prochain cours ; tous les cours à venir dans l'attribut `nutness_bookings`, ceux des amis dans `nutness_friends` |
| `calendar.…_cours` | Cours réservés, en liste d'attente ou prévus |
| `event.…_reservation` | Chaque changement : réservé, liste d'attente, place libérée, annulé, échec… |
| `button.…_actualiser` | Relecture immédiate |
| Événement `nutness_event` | Le même changement, sur le bus, pour les automatisations |

**Actions** : `nutness.reserver`, `nutness.annuler` (date, heure, activité), `nutness.planning`
(renvoie les cours d'une journée ou d'une semaine), `nutness.actualiser`.

```yaml
action: nutness.reserver
data:
  date: "2026-10-20"
  time: "19:15"
  activity: RPM
```

**Amis** : ils se gèrent sur nutness.cgrand.fr (icône Amis). Leurs cours réservés, prévus ou en liste
d'attente apparaissent dans la carte : bulle pleine, ou cerclée en liste d'attente.

**Notifications** : Paramètres → Appareils et services → Nutness → Configurer.

**Réserver depuis un agenda** : blueprint fourni.

[![Importer le blueprint](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fclementg20%2Fnutellapps-nutness-ha%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fnutness%2Freserver_depuis_agenda.yaml)

## Retirer

Supprimer l'intégration révoque sa clé. Les accès se gèrent aussi sur nutness.cgrand.fr.

## Confidentialité

Les identifiants du club sont saisis sur nutness.cgrand.fr, jamais dans Home Assistant, et y sont
gardés chiffrés. Home Assistant ne reçoit qu'une clé propre à cette installation, révocable.
Détail : [cgrand.fr/confidentialite](https://cgrand.fr/confidentialite).
