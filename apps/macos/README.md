# English Sidecar · Native macOS

A separate, fully native **SwiftUI + AppKit** client in the same repository. There is **no WKWebView, Electron, or React renderer**. Existing Web code and server modules are unchanged. The native UI follows the Web's neutral palette, thin borders, vocabulary/syntax/discourse/example views and shared learning data.

The UI is native; the learning engine is still the existing Node + SQLite service. A packaged build may embed that engine/runtime, so an end user does not need Node or npm. This is not a Swift rewrite of the backend.

## Included

- Native learning history shows captured original text and source Agent, never substitutes the generated translation. Source filtering combines with search; counts and filtering apply to the loaded latest 150 records. Translation remains in lesson detail.
- Four explanation tabs, correction cards, knowledge grid, retry and confirmed deletion.
- Native model management (text/speech), active-model selection, server connection settings and explicit login-start setting.
- **DynamicNotchKit** renders the learning island. Default: top-attached notch; settings also offer automatic screen detection and floating presentation. Hover preview, click to pin, copy/play/open lesson, non-key panel, selected display, sleep/session hiding and reduced-motion handling are included.
- Non-notched displays retain a compact entry even when the menu bar auto-hides; floating mode uses a small content view instead of the library's hiding `compact()` operation.
- Menu-bar entry points; closing the main window leaves the companion running. Quit stops only a child engine this app started.
- Shared native speech playback, cloud TTS when configured, system voice fallback, cancellation and stale-response protection.
- SSE reconnect + snapshot refresh, stable selection, local read state. Opening a lesson from the island clears conflicting history filters. No extra model calls for island summaries.
- Explicit, backed-up Hook installation for Codex, Cursor, Claude Code and Grok Build. Native helper needs no system Node, keeps Cursor's `continue:true` response and otherwise empty stdout, and bounds its entire lifetime to 450ms.

## Requirements / build

macOS 14+, Xcode command-line tools with **Swift 6+**. The native target uses DynamicNotchKit pinned to revision `cd0b3e52d537db115ad3a9d89601f20e0bee8d27`; its MIT license is included in the app bundle. A first build needs network access to resolve that dependency. Portable Core/Hook builds do not fetch the macOS-only package on Linux.

From repository root:

```sh
swift test --package-path apps/macos
bash apps/macos/scripts/build-app.sh
open 'apps/macos/dist/English Sidecar.app'
```

This lean build connects to an existing service at `http://127.0.0.1:4317` (`npm start` in the repository). To embed the engine as well:

```sh
# Build machine only: official standalone Node >=22.13, with node:sqlite.
NODE_BINARY="$(command -v node)" bash apps/macos/scripts/build-app.sh --bundle-engine
open 'apps/macos/dist/English Sidecar.app'
```

Use an official standalone Node distribution rather than a Homebrew binary with external dylibs. The script rejects non-system dylib dependencies and includes the Node license. The ZIP's architecture matches the build machine; this is not a universal binary.

GitHub Actions **Native macOS** builds/tests on macOS and uploads the self-contained ZIP under its **Artifacts** section. Artifacts are retained for 14 days. These are **ad-hoc signed development builds**, not notarized public releases. Gatekeeper may block distribution; production release requires the owner's Developer ID signing/notarization setup. Do not disable system protections globally.

## First run / upgrade

1. Quit the old app before replacing it. Place the new `.app` at the SAME stable location such as `/Applications` before using existing Hooks. Moving the app requires reinstalling Hooks; running both copies is not supported.
2. Connect to your existing service, or choose **Start built-in engine**. An occupied/non-Sidecar port is not overwritten or killed.
3. Configure a text model in Settings → Models. With the embedded engine, restart it after configuring the first key to switch Demo/Live status. Unconfigured native-owned analysis fails with a configuration message rather than generating fabricated demo results for real prompts.
4. Settings → Agent integration: choose agent and scope, review the confirmation, then install. Existing JSON is preserved and backed up. Trust the Hook in your Agent and send a real prompt to verify. Installation alone does not prove capture works.
5. Settings → General → Island style: choose top-attached notch, automatic detection, or floating. Hover or pin for quick access; open full explanation for detail. Hide the island without pausing capture. **Pause capture ignores new input**, matching the existing server semantics.
6. In learning history, select the source Agent menu above the list. Search intersects with that filter; clear filters from the empty state when needed. Right-click a record to copy its original text.

The source text is the collector's already-redacted `content`. Existing machine-generated requests are not deleted or classified by this display change.

## Shared data and security boundaries

The default data directory remains `~/.english-sidecar`. The engine owns the SQLite database and model configuration. Native read markers/preferences are local UserDefaults only; they do not sync back to the Web. No automatic data migration or new screen/keyboard capture permission is requested.

The legacy backend uses loopback + Host/Origin checks and a token on event ingestion, but not independent auth on every control endpoint. This release does **not** turn it into a remotely accessible server. The native client restricts connections to `127.0.0.1` and refuses redirects. API keys remain in the engine's permission-protected `models.json`; they are **not Keychain-encrypted** by this release. Never expose the service to a network.

The desktop-only `engine-entry.mjs` reserves the port before opening SQLite, uses a native-engine lock, resolves each model/key pair together and does not load an arbitrary source checkout's `.env`. Existing externally started engines retain their original behavior. Do not start another legacy engine against the same data directory on a different port.

No event replay endpoint is added: reconnect fetches the latest 150 lessons. Old completions outside that window may not produce island notifications. Initial history does not replay as new notifications. Read count is within the loaded window, not a lifetime unread metric. The full backend still holds its own history.

## Development / verification

```sh
swift test --package-path apps/macos
swift build --package-path apps/macos
python3 apps/macos/scripts/test-hook.py "$(swift build --package-path apps/macos --show-bin-path)/SidecarHook"
```

On Linux, only `SidecarCore`, Hook and their tests build. A Linux pass does not validate SwiftUI/AppKit. Native compile/bundle checks and real DynamicNotchKit integration tests run in macOS CI. Manual window behavior still needs checking on a real Mac:

- Keep typing in an editor while notifications arrive, hover expands and Play/Copy are clicked; input focus must stay in the editor.
- Open detail explicitly; keyboard focus should then move to the main window, clearing conflicting filters only.
- Verify top-attached curves, physical camera clearance, floating compact visibility, menu-bar auto-hide, hit regions and rapid hover/style changes.
- Stop speech while its network request is pending; no late audio may begin.
- Close the main window, reconnect, unplug a monitor, sleep/wake, switch Spaces and test full screen/Stage Manager.
- Open two app instances, run alongside an existing service and occupy the port with a foreign listener; no other process may be killed.
- Verify Light/Dark appearance, long original Chinese/English text, Agent-filter counts, VoiceOver labels and reduced-motion preferences.
- Perform real-agent Hook and real-provider tests with the user's credentials. CI fixtures do not establish these integrations are live-validated.

## Layout

`Sources/SidecarCore` contains portable protocol/history/presentation/Hook logic. `Sources/SidecarDesktop` contains native scenes, views, services, the DynamicNotchKit adapter and non-key panel bridge. `Sources/SidecarHook` is the native Agent adapter. `Resources` and `scripts` make the `.app`; `.github/workflows/macos-native.yml` adds independent CI. See `docs/IMPLEMENTATION.md` and `docs/NOTCH_AND_FILTERS.md` for design boundaries.
