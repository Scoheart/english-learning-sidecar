import XCTest
@testable import SidecarCore

final class OriginalTextTests: XCTestCase {
    private func lesson(content: String, original: String? = nil, source: String = "codex", translation: String? = nil) -> Lesson {
        var analysis = LessonAnalysis()
        analysis.originalText = original
        analysis.translation = translation
        return Lesson(id: "original-1", source: source, content: content, status: "complete", createdAt: "", analysis: analysis)
    }

    private func assertCleanup(_ cases: [(String, String)], file: StaticString = #filePath, line: UInt = #line) {
        for (input, expected) in cases {
            XCTAssertEqual(OriginalText.clean(input), expected, "Input: \(input)", file: file, line: line)
        }
    }

    func testScreenshotPartiallyRedactedURLAtEndAndBeginning() {
        assertCleanup([
            ("整理需求变动https://rqqmslsz9y.feishu.[REDACTED TOKEN]", "整理需求变动"),
            ("整理需求变动https://rqqmslsz9y.feishu.[REDACTED TOKEN]，然后确认范围。", "整理需求变动，然后确认范围。"),
            ("整理需求变动https://rqqmslsz9y.feishu.[REDACTED TOKEN]/wiki/[REDACTED TOKEN]", "整理需求变动"),
            ("https://rqqmslsz9y.feishu.[REDACTED TOKEN]/wiki/[REDACTED TOKEN]整理需求变动", "整理需求变动"),
            ("https://rqqmslsz9y.feishu.[REDACTED TOKEN] 整理需求变动 https://example.com/private", "整理需求变动")
        ])
    }

    func testURLsDoNotEatAdjacentChineseProseOrPunctuation() {
        assertCleanup([
            ("请看https://example.com/path然后继续。", "请看然后继续。"),
            ("请看www.example.com/path，然后继续。", "请看，然后继续。"),
            ("See https://example.com/path. Keep this sentence.", "See . Keep this sentence."),
            ("请看https://example.com/a，继续www.example.org/b。", "请看，继续。"),
            ("Use https://example.com/a and https://example.org/b today.", "Use and today."),
            ("请看（https://example.com/a_(b)）。", "请看（）。"),
            ("Read (https://example.com/a_(b)). Next!", "Read (). Next!"),
            ("See https://example.com/path?x=42&y=1; thanks!", "See ; thanks!")
        ])
    }

    func testMarkdownKeepsLabelsButRemovesDestinationsAndImages() {
        assertCleanup([
            ("请看[需求变更](https://example.com/a_(b) \"Title\")，再确认。", "请看需求变更，再确认。"),
            ("Read [API guide](/private/path) today.", "Read API guide today."),
            ("说明 ![screenshot alt](https://example.com/a.png \"title\") 结束。", "说明 结束。"),
            ("![截图](data:image/png;base64,abc) 然后继续。", "然后继续。"),
            ("[需求说明][doc]\n[doc]: https://example.com/private", "需求说明"),
            ("![private screenshot][shot]\n[shot]: /private/image.png", ""),
            ("[outer [inner](/nested)](/destination)", "outer inner"),
            ("[guide](/path \"title (with parentheses)\")", "guide"),
            ("😀 [说明](/path) 👋", "😀 说明 👋")
        ])
    }

    func testHTMLImagesRedactionsAndExplicitAttachmentMarkers() {
        assertCleanup([
            ("之前 <img src=\"x.png\" alt=\"private > screenshot\" /> 之后。", "之前 之后。"),
            ("<IMG SRC=\"x.png\" ALT=\"Screenshot\">", ""),
            ("请解释 [REDACTED TOKEN] [REDACTED_EMAIL] [image] [attachment: spec.pdf] 【图片】 <image> 这个问题。", "请解释 这个问题。"),
            ("[图像:截图] 【附件：spec.pdf】 <attachment id='1'> 保留", "保留"),
            ("image processing and attachment handling are useful.", "image processing and attachment handling are useful."),
            ("请解释图片压缩与附件上传。", "请解释图片压缩与附件上传。")
        ])
    }

    func testFencesIncludingUnfinishedAndCRLFBlocks() {
        assertCleanup([
            ("之前\n```js\nconst secret = 42;\n```\n之后", "之前\n\n\n\n之后"),
            ("保留说明\n~~~python\nsecret = 42", "保留说明"),
            ("```js\nsecret", ""),
            ("之前\r\n```js\r\nsecret\r\n```\r\n之后", "之前\r\n\r\n\r\n\r\n之后"),
            ("之前\n````js\n```\n仍然是代码\n````\n之后", "之前\n\n\n\n\n之后")
        ])
    }

    func testPreservesOrdinaryProseWhitespaceNumbersAndIdentifiers() {
        for input in [
            "请整理需求变动，保留 2026 年的 42 条记录。",
            "Explain API 401 / 403, MCP, Tool Discovery, and version 2.5.",
            "ThisNaturalIdentifier1234567890ShouldNotDisappear and camelCase remain.",
            "第一行\n第二行\n\nThird line:  42\titems.",
            "普通的 [括号]、(parentheses)、English punctuation: yes; no!"
        ] {
            XCTAssertEqual(OriginalText.clean(input), input)
        }
    }

    func testEmptyAndNoiseOnlyInputsStayEmpty() {
        for input in ["", " \n\t ", "https://example.com", "www.example.com",
                      "[https://example.com](https://example.com)", "![alt](https://example.com/x.png)",
                      "[REDACTED TOKEN]", "[image]"] {
            XCTAssertEqual(OriginalText.clean(input), "")
            XCTAssertEqual(lesson(content: input).originalDisplayTitle, "无可展示的自然语言")
        }
    }

