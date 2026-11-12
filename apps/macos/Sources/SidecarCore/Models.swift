import Foundation

public struct Lesson: Decodable, Identifiable, Hashable, Sendable {
    public let id: String
    public let source: String
    public let content: String
    public let status: String
    public let createdAt: String
    public var analysis: LessonAnalysis?
    public var error: String?
    public init(id: String, source: String, content: String, status: String, createdAt: String, analysis: LessonAnalysis? = nil) {
        self.id = id; self.source = source; self.content = content; self.status = status
        self.createdAt = createdAt; self.analysis = analysis
    }
    public var sourceName: String { ["codex":"Codex", "cursor":"Cursor", "claude":"Claude Code", "grok":"Grok Build", "pi":"Pi", "dsh":"DSH", "qoder":"Qoder", "manual":"Demo"][source] ?? source }
    public var date: Date? {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: createdAt) ?? ISO8601DateFormatter().date(from: createdAt)
    }
    public var preview: LessonPreview {
        LessonPreview(english: analysis?.translation ?? "", term: analysis?.vocabulary?.first?.term ?? "",
                      takeaway: analysis?.grammar?.first?.explanation ?? analysis?.vocabulary?.first?.meaning ?? analysis?.summary ?? "")
    }
}
public struct LessonPreview: Equatable, Sendable {
    public let english: String
    public let term: String
    public let takeaway: String
}
public struct LessonAnalysis: Decodable, Hashable, Sendable {
    public var translation: String?
    public var language: String?
    public var correctionStatus: String?
    public var corrections: [Correction]?
    public var vocabulary: [Vocabulary]?
    public var sentenceAnatomy: SentenceAnatomy?
    public var grammar: [Grammar]?
    public var discourse: Discourse?
    public var examples: [Example]?
    public var notes: String?
    public var summary: String?
}
public struct Correction: Decodable, Hashable, Sendable { public let before: String; public let after: String; public var reason: String? }
public struct Vocabulary: Decodable, Hashable, Sendable {
    public let term: String; public let meaning: String
    public var phonetic: String?; public var pos: String?; public var morphology: String?; public var usage: String?; public var nuance: String?
}
public struct SentenceAnatomy: Decodable, Hashable, Sendable {
    public var pattern: String?; public var tense: String?; public var voice: String?; public var constituents: [Constituent]?
}
public struct Constituent: Decodable, Hashable, Sendable { public let role: String; public let fragment: String; public let explanation: String }
public struct Grammar: Decodable, Hashable, Sendable { public let label: String; public let explanation: String }
public struct Discourse: Decodable, Hashable, Sendable {
    public var logic: String?; public var cohesion: String?; public var upgradedParagraph: String?; public var upgradedChinese: String?
}
public struct Example: Decodable, Hashable, Sendable { public let english: String; public var chinese: String? }
public struct Knowledge: Decodable, Identifiable, Hashable, Sendable {
    public let id: String; public let term: String; public let meaning: String; public let category: String; public let encounters: Int
}
public struct SafeModel: Decodable, Identifiable, Hashable, Sendable {
    public let id: String; public let name: String; public let kind: String; public let baseUrl: String; public let model: String
    public var authMode: String?
    public var voice: String?; public var temperature: Double?; public var apiKeySet: Bool?; public var apiKeyMasked: String?
}
public struct ModelList: Decodable, Sendable {
    public let models: [SafeModel]; public var activeTextId: String?; public var activeSpeechId: String?
    public var textPresets: [TextModelPreset]?
}
public struct TextModelPreset: Decodable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let baseUrl: String
    public let authMode: String
}
public struct ModelTestResult: Decodable, Sendable {
    public let translation: String
}
public struct Status: Decodable, Sendable {
    public let mode: String; public let model: String; public let paused: Bool
    public var configurationMessage: String?
    public let stats: Statistics; public var activeSpeechModel: SafeModel?
    public struct Statistics: Decodable, Sendable { public let total: Int; public let complete: Int; public let pending: Int; public let failed: Int; public let knowledge: Int }
}
public struct EventList: Decodable, Sendable { public let events: [Lesson] }
public struct KnowledgeList: Decodable, Sendable { public let knowledge: [Knowledge] }

/// Only transitions observed after hydration become fresh notifications.
public struct CompletionTracker {
    private var hydrated = false
    private var observed = Set<String>()
    public init() {}
    public mutating func reset() { hydrated = false; observed.removeAll() }
    public mutating func observe(_ lessons: [Lesson]) -> [String] {
        let completed = lessons.filter { $0.status == "complete" }.map(\.id)
        let fresh = hydrated ? completed.filter { !observed.contains($0) } : []
        observed.formUnion(completed); hydrated = true
        if observed.count > 5000 { observed = Set(completed) }
        return fresh
    }
}

/// Minimal parser for the existing server's SSE update notifications.
public struct SSEParser {
    private var event = ""
    private var hasData = false
    public init() {}
    public mutating func feed(_ raw: String) -> Bool {
        let line = raw.hasSuffix("\r") ? String(raw.dropLast()) : raw
        if line.isEmpty {
            let notify = hasData && (event.isEmpty || event == "update")
            event = ""; hasData = false; return notify
        }
        if line.hasPrefix("event:") { event = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces) }
        if line.hasPrefix("data:") { hasData = true }
        return false
    }
}
