# English Learning Sidecar

A local, non-intrusive English learning companion for coding agents.

Hooks copy user-authored text to a local collector. A separate model produces English learning cards; it never writes teaching content back into the main Agent's prompt. The UI uses React, TypeScript, Tailwind and shadcn/ui. The backend uses Node.js and SQLite.

## Quick start

Requires Node.js >= 22.13 and npm. Install dependencies before building or developing the frontend:

```sh
npm ci
npm run typecheck
npm run build
# Only if no local .env exists yet:
cp .env.example .env
npm start
# http://127.0.0.1:4317
```

The built frontend is served by the local Node service. Pulling source changes does not rebuild bundles or restart an already running backend. After updating, rebuild, restart your existing Sidecar process when appropriate, and refresh its page. Do not run a second process on the same port.

For development, run the backend and frontend in separate terminals:

```sh
npm run dev       # backend with file watching
npm run dev:web   # http://127.0.0.1:5173; proxies /api to 4317
```

## Connect a model (Live only)

Settings supports adding, editing, selecting and deleting separate text and speech model configurations. The dialog has a single **确定 / 取消 (Confirm / Cancel)** footer: capture switches, project rules, model edits, selection and removal are local drafts until Confirm submits them together. Cancel, Escape or closing the dialog discards unsaved changes. Completing a model form only stages that edit; Confirm also includes a valid model form still being edited. Validation failures keep the draft open without partial application. Saved changes apply to the next analysis, not a model request already in progress.

Only real model analysis is supported. Auto/Demo modes, fixed teaching cards and the sample endpoint have been removed. Legacy `LEARNING_MODE` / `SIDECAR_DEMO` environment values are ignored and saved mode preferences are migrated to Live; they cannot re-enable generated fixtures. Existing history is preserved.

When the selected text model has no API key or a valid endpoint, the UI shows **请先接入模型** and a **接入模型** button that opens text-model settings. Captured events stay queued, without any model call or fabricated lesson. After you configure and activate a model with a key, pending work resumes automatically unless collection is paused. Presence of a key does not guarantee valid credentials: actual upstream failures are reported as failed analyses, never silently replaced by samples.

On first startup, the environment's `LEARNING_BASE_URL`, `LEARNING_MODEL` and `LEARNING_API_KEY` seed the initial text configuration. Once a configuration exists, edit it in Settings; changing environment variables does not overwrite saved models. With no saved text model, the complete environment configuration is used as a fallback. Endpoint, model and key are never mixed field-by-field between providers.

Editing a model with a blank key input **preserves** its existing key. Use the explicit **Clear saved API key** checkbox to remove it. Changing the Base URL requires re-entering a key or explicitly clearing it; the backend also clears old credentials when an endpoint changes. URLs cannot contain credentials, query parameters or fragments.

Keys stay on the backend. API responses expose only a masked value. Model configurations are stored in `models.json` under the data directory with mode 0600 where supported. This is permission-protected local plaintext, **not encrypted storage**. Keep backups private.

Text models use OpenAI-compatible `/chat/completions`; speech models use `/audio/speech`. Text requests time out after 90 seconds and TTS after 20 seconds. Provider compatibility and voice availability must be validated with your chosen service.

## Learning experience

- Chinese-to-English translation, English correction and optional style suggestions.
- Four-layer curriculum: morphology/phonetics, vocabulary/collocations, sentence anatomy and discourse.
- Real corrections, optional style improvements and unclassified legacy suggestions are labeled separately. Only exact source excerpts are retained as correction candidates; this does not guarantee linguistic correctness.
- Missing analysis fields display as unavailable rather than invented grammar conclusions.
- Expanded paragraphs are explicitly **practice expansions, not translations or verified requirements**.
- Searchable recent history, knowledge library, copy, speech playback and live SSE updates.
- Cancel pending/processing analysis; cancelled and failed records can be retried.
- TTS playback cancels prior requests and releases audio resources when stopped or replaced. Failures can fall back to browser speech.

## Install an Agent Hook

Install only in authorized workspaces. The installer defaults to the current project and previews changes unless `--apply` is supplied:

```sh
node bin/install-hooks.cjs codex
node bin/install-hooks.cjs codex --apply
node bin/install-hooks.cjs cursor --apply
node bin/install-hooks.cjs claude --apply
node bin/install-hooks.cjs grok --apply
# Explicit global scope, only after considering privacy:
node bin/install-hooks.cjs codex --scope=user --apply
```

Existing hooks are preserved with backups. Codex/Grok may require reviewing and trusting hooks in their own UI; no trust bypass is used. Grok compatibility loading can execute overlapping Cursor/Claude hooks, so inspect its hook sources.

