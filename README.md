# flare ⏪

> Proactive developer dashboard & notification system.

`flare` watches your pull requests and Jenkins builds in the background and pings you the moment something relevant happens (build failed, changes requested, review assigned, …).

## Features

- **PR radar**: notifications on approvals, change requests, and newly assigned reviews.
- **Jenkins watch**: instant alerts when one of *your* builds fails — across multibranch projects, without configuring every branch by hand.
- **Identity filter**: figures out on its own which builds and PRs concern you (trigger user, commit author, or reviewer role).
- **Notification cooldown**: 4h cooldown per event prevents spam from flapping status (`NEEDS_WORK → UNAPPROVED → NEEDS_WORK`).
- **TUI dashboard**: terminal UI with auto-refresh, keyboard navigation, build-trend sparkline (`✓✓✗✓✗`), watcher heartbeat, and "open in browser".
- **AI analysis on demand**: optional — press `a` in the dashboard to summarise a build failure or a PR diff via an LLM.
- **Battery friendly**: slows the polling cadence on a MacBook running on battery.
- **Enterprise ready**: honours `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` and `NODE_EXTRA_CA_CERTS` for corporate proxies and custom CA bundles.

## Quick start

```bash
npm install
npm run build
npm link

flare config init
cp .env.example .env # fill in your tokens
```

## Usage

- `flare watch`: starts the background watcher.
- `flare status`: opens the interactive dashboard in the terminal (fullscreen via the alt-screen buffer; pressing `q` brings your previous terminal contents back unchanged). Use `flare status --no-fullscreen` to render inline if you want to copy output or keep it in scrollback.
- `flare install-agent` (macOS): registers a LaunchAgent that starts `flare watch` on login and keeps it alive in the background. Logs go to `~/Library/Logs/flare/watcher.{out,err}.log`.
- `flare reload-agent` (macOS): restarts the LaunchAgent — needed after `npm run build` so the running watcher picks up the new code.
- `flare uninstall-agent` (macOS): unloads the LaunchAgent and removes the plist.

> When running as a LaunchAgent, flare additionally loads `~/.config/flare/.env`, since LaunchAgents don't inherit your shell profile. Put your tokens (`JENKINS_TOKEN`, `BITBUCKET_PAT`, optionally `GEMINI_API_KEY`) there.

### Dashboard shortcuts

| Key           | Action                                              |
| ------------- | --------------------------------------------------- |
| `↑` / `↓`     | move selection within the active panel              |
| `Tab`         | switch between Jenkins and Bitbucket panels         |
| `o` / `Enter` | open the selected entry in your browser             |
| `a`           | AI analysis for the selected entry (see AI setup)   |
| `r`           | force a refresh                                     |
| `q` / `Esc`   | close the detail pane, or quit                      |

## Configuration

`flare config init` writes a sample config to `~/.config/flare/config.yaml`. Key fields:

```yaml
identity:
  username: your.username       # SSO username (matched against Jenkins triggers and Bitbucket reviewer slugs)
  emails:
    - you@firma.de              # commit-author email used for multibranch attribution

sources:
  jenkins:
    base_url: https://jenkins.firma.de
    username: your.username
    api_token_env: JENKINS_TOKEN
    jobs:
      - path: team-x/api-service          # leaf job
        my_builds_only: true
      - path: team-x/api-multibranch      # multibranch project — every branch with your commits is watched automatically
        my_builds_only: true

  bitbucket:
    base_url: https://bitbucket.firma.de
    pat_env: BITBUCKET_PAT
    my_prs_only: true
    ignored_authors:                       # service accounts whose PRs should be filtered out
      - dependabot
      - release-bot

settings:
  poll_interval_seconds: 120               # watcher polling cadence on AC power
  battery_poll_interval_seconds: 600       # slower cadence on battery (macOS)
  dashboard_refresh_seconds: 30            # TUI auto-refresh interval
  notify_on_build_success: false           # also ping on green builds (default: off)
  notify_on_review_requested: true         # ping when you're newly added as reviewer
  notification_timeout_seconds: 10         # how long a toast stays visible (1–60s)
```

## Notification matrix

