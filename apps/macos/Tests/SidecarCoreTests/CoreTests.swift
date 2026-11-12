import XCTest
@testable import SidecarCore

final class CoreTests: XCTestCase {
    func testLoopbackEndpointAndPortValidation() throws {
        XCTAssertEqual(try Endpoint(port: 4317).baseURL.absoluteString, "http://127.0.0.1:4317")
        XCTAssertThrowsError(try Endpoint(port: 0))
        XCTAssertThrowsError(try Endpoint(port: 65536))
    }
    func testDecodeActualServerShape() throws {
        let json = #"{"events":[{"id":"a","source":"grok","content":"分析需求","status":"complete","createdAt":"2026-11-11T09:00:00.000Z","analysis":{"translation":"Analyze the requirements.","vocabulary":[{"term":"requirement","meaning":"需求"}],"grammar":[],"examples":[]}}]}"#
        let result = try JSONDecoder().decode(EventList.self, from: Data(json.utf8))
        XCTAssertEqual(result.events.first?.sourceName, "Grok Build")
        XCTAssertEqual(result.events.first?.preview.english, "Analyze the requirements.")
        XCTAssertEqual(result.events.first?.preview.term, "requirement")
    }
    func testStatusDecodesWithLiveOnlyEngine() throws {
        let payload = #"{"mode":"unconfigured","model":"gpt-4o-mini","paused":false,"configurationMessage":"请先接入模型","capturePolicy":{"mode":"allowlist","allowedProjects":["/tmp/a"],"excludedProjects":[]},"stats":{"total":0,"complete":0,"pending":0,"failed":0,"knowledge":0}}"#
        let status = try JSONDecoder().decode(Status.self, from: Data(payload.utf8))
        XCTAssertEqual(status.mode, "unconfigured")
        XCTAssertEqual(status.capturePolicy?.mode, "allowlist")
        XCTAssertEqual(status.capturePolicy?.allowedProjects, ["/tmp/a"])
    }
    func testDecodeRichStudioAnalysisShape() throws {
        let json = #"""
        {
          "id": "rich-1",
          "source": "claude",
          "content": "优化桌面端界面以呼应 Web 端风格",
          "status": "complete",
          "createdAt": "2026-11-12T08:00:00.000Z",
          "analysis": {
            "translation": "Refine the desktop UI to echo the web studio aesthetic.",
            "correctionStatus": "natural_but_improvable",
            "corrections": [
              {"kind": "style", "before": "make UI better", "after": "refine the desktop UI", "reason": "More idiomatic engineering register."}
            ],
            "vocabulary": [
              {
                "term": "aesthetic",
                "phonetic": "/esˈθetɪk/",
                "pos": "n.",
                "meaning": "美学风格；审美特质",
                "morphology": "来自希腊语 aisthetikos（感知的）",
                "usage": "studio aesthetic / visual aesthetic",
                "nuance": "侧重整体协调的视觉格调",
                "senses": [{"pos": "adj.", "meaning": "审美的；美学的", "example": {"english": "An aesthetic appeal.", "chinese": "审美吸引力。", "source": {"kind": "ai"}}}],
                "wordFamily": [{"term": "aesthetically", "pos": "adv.", "meaning": "在审美上", "relationship": "副词派生"}],
                "synonyms": [{"term": "style", "pos": "n.", "meaning": "风格", "difference": "style 更通用，aesthetic 强调审美体系"}],
                "antonyms": []
              }
            ],
            "examples": [
              {"english": "The native client echoes the web app's typography.", "chinese": "原生客户端呼应了网页端的排版风格。", "note": "echo 作动词表示呼应", "source": {"kind": "reference", "title": "Design System Guide", "url": "https://example.com/design"}}
            ]
          }
        }
        """#
        let lesson = try JSONDecoder().decode(Lesson.self, from: Data(json.utf8))
        XCTAssertEqual(lesson.analysis?.correctionStatus, "natural_but_improvable")
        XCTAssertEqual(lesson.analysis?.corrections?.first?.kind, "style")
        XCTAssertEqual(lesson.analysis?.vocabulary?.first?.senses?.first?.pos, "adj.")
        XCTAssertEqual(lesson.analysis?.vocabulary?.first?.wordFamily?.first?.term, "aesthetically")
        XCTAssertEqual(lesson.analysis?.vocabulary?.first?.synonyms?.first?.difference, "style 更通用，aesthetic 强调审美体系")
        XCTAssertEqual(lesson.analysis?.examples?.first?.source?.title, "Design System Guide")
    }
    func testPartialAnalysisIsBackwardCompatible() throws {
        let item = try JSONDecoder().decode(Lesson.self, from: Data(#"{"id":"a","source":"pi","content":"x","status":"processing","createdAt":"bad-date","analysis":null}"#.utf8))
        XCTAssertNil(item.date)
        XCTAssertEqual(item.status, "processing")
        XCTAssertTrue(item.preview.english.isEmpty)
    }
    func testEmptyTranslationNeverInventsEnglish() throws {
        let item = try JSONDecoder().decode(Lesson.self, from: Data(#"{"id":"a","source":"manual","content":"中文","status":"complete","createdAt":"","analysis":{}}"#.utf8))
        XCTAssertEqual(item.preview.english, "")
    }
    func testNotificationsBaselineAndTransition() {
        var tracker = CompletionTracker()
        XCTAssertEqual(tracker.observe([lesson("old", "complete"), lesson("new", "processing")]), [])
        XCTAssertEqual(tracker.observe([lesson("old", "complete"), lesson("new", "complete")]), ["new"])
        XCTAssertEqual(tracker.observe([lesson("new", "complete")]), [])
    }
    func testConnectionResetDoesNotReplayHistory() {
        var tracker = CompletionTracker()
        _ = tracker.observe([lesson("a", "complete")])
        tracker.reset()
        XCTAssertEqual(tracker.observe([lesson("b", "complete")]), [])
    }
    func testSSEIgnoresHeartbeatAndDispatchesOnlyAtBoundary() {
        var parser = SSEParser()
        XCTAssertFalse(parser.feed(": keepalive"))
        XCTAssertFalse(parser.feed(""))
        XCTAssertFalse(parser.feed("event: update"))
        XCTAssertFalse(parser.feed("data: {\"time\":\"now\"}"))
        XCTAssertTrue(parser.feed(""))
        XCTAssertFalse(parser.feed(""))
    }
    func testShellQuoteHandlesSpacesAndApostrophes() {
        XCTAssertEqual(shellQuote("/Applications/Sidecar.app/a"), "'/Applications/Sidecar.app/a'")
        XCTAssertEqual(shellQuote("a'b"), "'a'\\''b'")
    }
    func testHookMergePreservesOtherSettingsAndIsIdempotent() throws {
        let input = Data(#"{"permissions":{"allow":["Read"]},"hooks":{"UserPromptSubmit":[{"hooks":[{"command":"echo original","type":"command"}]}]}}"#.utf8)
        let output = try HookConfiguration.merge(existing: input, agent: "claude", executable: "/A B/SidecarHook")
        let again = try HookConfiguration.merge(existing: output, agent: "claude", executable: "/A B/SidecarHook")
        let json = try JSONSerialization.jsonObject(with: again) as! [String: Any]
        XCTAssertNotNil(json["permissions"])
        let hooks = json["hooks"] as! [String: Any]
        XCTAssertEqual((hooks["UserPromptSubmit"] as! [Any]).count, 2)
    }
    func testCursorAndGrokHookContracts() throws {
        for agent in ["cursor", "grok"] {
            let data = try HookConfiguration.merge(existing: nil, agent: agent, executable: "/app/SidecarHook")
            let object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
            let hooks = object["hooks"] as! [String: Any]
            XCTAssertNotNil(hooks[agent == "cursor" ? "beforeSubmitPrompt" : "UserPromptSubmit"])
            if agent == "cursor" { XCTAssertEqual(object["version"] as? Int, 1) }
        }
    }
    func testMalformedHookFileIsNeverOverwritten() {
        XCTAssertThrowsError(try HookConfiguration.merge(existing: Data("not json".utf8), agent: "codex", executable: "/app/SidecarHook"))
        XCTAssertThrowsError(try HookConfiguration.merge(existing: Data(#"{"hooks":"bad"}"#.utf8), agent: "codex", executable: "/app/SidecarHook"))
    }
    func testAPIRequestCannotEscapeLoopback() throws {
        let api = try SidecarAPI(port: 4317)
        defer { api.close() }
        XCTAssertThrowsError(try api.request("https://example.com"))
        XCTAssertThrowsError(try api.request("//example.com/api/status"))
        XCTAssertThrowsError(try api.request("/api/../secret"))
        let req = try api.request("/api/settings", method: "POST", body: ["paused": true])
        XCTAssertEqual(req.url?.host, "127.0.0.1")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(req.httpMethod, "POST")
    }
    func testUnknownSSEEventDoesNotRefresh() {
        var parser = SSEParser()
        _ = parser.feed("event: something-else")
        _ = parser.feed("data: {}")
        XCTAssertFalse(parser.feed(""))
    }
    func testInvalidAgentAndPortAreRejected() {
        XCTAssertThrowsError(try HookConfiguration.merge(existing: nil, agent: "unknown", executable: "/app"))
        XCTAssertThrowsError(try HookConfiguration.merge(existing: nil, agent: "codex", executable: "/app", port: -1))
        XCTAssertThrowsError(try HookConfiguration.merge(existing: nil, agent: "codex", executable: "/app\ncommand"))
    }
    private func lesson(_ id: String, _ status: String) -> Lesson {
        Lesson(id: id, source: "codex", content: "test", status: status, createdAt: "")
    }
}
