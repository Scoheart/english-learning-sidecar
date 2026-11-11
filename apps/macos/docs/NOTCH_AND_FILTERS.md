# Native notch integration and original-text history

Base: `afd4d89b8b0fe2ccf0759c7d925c490ef3926e7a`.

## Scope and design

Use the actual DynamicNotchKit package at revision
`cd0b3e52d537db115ad3a9d89601f20e0bee8d27`, not a look-alike rounded card.
The desktop default is top-attached `.notch`; settings also offer automatic
hardware detection and floating presentation. Keep camera safe areas and
use the library's shape/animation. Floating compact presentation uses a
small expanded-content view, because upstream `compact()` hides floating
windows. The adapter owns hover/pin/sleep/display lifecycles and installs a
non-key panel via the library's public windowController.

History always renders the captured `Lesson.content` (already redacted by
the collector), plus the source Agent. Translation remains in lesson detail.
Agent choices are derived from the loaded snapshot, include unknown sources,
and filter together with free-text search. Keep valid selection, never show
an out-of-filter lesson. Explicitly opening a lesson from the island clears
only conflicting filters. Do not change Web, backend, hooks or stored data.

## Implementation plan

- [x] Add failing Core tests for original text, source grouping, intersected
  search, selection, presentation modes and floating compact behavior.
- [x] Implement pure history and island policy helpers; 16 new tests pass locally.
- [x] Bind the native list to original content and source filtering; add
  counts, clear-filter empty state and deep-link selection handling.
- [x] Integrate pinned DynamicNotchKit, hover/pin lifecycle, presentation
  settings, transparent-region hit testing and reduced-motion handling.
- [x] Include upstream license in app bundle; bump native version to 0.2.0.
- [ ] Verify macOS build/test/package CI, review changed paths, then merge
  through a PR and retrieve the new Apple Silicon app ZIP.

## Build and verification

The upstream package requires Swift 6+, while the app deployment target remains
macOS 14. Core tests and the Hook helper still build on Linux without fetching
macOS-only dependencies. New macOS integration tests exercise the real upstream
notch window, non-key panel bridge and store/filter/deep-link consistency.

## Update

Quit the old app, replace it at the SAME installed path and relaunch. Do not run
both copies. Existing learning data and model configuration are unchanged.
Settings > General > Island style defaults to top-attached; automatic chooses
floating on displays without a notch. History's Agent counts refer to the
currently loaded maximum 150 records, not an unlimited database-wide search.
Changing displayed text does not retroactively remove app-generated prompts
already captured by an Agent Hook; provenance filtering is a separate issue.

## Manual acceptance

Verify top-attached corners, real camera clearance, floating compact state,
rapid hover/mode changes, input focus, click-through outside the island,
external-monitor unplug, Spaces/fullscreen and sleep/wake on real hardware.
CI compilation and noninteractive tests do not prove all these behaviors.