    func testLegacyOriginalFallbackAndNoTranslationSubstitution() throws {
        let legacy = try JSONDecoder().decode(Lesson.self, from: Data(#"{"id":"legacy","source":"pi","content":"旧记录https://example.com","status":"complete","createdAt":"","analysis":{"translation":"Never substitute this."}}"#.utf8))
        XCTAssertNil(legacy.analysis?.originalText)
        XCTAssertEqual(legacy.displayOriginalText, "旧记录")
        XCTAssertEqual(legacy.originalDisplayTitle, "旧记录")
        let missingAnalysis = Lesson(id: "no-analysis", source: "pi", content: "原文https://example.com", status: "pending", createdAt: "")
        XCTAssertEqual(missingAnalysis.displayOriginalText, "原文")
        let nullOriginal = try JSONDecoder().decode(Lesson.self, from: Data(#"{"id":"null","source":"pi","content":"原文https://example.com","status":"complete","createdAt":"","analysis":{"originalText":null}}"#.utf8))
        XCTAssertEqual(nullOriginal.displayOriginalText, "原文")
    }

    func testExplicitOriginalIncludingEmptyIsAuthoritativeAndDoesNotMutateRawContent() {
        let selected = lesson(content: "raw content", original: "模型选中的原文https://example.com")
        XCTAssertEqual(selected.displayOriginalText, "模型选中的原文")
        XCTAssertEqual(selected.content, "raw content")
        XCTAssertEqual(selected.analysis?.originalText, "模型选中的原文https://example.com")
        for original in ["", " \n ", "https://example.com", "[image]"] {
            let row = lesson(content: "must not reappear", original: original, translation: "Nor should English.")
            XCTAssertEqual(row.displayOriginalText, "")
            XCTAssertEqual(row.originalDisplayTitle, "无可展示的自然语言")
        }
    }

    func testOriginalDecodesAlongsideRicherVocabularyMetadata() throws {
        let payload = #"{"id":"rich","source":"manual","content":"raw https://private.example","status":"complete","createdAt":"","analysis":{"originalText":"整理需求变动https://rqqmslsz9y.feishu.[REDACTED TOKEN]","translation":"Organize requirement changes.","correctionStatus":"natural","corrections":[{"kind":"style","before":"old","after":"new","reason":"clearer"}],"vocabulary":[{"term":"requirement","meaning":"需求","phonetic":"/rɪˈkwaɪəmənt/","pos":"n.","morphology":"require + ment","usage":"a requirement","nuance":"specific need","senses":[{"pos":"n.","meaning":"必要条件","example":{"english":"A requirement.","source":{"kind":"reference","title":"Guide","url":"https://example.com","verification":"verified"}}}],"wordFamily":[{"term":"require","meaning":"要求","relationship":"verb"}],"synonyms":[{"term":"need","meaning":"需要","difference":"less formal"}],"antonyms":[{"term":"option","meaning":"选项"}],"examples":[{"english":"Meet the requirement."}]}],"examples":[{"english":"Organize the changes.","chinese":"整理变动。","source":{"kind":"ai"}}]}}"#
        let row = try JSONDecoder().decode(Lesson.self, from: Data(payload.utf8))
        XCTAssertEqual(row.displayOriginalText, "整理需求变动")
        XCTAssertEqual(row.analysis?.corrections?.first?.kind, "style")
        let word = try XCTUnwrap(row.analysis?.vocabulary?.first)
        XCTAssertEqual(word.senses?.first?.example?.source?.verification, "verified")
        XCTAssertEqual(word.wordFamily?.first?.relationship, "verb")
        XCTAssertEqual(word.synonyms?.first?.difference, "less formal")
        XCTAssertEqual(word.antonyms?.first?.term, "option")
        XCTAssertEqual(word.examples?.first?.english, "Meet the requirement.")
        XCTAssertEqual(row.analysis?.examples?.first?.source?.kind, "ai")
        XCTAssertEqual(row.sourceName, "手动导入")
        XCTAssertEqual(LessonHistory.sourceName(" Manual "), "手动导入")
    }

    func testSearchExcludesRemovedDestinationsAndHonorsExplicitOriginal() {
        let row = lesson(content: "整理[需求变动](https://private.example/secret-path) [REDACTED TOKEN]", translation: "Organize changes.")
        XCTAssertEqual(LessonHistory.matching([row], agent: "", query: "需求变动").map(\.id), [row.id])
        for query in ["private.example", "secret-path", "REDACTED"] {
            XCTAssertTrue(LessonHistory.matching([row], agent: "", query: query).isEmpty)
        }
        XCTAssertEqual(LessonHistory.matching([row], agent: "codex", query: "ORGANIZE").count, 1)
        XCTAssertEqual(LessonHistory.matching([row], agent: "", query: "Codex").count, 1)
        XCTAssertTrue(LessonHistory.matching([row], agent: "pi", query: "需求").isEmpty)
        let selected = lesson(content: "隐藏的旧内容", original: "显示的新原文")
        XCTAssertTrue(LessonHistory.matching([selected], agent: "", query: "旧内容").isEmpty)
        XCTAssertEqual(LessonHistory.matching([selected], agent: "", query: "新原文").count, 1)
        XCTAssertTrue(LessonHistory.matching([lesson(content: "must not reappear", original: "")], agent: "", query: "reappear").isEmpty)
    }
}