Pi has an input extension at `extensions/pi/english-sidecar.ts`. Qoder and DSH do **not** yet have verified dedicated installers. See [Integrations](docs/INTEGRATIONS.md) for details. Adapter implementation and synthetic tests are not proof of real-Agent compatibility.

Hooks have a short local request deadline and fail open. Codex/Claude/Grok stdout stays empty; Cursor only returns `{"continue":true}`. This protects the main task from collector errors, but is not zero execution overhead. Events sent while the collector is offline can be lost; only accepted events are durably queued.

## Privacy and project control

Settings includes a project capture policy:

- **All projects** is the compatibility default.
- **Allowlist** accepts only explicitly allowed absolute directories and their children.
- Excluded directories take precedence; directory boundaries are respected (`/work/app` does not include `/work/app-other`).
- Unknown projects are rejected in allowlist mode. Invalid or relative rules are rejected when saved.

Hook/Pi adapters send a project path only to the local collector for this decision. Only its hash is stored on an event, not the original path. Matching is lexical: it does not resolve symlink aliases. Configure the paths your Agent actually reports; this is not a filesystem security sandbox.

Before persistence and model transmission, the collector extracts natural-language text, removes code fences, serialized blocks and recognizable code/log lines, and redacts common credential formats and email addresses. Session and turn identifiers are hashed. Skipped payloads retain a safe placeholder, not the original code/log text. Legacy queued events are filtered again before analysis. TTS input is filtered too.

**Filtering is best-effort, not a confidentiality guarantee.** Natural-language business information can remain sensitive. Do not enable external analysis for unauthorized work. Existing stored history is not retroactively scrubbed by this update. A policy change affects new capture; it does not erase existing history or revoke a request already sent to a provider.

The service binds only to loopback. Ingestion requires a random local token, and Host/Origin checks protect local APIs from web origins and DNS rebinding. The UI has no separate user login: other software on your computer can access it. Do not expose it through a public tunnel or reverse proxy without additional authentication. Browser voice engines may depend on the browser/OS vendor's implementation.

## Deletion and cancellation

Deletion asks you to choose:

1. **Card only**: removes the prompt/card and its link to the knowledge library; explicitly retained knowledge and historical encounter counts remain.
2. **Card and derived knowledge**: removes that card's contribution. Shared knowledge remains if another card or an earlier explicit retention still references it; unused knowledge is removed.

Cancelling or deleting an active card aborts the local request, prevents late results from recreating the card or knowledge, and lets the next queued task proceed. Providers may already have processed or billed a request before cancellation; local cancellation is not a remote deletion guarantee. Legacy orphan knowledge is preserved during migration, since its origin can no longer be established.

## Storage and always-on operation

The default data directory is `~/.english-sidecar`, configurable with `SIDECAR_DATA_DIR`. It contains SQLite, the capture token, and model configuration. SQLite stores sanitized learning records, vocabulary/grammar, global pause and settings; unfinished processing resumes after restart. New schema fields are migrated additively.

This is event-driven: idle time does not trigger model calls. For login startup on macOS, see [Always-on setup](docs/ALWAYS_ON.md). Installing the repository does not automatically install that service.

Current limits: events API returns at most 150 recent records; the knowledge API defaults to 100. Full pagination, mastery tracking, spaced repetition, automatic assistant-reply analysis, budgets and automatic provider failover are not implemented.

## Verification

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run smoke  # explicitly submits a synthetic prompt to your configured local service
```

Tests use temporary local data and mocked model/TTS responses. They do not require a real provider key. Smoke tests can invoke your live model; run them only intentionally. Real provider behavior and browser/Agent end-to-end compatibility still require explicit acceptance testing.

## API highlights

| Route | Purpose |
| --- | --- |
| `GET /api/status` | Effective mode, selected models, policy, pause and counters |
| `GET /api/events` / `GET /api/knowledge` | Recent learning history / knowledge |
| `GET /api/stream` | SSE notifications |
| `POST /api/events` | Authenticated Agent capture (`X-Sidecar-Token`) |
| `GET/POST /api/settings` | Capture policy and pause |
| `GET/POST /api/models` | List masked configurations / create |
| `PATCH/DELETE /api/models/:id` | Edit / remove configuration |
| `POST /api/models/:id/active` | Select a model |
| `POST /api/tts` | On-demand speech proxy |
| `POST /api/events/:id/cancel` | Cancel queued or active analysis |
| `POST /api/events/:id/retry` | Retry failed or cancelled analysis |
| `DELETE /api/events/:id?knowledge=keep\|purge` | Delete card with explicit knowledge scope |

Local icons use [Lucide](https://lucide.dev/); see [icon licenses](LICENSE-ICONS.md).
