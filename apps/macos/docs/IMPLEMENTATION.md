# Native macOS client implementation

Base: Scoheart/english-learning-sidecar main 627b18a5604d56ef007f88f1415948ff19f13142.

## Design
Create an additive `apps/macos` Swift package. No WebView, React renderer, Electron, or changes to existing web/server files. SwiftUI provides native navigation, lessons, knowledge and preferences. AppKit owns only the non-key floating island. Shared Node service remains the learning engine; this is a native client, not a Swift rewrite of the model engine.

A local service can be connected without starting another engine. Distributable bundles include a pinned-compatible Node executable and a copy of the current engine; start is explicit. Stop only a process the app started. The native hook helper has a bounded lifetime, never returns a lesson to the agent, and requires no system Node. Existing hooks are modified only through explicit installation with backup.

Native read state is presentation-only, local to this client; backend remains the owner of lessons and knowledge. SSE reconnect fetches a fresh snapshot; the legacy backend has no replay cursor, so do not promise lossless notifications outside the latest 150 rows. New results never replace a selected lesson. One speech controller prevents overlapping windows/audio and cancels stale responses.

Style follows the current Web's neutral palette, thin borders and modest rounding, using adaptive system colors and SF Symbols. Island starts as a floating pill below the menu bar, including on non-notched external displays; it does not paint over the hardware notch or claim to be a system Dynamic Island.

## Plan
- [ ] Add fixture-first protocol, preview/read-state and endpoint tests; run red then green.
- [ ] Implement native API client, constrained loopback requests and bounded Hook helper.
- [ ] Implement shared store, speech, explicit engine lifecycle and safe hook installer.
- [ ] Implement native main window, detail tabs, knowledge and settings.
- [ ] Add island, menu entry points, sleep/display handling and keyboard actions.
- [ ] Add macOS build/test/bundle CI and document packaging, limitations and manual acceptance tests.
- [ ] Verify additive-only diff, create PR; merge only after checks pass.

## Constraints and review focus
macOS 14+, Swift 5.9+, engine Node 22.13+. No external Swift dependencies. No new model calls to populate island. No automatic model-key migration. Existing engine credentials remain in its 0600 models.json; not encrypted by this release. No automatic login/Hook permission changes. Packaged app is ad-hoc signed until owner supplies Developer ID/notarization credentials.

Review malformed model data, URL redirects, port occupied by unrelated service, reconnect notification duplication, stop-before-TTS-response, closing main window, multiple displays, spaces/fullscreen and engine process ownership. Linux tests cover core logic only; AppKit/SwiftUI compilation and native behavior require macOS validation.
