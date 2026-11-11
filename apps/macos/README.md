# English Sidecar · Native macOS

A separate, fully native **SwiftUI + AppKit** client in the same repository. There is **no WKWebView, Electron, or React renderer**. Existing Web code and server modules are unchanged. The native UI follows the Web's neutral palette, thin borders, vocabulary/syntax/discourse/example views and shared learning data.

The UI is native; the learning engine is still the existing Node + SQLite service. A packaged build may embed that engine/runtime, so an end user does not need Node or npm. This is not a Swift rewrite of the backend.

## Included

- Native learning list, search, four explanation tabs, correction cards, knowledge grid, retry and confirmed deletion.
- Native model management (text/speech), active-model selection, server connection settings and explicit login-start setting.
- A non-key AppKit floating learning island below the menu bar: hover preview, click to pin, copy/play/open lesson. Works without a physical notch, supports a selected external display, hides on screen sleep/session switch.
- Menu-bar entry points; closing the main window leaves the companion running. Quit stops only a child engine this app started.
- Shared native speech playback, cloud TTS when configured, system voice fallback, cancellation and stale-response protection.
- SSE reconnect + snapshot refresh, stable selection, local read state. No extra model calls for island summaries.
- Explicit, backed-up Hook installation for Codex, Cursor, Claude Code and Grok Build. Native helper needs no system Node, keeps Cursor's `continue:true` response and otherwise empty stdout, and bounds its entire lifetime to 450ms.

## Requirements / build

macOS 14+, Xcode command-line tools with Swift 5.9+. No third-party Swift packages.

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

## First run

1. Place the `.app` in a stable location such as `/Applications` **before** installing Hooks.
2. Connect to your existing service, or choose **Start built-in engine**. An occupied/non-Sidecar port is not overwritten or killed.
3. Configure a text model in Settings → Models. With the embedded engine, restart it after configuring the first key to switch Demo/Live status. Unconfigured native-owned analysis fails with a configuration message rather than generating fabricated demo results for real prompts.
4. Settings → Agent integration: choose agent and scope, review the confirmation, then install. Existing JSON is preserved and backed up. Trust the Hook in your Agent and send a real prompt to verify. Installation alone does not prove capture works.
5. Hover or pin the pill for quick access. Open full explanation for detail. Hide the island without pausing capture. **Pause capture ignores new input**, matching the existing server semantics.

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

On Linux, only `SidecarCore`, Hook and their tests build. A Linux pass does not validate SwiftUI/AppKit. Native compile/bundle checks run in macOS CI. Manual window behavior still needs checking on a real Mac:

- Keep typing in an editor while notifications arrive, hover expands and Play/Copy are clicked; input focus must stay in the editor.
- Open detail explicitly; keyboard focus should then move to the main window.
- Stop speech while its network request is pending; no late audio may begin.
- Close the main window, reconnect, unplug a monitor, sleep/wake, switch Spaces and test full screen/Stage Manager.
- Open two app instances, run alongside an existing service and occupy the port with a foreign listener; no other process may be killed.
- Verify Light/Dark appearance, long English/Chinese text, VoiceOver labels and reduced-motion preferences.
- Perform real-agent Hook and real-provider tests with the user's credentials. CI fixtures do not establish these integrations are live-validated.

## Layout

`Sources/SidecarCore` contains portable protocol/read-notification/Hook configuration logic. `Sources/SidecarDesktop` contains native scenes, views, services and island. `Sources/SidecarHook` is the native Agent adapter. `Resources` and `scripts` make the `.app`; `.github/workflows/macos-native.yml` adds independent CI. The implementation plan is in `docs/IMPLEMENTATION.md`.
