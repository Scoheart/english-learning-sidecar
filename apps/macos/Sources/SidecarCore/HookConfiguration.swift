import Foundation

public func shellQuote(_ text: String) -> String { "'" + text.replacingOccurrences(of: "'", with: "'\\''") + "'" }

public enum HookConfiguration {
    public static let paths = ["codex": ".codex/hooks.json", "claude": ".claude/settings.json", "cursor": ".cursor/hooks.json", "grok": ".grok/hooks/english-sidecar.json"]
    public static func merge(existing: Data?, agent: String, executable: String, port: Int = 4317) throws -> Data {
        guard paths[agent] != nil, !executable.contains("\n"), !executable.contains("\r") else { throw SidecarError.invalidHooks }
        _ = try Endpoint(port: port)
        var root: [String: Any] = [:]
        if let existing {
            guard let object = try JSONSerialization.jsonObject(with: existing) as? [String: Any] else { throw SidecarError.invalidHooks }
            root = object
        }
        if let value = root["hooks"], !(value is [String: Any]) { throw SidecarError.invalidHooks }
        var hooks = root["hooks"] as? [String: Any] ?? [:]
        let event = agent == "cursor" ? "beforeSubmitPrompt" : "UserPromptSubmit"
        if let value = hooks[event], !(value is [[String: Any]]) { throw SidecarError.invalidHooks }
        var handlers = hooks[event] as? [[String: Any]] ?? []
        let command = "\(shellQuote(executable)) \(agent) \(port)"
        let exists = handlers.contains { handler in
            if let c = handler["command"] as? String { return c == command }
            return (handler["hooks"] as? [[String: Any]] ?? []).contains { ($0["command"] as? String) == command }
        }
        if !exists {
            if agent == "cursor" { handlers.append(["command": command]) }
            else { handlers.append(["hooks": [["type": "command", "command": command, "timeout": 2]]]) }
        }
        hooks[event] = handlers; root["hooks"] = hooks
        if agent == "cursor", root["version"] == nil { root["version"] = 1 }
        return try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
    }
}
