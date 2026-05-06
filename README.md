# flare ⏪

> Proaktives Developer Dashboard & Notification System.

`flare` überwacht deine Pull Requests und Jenkins-Builds im Hintergrund und benachrichtigt dich aktiv bei wichtigen Ereignissen (z.B. Build fehlgeschlagen, Changes Requested).

## Features

- **PR-Radar**: Benachrichtigungen bei neuen Approvals oder Änderungswünschen.
- **Jenkins-Watch**: Sofortige Meldung, wenn einer DEINER Builds fehlschlägt.
- **TUI Dashboard**: Ein schickes Terminal-UI für den schnellen Überblick.
- **Batterie-schonend**: Passt das Abfrage-Intervall auf dem MacBook automatisch an, wenn du nicht am Strom hängst.
- **Enterprise-Ready**: Unterstützt Proxies und Custom CAs (identisch zu `rewind`).

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

## Architektur

- **src/watcher.ts**: Das Herzstück (Polling & Notifications).
- **src/ui/dashboard.tsx**: Das Ink-basierte Terminal UI.
- **src/services/**: API-Integrationen für Jenkins & Bitbucket.
