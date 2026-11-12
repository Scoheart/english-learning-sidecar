# AGENTS.md

The Node engine and model settings APIs live in `src/lib/`, the React source in `src/web/`, and the native client in `apps/macos/`. Update source files and regenerate the tracked web bundle with `npm run build`.

Run `npm ci`, `npm test`, `npm run typecheck` and `npm run build` for engine or Web changes. For desktop changes, also run `swift test --package-path apps/macos`. Changes to the bundled engine should be checked with the packaging and smoke commands in the native workflow. Use temporary data directories and fixture credentials when verifying changes.
