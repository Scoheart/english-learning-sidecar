import XCTest
import AppKit
import SwiftUI
import SidecarCore
@testable import SidecarDesktop

final class StudioRenderingTests: XCTestCase {
    @MainActor func testOpenWindowsFollowLiveAppearanceChanges() async throws {
        let app = NSApplication.shared
        guard !NSScreen.screens.isEmpty else { throw XCTSkip("Requires a WindowServer display") }
        let defaults = UserDefaults.standard
        let previousPreference = defaults.object(forKey: "native.appearance")
        let previousAppearance = app.appearance
        defer {
            defaults.set(previousPreference, forKey: "native.appearance")
            app.appearance = previousAppearance
        }

        for systemIsDark in [false, true] {
            // Set only the inherited system appearance, never window.appearance.
            app.appearance = NSAppearance(named: systemIsDark ? .darkAqua : .aqua)
            for startup in ["light", "dark"] {
                defaults.set(startup, forKey: "native.appearance")
                let store = DesktopStore()
                defer { store.api.close(); store.speech.stop() }
                let roots = [
                    AnyView(MainView(store: store).frame(width: 960, height: 640)),
                    AnyView(PreferencesView(store: store))
                ]
                let hosts = roots.map { NSHostingView(rootView: $0) }
                let windows = hosts.map { host in
                    let window = NSWindow(contentRect: NSRect(x: -10000, y: -10000, width: 960, height: 640), styleMask: [.titled], backing: .buffered, defer: false)
                    window.isReleasedWhenClosed = false
                    window.contentView = host
                    window.orderFront(nil)
                    return window
                }
                defer {
                    for window in windows {
                        window.orderOut(nil)
                        window.contentView = nil
                        window.close()
                    }
                }
                // Reuse both hosts throughout; rebuilding them conceals stale theme state.
                for selection in [startup, "dark", "light", "system", "dark", "system"] {
                    store.appearance = selection
                    try await Task.sleep(nanoseconds: 150_000_000)
                    let expectedDark = selection == "dark" || (selection == "system" && systemIsDark)
                    XCTAssertEqual(defaults.string(forKey: "native.appearance"), selection)
                    for host in hosts {
                        XCTAssertEqual(host.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]), expectedDark ? .darkAqua : .aqua)
                        if selection == "system" {
                            XCTAssertNil(host.window?.appearance, "System mode must clear the window override")
                        }
                        host.layoutSubtreeIfNeeded()
                        let bitmap = try XCTUnwrap(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                        host.cacheDisplay(in: host.bounds, to: bitmap)
                        // The left edge is the sidebar/stage canvas, not text or a control.
                        let pixel = try XCTUnwrap(bitmap.colorAt(x: 2, y: bitmap.pixelsHigh / 2)?.usingColorSpace(.sRGB))
                        let brightness = (pixel.redComponent + pixel.greenComponent + pixel.blueComponent) / 3
                        if expectedDark {
                            XCTAssertLessThan(brightness, 0.25, "Dark canvas for \(selection), startup \(startup)")
                        } else {
                            XCTAssertGreaterThan(brightness, 0.8, "Light canvas for \(selection), startup \(startup)")
                        }
                    }
                }
            }
        }
    }

    @MainActor func testWorkspaceRendersCleanOriginalAtNarrowAndWideSizes() async throws {
        _ = NSApplication.shared
        guard !NSScreen.screens.isEmpty else { throw XCTSkip("Requires a WindowServer display") }
        let defaults = UserDefaults.standard
        let keys = ["native.port", "native.read.65431", "native.history.agent", "native.appearance"]
        let saved = keys.map { defaults.object(forKey: $0) }
        defer { for (key, value) in zip(keys, saved) { defaults.set(value, forKey: key) } }
        defaults.set(65431, forKey: "native.port")
        defaults.set("", forKey: "native.history.agent")
        let store = DesktopStore()
        defer { store.api.close(); store.speech.stop() }
        store.connected = true
        store.status = try decode(Status.self, [
            "mode": "live", "model": "fixture", "paused": false,
            "stats": ["total": 2, "complete": 2, "pending": 0, "failed": 0, "knowledge": 3]
        ])
        let lesson = try fixtureLesson()
        store.lessons = [lesson, Lesson(id: "legacy", source: "cursor", content: "整理需求变动https://example.com/[REDACTED TOKEN]", status: "complete", createdAt: "2026-11-12T06:20:00Z")]
        store.selectedID = lesson.id
        XCTAssertEqual(store.selectedLesson?.originalDisplayTitle, "梳理需求，制定代码修改计划")
        XCTAssertFalse(store.lessons[1].originalDisplayTitle.contains("https"))

        for (name, size, appearance) in [
            ("desktop-wide-light", NSSize(width: 1260, height: 900), "light"),
            ("desktop-narrow-light", NSSize(width: 960, height: 800), "light"),
            ("desktop-wide-dark", NSSize(width: 1260, height: 900), "dark")
        ] {
            store.appearance = appearance
            let host = NSHostingView(rootView: MainView(store: store).frame(width: size.width, height: size.height))
            let window = NSWindow(contentRect: NSRect(origin: NSPoint(x: -10000, y: -10000), size: size), styleMask: [.borderless], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.appearance = NSAppearance(named: appearance == "dark" ? .darkAqua : .aqua)
            window.contentView = host
            host.setFrameSize(size)
            window.orderFront(nil)
            host.layoutSubtreeIfNeeded()
            // Allow SwiftUI's initial body and scroll layout to commit, without
            // contacting a service or activating/replacing the user's app.
            try await Task.sleep(nanoseconds: 120_000_000)
            host.layoutSubtreeIfNeeded()
            XCTAssertEqual(host.bounds.size.width, size.width, accuracy: 1)
            XCTAssertEqual(host.bounds.size.height, size.height, accuracy: 1)
            if let directory = ProcessInfo.processInfo.environment["SIDECAR_SNAPSHOT_DIR"] {
                let folder = URL(fileURLWithPath: directory, isDirectory: true).standardizedFileURL
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let bitmap = try XCTUnwrap(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                host.cacheDisplay(in: host.bounds, to: bitmap)
                let data = try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
                try data.write(to: folder.appendingPathComponent(name + ".png"))
            }
            window.orderOut(nil)
            window.contentView = nil
            window.close()
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, _ value: Any) throws -> T {
        try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: value))
    }

    private func fixtureLesson() throws -> Lesson {
        let example: [String: Any] = [
            "english": "Could you clarify the requirements before we make any changes?",
            "chinese": "在我们做任何修改之前，你能先澄清需求吗？",
            "note": "clarify 强调消除歧义；不是简单地把资料整理在一起。",
            "source": ["kind": "ai", "verification": "not_applicable"]
        ]
        let words: [[String: Any]] = [
            ["term": "clarify", "phonetic": "/ˈklærəfaɪ/", "pos": "v.", "meaning": "澄清；说明；使清楚",
             "morphology": "clar-（清楚）+ -ify（使……）；clarification 是对应名词。", "usage": "clarify the requirements",
             "nuance": "clarify 强调消除歧义；organize 强调整理和组织。",
             "senses": [["pos": "v.", "meaning": "解释清楚，使容易理解", "example": example]],
             "wordFamily": [["term": "clarification", "pos": "n.", "meaning": "澄清；说明", "relationship": "clarify 的名词形式", "example": example]],
             "synonyms": [["term": "explain", "pos": "v.", "meaning": "解释", "difference": "explain 侧重讲明原因或过程；clarify 侧重把含糊的地方说明白。", "example": example]],
             "antonyms": [], "examples": [example]],
            ["term": "requirement", "phonetic": "/rɪˈkwaɪərmənt/", "pos": "n.", "meaning": "要求；需求；必要条件",
             "morphology": "require（要求）+ -ment（名词后缀）。", "usage": "meet the requirements",
             "nuance": "requirement 常指明确、需要满足的条件；need 更宽泛。",
             "senses": [["pos": "n.", "meaning": "必须满足的要求或条件", "example": example]],
             "wordFamily": [["term": "require", "pos": "v.", "meaning": "要求；需要", "relationship": "基础动词"]],
             "synonyms": [], "antonyms": [], "examples": [example]]
        ]
        return try decode(Lesson.self, [
            "id": "desktop-preview", "source": "cursor", "status": "complete", "createdAt": "2026-11-12T06:25:00Z",
            "content": "https://example.com/[REDACTED TOKEN] 梳理需求，制定代码修改计划",
            "analysis": ["originalText": "梳理需求，制定代码修改计划", "translation": "Clarify the requirements and draw up a plan for the code changes.", "correctionStatus": "translated", "vocabulary": words,
                         "grammar": [["label": "并列祈使句", "explanation": "用 and 连接两个动作，表达清楚的行动要求。"]],
                         "examples": [example], "summary": "用 clarify the requirements 表达“理清需求”，用 draw up a plan 表达“制定计划”。"]
        ])
    }
}
