import XCTest
@testable import SidecarCore

final class HistoryAndIslandTests: XCTestCase {
    private func lesson(_ id: String = "1", source: String = "codex", content: String = "请帮我下载", translation: String? = "Please help me download this.") -> Lesson {
        var analysis = LessonAnalysis(); analysis.translation = translation
        return Lesson(id: id, source: source, content: content, status: "complete", createdAt: "2026-11-11T10:00:00Z", analysis: analysis)
    }
    func testOriginalTextNeverUsesTranslation() {
        XCTAssertEqual(LessonHistory.originalText(lesson()), "请帮我下载")
    }
    func testOriginalTextPreservesWhitespaceMarkdownAndEmptyInput() {
        XCTAssertEqual(LessonHistory.originalText(lesson(content: " **原文**\n第二行 ")), " **原文**\n第二行 ")
        XCTAssertEqual(LessonHistory.originalText(lesson(content: "")), "")
    }
    func testSourcesAreDerivedCountedAndCaseNormalized() {
        let options = LessonHistory.agents(in: [lesson("1"), lesson("2", source: " Codex "), lesson("3", source: "pi")])
        XCTAssertEqual(options.map(\.id), ["codex", "pi"])
        XCTAssertEqual(options.map(\.count), [2, 1])
        XCTAssertEqual(options.map(\.name), ["Codex", "Pi"])
    }
    func testUnknownSourceIsNotDroppedOrRenamedToKnownAgent() {
        let options = LessonHistory.agents(in: [lesson(source: "NewAgent")])
        XCTAssertEqual(options.first?.id, "newagent")
        XCTAssertEqual(options.first?.name, "NewAgent")
    }
    func testBlankSourceDoesNotCollideWithAllAgents() {
        XCTAssertFalse(LessonHistory.sourceID(" ").isEmpty)
        XCTAssertEqual(LessonHistory.agents(in: [lesson(source: " ")]).first?.name, "未知 Agent")
    }
    func testAgentFilterAndSearchIntersectAndKeepOrder() {
        let rows = [lesson("1", source: "pi", content: "按钮颜色"), lesson("2", source: "codex", content: "按钮颜色"), lesson("3", source: "pi", content: "登录页面")]
        XCTAssertEqual(LessonHistory.matching(rows, agent: "pi", query: "按钮").map(\.id), ["1"])
        XCTAssertEqual(LessonHistory.matching(rows, agent: "", query: "").map(\.id), ["1", "2", "3"])
    }
    func testSearchAlsoMatchesTranslationAndSourceName() {
        XCTAssertEqual(LessonHistory.matching([lesson()], agent: "codex", query: "DOWNLOAD").count, 1)
        XCTAssertEqual(LessonHistory.matching([lesson(source: "claude")], agent: "", query: "Claude Code").count, 1)
        XCTAssertEqual(LessonHistory.matching([lesson()], agent: "", query: "  \n ").count, 1)
    }
    func testMissingSourceProducesEmptyResultNotAllRecords() {
        XCTAssertTrue(LessonHistory.matching([lesson()], agent: "pi", query: "").isEmpty)
    }
    func testSelectionRetainsVisibleAndNeverPointsOutsideFilter() {
        let visible = [lesson("2", source: "pi"), lesson("3", source: "pi")]
        XCTAssertEqual(LessonHistory.selection("3", in: visible), "3")
        XCTAssertEqual(LessonHistory.selection("1", in: visible), "2")
        XCTAssertNil(LessonHistory.selection("1", in: []))
        XCTAssertNil(LessonHistory.selection(nil, in: visible))
    }
    func testDeepLinkOnlyClearsConflictingFilters() {
        let rows = [lesson("1"), lesson("2", source: "pi")]
        XCTAssertTrue(LessonHistory.needsFilterReset(for: "1", lessons: rows, agent: "pi", query: ""))
        XCTAssertFalse(LessonHistory.needsFilterReset(for: "2", lessons: rows, agent: "pi", query: ""))
        XCTAssertTrue(LessonHistory.needsFilterReset(for: "2", lessons: rows, agent: "pi", query: "not found"))
        XCTAssertFalse(LessonHistory.needsFilterReset(for: "missing", lessons: rows, agent: "pi", query: ""))
    }
    func testDefaultPresentationIsTopAttachedEvenWithoutHardwareNotch() {
        XCTAssertEqual(IslandPresentationMode.stored(nil), .notch)
        XCTAssertEqual(IslandPresentationMode.stored("invalid"), .notch)
        XCTAssertFalse(IslandPresentationMode.notch.isFloating(hasHardwareNotch: false))
    }
    func testAutomaticAndExplicitPresentationModes() {
        XCTAssertFalse(IslandPresentationMode.automatic.isFloating(hasHardwareNotch: true))
        XCTAssertTrue(IslandPresentationMode.automatic.isFloating(hasHardwareNotch: false))
        XCTAssertTrue(IslandPresentationMode.floating.isFloating(hasHardwareNotch: true))
    }
    func testFloatingCompactNeverCallsLibraryCompactThatWouldHideIt() {
        XCTAssertEqual(IslandPresentationMode.floating.command(visible: true, expanded: false, hasHardwareNotch: false), .expand)
        XCTAssertEqual(IslandPresentationMode.notch.command(visible: true, expanded: false, hasHardwareNotch: false), .compact)
        XCTAssertEqual(IslandPresentationMode.notch.command(visible: true, expanded: true, hasHardwareNotch: true), .expand)
    }
    func testHiddenAlwaysWinsOverPresentationMode() {
        for mode in IslandPresentationMode.allCases {
            XCTAssertEqual(mode.command(visible: false, expanded: true, hasHardwareNotch: true), .hide)
        }
    }
    func testHoverPinAndUnpinState() {
        var state = IslandInteraction()
        state.hover(true)
        XCTAssertTrue(state.expanded)
        state.togglePin()
        state.hover(false)
        XCTAssertTrue(state.expanded)
        XCTAssertTrue(state.pinned)
        state.togglePin()
        XCTAssertFalse(state.expanded)
    }
    func testHideResetsPinnedStateAndDoesNotStopCollection() {
        var state = IslandInteraction()
        state.togglePin(); state.hide()
        XCTAssertFalse(state.expanded)
        XCTAssertFalse(state.pinned)
        XCTAssertFalse(state.hovering)
    }
}
