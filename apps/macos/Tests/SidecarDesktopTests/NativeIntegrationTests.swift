import XCTest
import AppKit
import SwiftUI
import DynamicNotchKit
import SidecarCore
@testable import SidecarDesktop

final class NativeIntegrationTests: XCTestCase {
    @MainActor func testPanelBridgePreservesContentAndNeverBecomesKey() async throws {
        _ = NSApplication.shared
        let original = NSPanel(contentRect: NSRect(x: 10, y: 10, width: 300, height: 200), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        let content = NSView(frame: original.frame)
        original.contentView = content
        let controller = NSWindowController(window: original)
        let panel = try XCTUnwrap(IslandPanelBridge.nonactivating(controller))
        defer { panel.close() }
        XCTAssertFalse(panel.canBecomeKey)
        XCTAssertFalse(panel.canBecomeMain)
        XCTAssertTrue(panel.contentView === content)
        XCTAssertTrue(IslandPanelBridge.nonactivating(controller) === panel)
        XCTAssertEqual(panel.level, .statusBar)
    }

    @MainActor func testRealDynamicNotchKitWindowSurvivesNativePanelBridge() async throws {
        _ = NSApplication.shared
        guard let screen = NSScreen.screens.first else { throw XCTSkip("Requires a WindowServer display") }
        let notch = DynamicNotch(hoverBehavior: [], style: .notch, expanded: { Text("English Sidecar").frame(width: 330) }, compactLeading: { Text("EN") }, compactTrailing: { Text("1") })
        await notch.compact(on: screen)
        let controller = try XCTUnwrap(notch.windowController)
        let panel = try XCTUnwrap(IslandPanelBridge.nonactivating(controller))
        XCTAssertTrue(panel.isVisible)
        XCTAssertFalse(panel.canBecomeKey)
        await notch.expand(on: screen)
        XCTAssertTrue(notch.windowController?.window === panel)
        XCTAssertTrue(panel.isVisible)
        await notch.hide()
        XCTAssertNil(notch.windowController)
    }

    @MainActor func testStoreFiltersAndIslandDeepLinkStayConsistent() async throws {
        let defaults = UserDefaults.standard
        let keys = ["native.history.agent", "native.read.4317", "native.port"]
        let previous = keys.map { defaults.object(forKey: $0) }
        defer { for (key, value) in zip(keys, previous) { defaults.set(value, forKey: key) } }
        defaults.set(4317, forKey: "native.port")
        let store = DesktopStore()
        defer { store.api.close() }
        store.clearHistoryFilters()
        store.lessons = [
            Lesson(id: "codex-1", source: "codex", content: "请帮我下载", status: "complete", createdAt: ""),
            Lesson(id: "pi-1", source: "pi", content: "按钮颜色", status: "complete", createdAt: "")
        ]
        store.selectedID = "codex-1"
        store.historyAgent = "pi"
        XCTAssertEqual(store.selectedLesson?.id, "pi-1")
        store.historyQuery = "不存在"
        XCTAssertNil(store.selectedLesson)
        var revealed = false
        store.revealMain = { revealed = true }
        store.openLesson("codex-1")
        XCTAssertTrue(revealed)
        XCTAssertEqual(store.historyAgent, "")
        XCTAssertEqual(store.historyQuery, "")
        XCTAssertEqual(store.selectedLesson?.content, "请帮我下载")
    }
}
