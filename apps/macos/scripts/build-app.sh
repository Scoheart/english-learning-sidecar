#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
[[ "$(uname -s)" == Darwin ]] || { echo "Build the macOS app on macOS 14+ with Xcode command-line tools (Swift 6+)." >&2; exit 1; }
BUNDLE=0
if [[ "${1:-}" == --bundle-engine ]]; then BUNDLE=1
elif [[ -n "${1:-}" ]]; then echo "Usage: bash scripts/build-app.sh [--bundle-engine]" >&2; exit 1; fi
swift build --package-path "$HERE" -c release
BIN="$(swift build --package-path "$HERE" -c release --show-bin-path)"
APP="$HERE/dist/English Sidecar.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN/EnglishSidecar" "$APP/Contents/MacOS/EnglishSidecar"
cp "$BIN/SidecarHook" "$APP/Contents/MacOS/SidecarHook"
cp "$HERE/Resources/Info.plist" "$APP/Contents/Info.plist"
cp "$HERE/Resources/DynamicNotchKit-LICENSE" "$APP/Contents/Resources/DynamicNotchKit-LICENSE"
if [[ "$BUNDLE" == 1 ]]; then
  NODE="${NODE_BINARY:-$(command -v node || true)}"
  [[ -x "$NODE" ]] || { echo "Node >=22.13 is needed on the build machine to bundle the existing engine." >&2; exit 1; }
  "$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<13))process.exit(1);require("node:sqlite")'
  ENGINE="$APP/Contents/Resources/engine"
  mkdir -p "$ENGINE/runtime" "$ENGINE/src"
  cp "$NODE" "$ENGINE/runtime/node"
  cp -R "$ROOT/src/lib" "$ROOT/src/public" "$ENGINE/src/"
  cp "$HERE/Resources/engine-entry.mjs" "$ENGINE/engine-entry.mjs"
  printf '{"type":"module"}\n' > "$ENGINE/package.json"
  # Distribute the upstream Node license with the embedded runtime.
  if [[ -f "$(dirname "$NODE")/../LICENSE" ]]; then cp "$(dirname "$NODE")/../LICENSE" "$ENGINE/NODE-LICENSE"
  else curl -fLsS "https://raw.githubusercontent.com/nodejs/node/v$("$NODE" -p process.versions.node)/LICENSE" -o "$ENGINE/NODE-LICENSE"; fi
  # Prefer the official standalone Node distribution; Homebrew dylib dependencies
  # are rejected rather than shipping an app that only runs on the build machine.
  if otool -L "$NODE" | tail -n +2 | grep -Ev '^[[:space:]]*(/usr/lib/|/System/Library/|@executable_path/)' | grep -q .; then
    echo "Node has non-system dylib dependencies. Use an official standalone Node binary via NODE_BINARY." >&2; exit 1
  fi
  codesign --force --sign - "$ENGINE/runtime/node"
fi
codesign --force --sign - "$APP/Contents/MacOS/SidecarHook"
codesign --force --sign - "$APP"
codesign --verify --deep --strict "$APP"
/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$APP/Contents/Info.plist"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$HERE/dist/EnglishSidecar-$(uname -m).zip"
echo "Built: $APP"
echo "Ad-hoc signed local build; NOT Developer-ID signed or notarized."
