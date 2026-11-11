import Foundation

public struct AgentOption: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let count: Int
}

/// Presentation-only helpers. Never substitute generated English for captured text.
public enum LessonHistory {
    public static func originalText(_ lesson: Lesson) -> String { lesson.content }

    public static func sourceID(_ source: String) -> String {
        let normalized = source.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return normalized.isEmpty ? "__unknown__" : normalized
    }

    public static func sourceName(_ source: String) -> String {
        let names = ["codex": "Codex", "cursor": "Cursor", "claude": "Claude Code",
                     "grok": "Grok Build", "pi": "Pi", "dsh": "DSH", "qoder": "Qoder", "manual": "Demo"]
        let id = sourceID(source)
        if id == "__unknown__" { return "未知 Agent" }
        return names[id] ?? source.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public static func agents(in lessons: [Lesson]) -> [AgentOption] {
        Dictionary(grouping: lessons, by: { sourceID($0.source) }).map { id, rows in
            AgentOption(id: id, name: sourceName(rows[0].source), count: rows.count)
        }.sorted { $0.id < $1.id }
    }

    public static func matching(_ lessons: [Lesson], agent: String, query: String) -> [Lesson] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let selected = agent.isEmpty ? nil : sourceID(agent)
        return lessons.filter { lesson in
            guard selected == nil || sourceID(lesson.source) == selected else { return false }
            return term.isEmpty || [lesson.content, lesson.analysis?.translation ?? "", sourceName(lesson.source)]
                .contains { $0.localizedCaseInsensitiveContains(term) }
        }
    }

    /// Keep no selection empty; otherwise select the next visible lesson, not a hidden one.
    public static func selection(_ id: String?, in lessons: [Lesson]) -> String? {
        guard let id else { return nil }
        return lessons.contains { $0.id == id } ? id : lessons.first?.id
    }

    public static func needsFilterReset(for id: String, lessons: [Lesson], agent: String, query: String) -> Bool {
        guard lessons.contains(where: { $0.id == id }) else { return false }
        return !matching(lessons, agent: agent, query: query).contains { $0.id == id }
    }
}