| Event                                      | Notification          | Default | Override                       |
| ------------------------------------------ | --------------------- | ------- | ------------------------------ |
| Build transitions to `FAILURE`             | Build Failed 🚨       | on      | —                              |
| Build goes from `FAILURE` → `SUCCESS`      | Build Fixed ✅        | on      | —                              |
| Build transitions to `SUCCESS` (general)   | Build Passed ✅       | off     | `notify_on_build_success`      |
| PR status changes to `NEEDS_WORK`          | Changes Requested ⚠️   | on      | —                              |
| PR status changes to `APPROVED`            | PR Approved ✅        | on      | —                              |
| You are newly added as a reviewer          | Review Requested 👀   | on      | `notify_on_review_requested`   |

A 4h cooldown per `(event, id)` prevents repeat notifications when status flaps.

> **macOS note on display duration**: `notification_timeout_seconds` is effectively a no-op on macOS — the system auto-dismisses *banner*-style toasts after roughly 5s no matter what we send, and *alert*-style toasts stay until you click them away (also ignoring the value). If your toasts disappear too quickly, switch the hosting app's notification style to **Alerts** under *System Settings → Notifications → Terminal / iTerm / Node*. On **Windows/Linux** the value is honoured as the actual display time.

## AI analysis (optional)

In the dashboard, pressing `a` on a selected entry summarises its context via an LLM:

- **Build failure** → the console log is fetched, sent to the LLM, and the response is rendered as a summary + likely cause + (when derivable) fix hint.
- **PR review** → the diff is fetched and rendered as summary + key files + review focus.

The feature is **off by default**. flare calls a **Gemini `generateContent` endpoint** directly — that's Vertex AI, your corporate Gemini gateway, or Google's public Generative Language API. Auth runs entirely through `custom_headers` with `${ENV_VAR}` substitution at request time (the same pattern as [`rewind`](../rewind)).

```yaml
llm:
  endpoint: https://corp-llm-proxy.firma.de/projects/PROJECT/locations/europe-west1/publishers/google/models/gemini-2.5-flash:generateContent
  custom_headers:
    x-api-key: '${GEMINI_API_KEY}'
    # x-tenant-id: team-x          # add whatever the gateway requires
  max_log_kb: 30                    # console log is truncated to the last N KB
  max_diff_kb: 50                   # PR diff is truncated to the first N KB
```

Important details:

- **No bearer header**: flare does *not* send `Authorization: Bearer …` because corporate gateways typically expect `x-api-key` (or another custom header). Configure auth entirely via `custom_headers`.
- **The model lives in the URL**: `…/models/gemini-2.5-flash:generateContent` — no separate `model:` field needed.
- **Env-var substitution**: values containing `${VAR}` are resolved from `process.env` at request time. A missing variable produces a clear error before the call is sent.
- **Proxy & CA**: `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` are honoured automatically; set `NODE_EXTRA_CA_CERTS` to a PEM file path for corporate custom CAs.
- **JSON output**: flare sets `generationConfig.responseMimeType: application/json`, parses with Zod, and falls back to a raw-text view if the response isn't valid JSON.

**Privacy note**: every press of `a` sends the **full (truncated) build log** or **PR diff** to the configured endpoint. Don't point flare at a public LLM for repositories with sensitive content — an internal gateway or a local Ollama is the safe choice. The watcher itself (`flare watch`) makes **no** LLM calls.

Analysis results are cached in memory for the lifetime of the TUI session, so pressing `a` on the same build or PR repeatedly does not burn additional tokens. Restarting the TUI clears the cache.

## Architecture

- [src/watcher.ts](src/watcher.ts): polling, diffing, notification dispatch.
- [src/ui/dashboard.tsx](src/ui/dashboard.tsx): Ink-based terminal UI (`flare status`).
- [src/services/jenkins.ts](src/services/jenkins.ts) and [src/services/bitbucket.ts](src/services/bitbucket.ts): API adapters with Zod validation.
- [src/llm.ts](src/llm.ts): Gemini `generateContent` client + prompt builders + response schemas powering the `a` action.
- [src/dedup.ts](src/dedup.ts): notification cooldown logic, covered by [tests/dedup.test.ts](tests/dedup.test.ts).
- [src/health.ts](src/health.ts): pure helpers behind the watcher heartbeat shown in the dashboard header.
- [src/agent.ts](src/agent.ts): macOS LaunchAgent install / reload / uninstall logic.
- `assets/flare.svg` is the source for the app icon. `npm run build:icon` renders it into `assets/flare.png`, which `node-notifier` uses for toast notifications.
