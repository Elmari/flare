# flare ⏪

> Proaktives Developer Dashboard & Notification System.

`flare` überwacht deine Pull Requests und Jenkins-Builds im Hintergrund und benachrichtigt dich aktiv bei wichtigen Ereignissen (Build fehlgeschlagen, Changes Requested, Review angefordert, …).

## Features

- **PR-Radar**: Notifications bei Approvals, Änderungswünschen und neu angeforderten Reviews.
- **Jenkins-Watch**: Sofortige Meldung, wenn einer DEINER Builds fehlschlägt — auch über Multibranch-Projekte hinweg, ohne jeden Branch zu konfigurieren.
- **Identity-Filter**: Erkennt automatisch, welche Builds/PRs dich betreffen (Trigger-User, Commit-Author oder Reviewer-Rolle).
- **Notification-Cooldown**: 4h-Cooldown pro Event verhindert Spam bei flapping Status (NEEDS_WORK → UNAPPROVED → NEEDS_WORK).
- **TUI Dashboard**: Terminal-UI mit Auto-Refresh, Tastatur-Navigation und „im Browser öffnen".
- **Batterie-schonend**: Passt das Abfrage-Intervall auf dem MacBook automatisch an, wenn du nicht am Strom hängst.
- **Enterprise-Ready**: Unterstützt Proxies und Custom CAs (`HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`).

## Quick Start

```bash
npm install
npm run build
npm link

flare config init
cp .env.example .env # Tokens eintragen
```

## Benutzung

- `flare watch`: Startet den Hintergrund-Prozess (am besten via LaunchAgent automatisieren).
- `flare status`: Öffnet das interaktive Dashboard im Terminal.

### Dashboard-Shortcuts

| Taste         | Wirkung                                 |
| ------------- | --------------------------------------- |
| `↑` / `↓`     | Eintrag im aktiven Panel auswählen      |
| `Tab`         | zwischen Jenkins / Bitbucket wechseln   |
| `o` / `Enter` | ausgewählten Eintrag im Browser öffnen  |
| `r`           | Refresh erzwingen                       |
| `q` / `Esc`   | beenden                                 |

## Konfiguration

`flare config init` schreibt eine Sample-Config nach `~/.config/flare/config.yaml`. Wichtige Felder:

```yaml
identity:
  username: your.username       # SSO-Username (matched gegen Jenkins-Trigger und Bitbucket-Reviewer-Slug)
  emails:
    - you@firma.de              # Commit-Author-Email für Multibranch-Erkennung

sources:
  jenkins:
    base_url: https://jenkins.firma.de
    username: your.username
    api_token_env: JENKINS_TOKEN
    jobs:
      - path: team-x/api-service          # Leaf-Job
        my_builds_only: true
      - path: scjsk/BandIT                # Multibranch-Projekt — alle Branches mit deinen Commits werden automatisch beobachtet
        my_builds_only: true

  bitbucket:
    base_url: https://bitbucket.firma.de
    pat_env: BITBUCKET_PAT
    my_prs_only: true
    ignored_authors:                       # Service-Accounts, deren PRs ignoriert werden sollen
      - dependabot
      - release-bot

settings:
  poll_interval_seconds: 120               # Watcher-Polling im Netz
  battery_poll_interval_seconds: 600       # langsameres Polling auf Akku (macOS)
  dashboard_refresh_seconds: 30            # Auto-Refresh im TUI
  notify_on_build_success: false           # auch bei grünen Builds pingen (default: aus)
  notify_on_review_requested: true         # pingen, wenn ein PR neu zur Review zugewiesen wird
```

## Welche Notifications du wann bekommst

| Event                                    | Notification              | Default | Override                       |
| ---------------------------------------- | ------------------------- | ------- | ------------------------------ |
| Build wechselt nach `FAILURE`            | Build Failed 🚨           | an      | —                              |
| Build geht von `FAILURE` → `SUCCESS`     | Build Fixed ✅            | an      | —                              |
| Build wechselt nach `SUCCESS` (allgemein)| Build Passed ✅           | aus     | `notify_on_build_success`      |
| PR-Status wechselt zu `NEEDS_WORK`       | Changes Requested ⚠️       | an      | —                              |
| PR-Status wechselt zu `APPROVED`         | PR Approved ✅            | an      | —                              |
| Du wirst neu als Reviewer hinzugefügt    | Review Requested 👀       | an      | `notify_on_review_requested`   |

Ein 4h-Cooldown pro `(Event, ID)` verhindert Wiederholungs-Notifications bei flapping Status.

## Architektur

- [src/watcher.ts](src/watcher.ts): Polling, Diffing, Notification-Dispatch.
- [src/ui/dashboard.tsx](src/ui/dashboard.tsx): Ink-basiertes Terminal-UI (`flare status`).
- [src/services/jenkins.ts](src/services/jenkins.ts) und [src/services/bitbucket.ts](src/services/bitbucket.ts): API-Adapter mit Zod-Validierung.
- [src/dedup.ts](src/dedup.ts): Notification-Cooldown-Logik mit Tests in [tests/dedup.test.ts](tests/dedup.test.ts).
- `assets/flare.svg` ist die Quelle für das App-Icon. `npm run build:icon` rendert daraus `assets/flare.png`, das `node-notifier` für Toasts verwendet.
