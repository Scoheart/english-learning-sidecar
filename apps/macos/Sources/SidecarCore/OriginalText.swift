import Foundation

/// Display-only cleanup shared in behavior with the web client. Never persist this over captured content.
public enum OriginalText {
    private static let removed = "\0"
    private static let redaction = #"(?:\[REDACTED(?:[ _-][^\]\r\n]*)?\]|<REDACTED(?:[ _-][^>\r\n]*)?>)"#

    public static func clean(_ value: String) -> String {
        guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return "" }
        var text = stripFences(value)
        text = replace(#"<img\b(?:[^>"']|"[^"]*"|'[^']*')*>"#, in: text, options: .caseInsensitive) { _ in removed }
        text = stripMarkdown(text)
        text = replace(#"^[ \t]{0,3}\[[^\]\r\n]+\]:[^\r\n]*"#, in: text, options: .anchorsMatchLines) { _ in removed }
        text = stripURLs(text)
        text = replace(redaction, in: text, options: .caseInsensitive) { _ in removed }
        text = replace(#"\[(?:image|attachment|图片|图像|附件)(?:[ _:-][^\]\r\n]*)?\]|【(?:图片|图像|附件)(?:[：:][^】\r\n]*)?】|<(?:image|attachment)\b[^>]*>"#, in: text, options: .caseInsensitive) { _ in removed }
        // Coalesce only spaces touching removed fragments, not ordinary prose whitespace.
        return replace(#"[ \t]*\x00(?:[ \t]*\x00)*[ \t]*"#, in: text) { match in
            match.contains(" ") || match.contains("\t") ? " " : ""
        }.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func replace(_ pattern: String, in text: String, options: NSRegularExpression.Options = [], replacement: (String) -> String) -> String {
        let regex = try! NSRegularExpression(pattern: pattern, options: options)
        let source = text as NSString
        var result = ""
        var cursor = 0
        for match in regex.matches(in: text, range: NSRange(location: 0, length: source.length)) {
            result += source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            result += replacement(source.substring(with: match.range))
            cursor = NSMaxRange(match.range)
        }
        return result + source.substring(from: cursor)
    }

    private static func stripURLs(_ text: String) -> String {
        let prefix = try! NSRegularExpression(pattern: #"https?://|www\."#, options: .caseInsensitive)
        let placeholder = try! NSRegularExpression(pattern: redaction, options: .caseInsensitive)
        let source = text as NSString
        var result = ""
        var cursor = 0
        for match in prefix.matches(in: text, range: NSRange(location: 0, length: source.length)) {
            guard match.range.location >= cursor else { continue }
            result += source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            let prefixEnd = NSMaxRange(match.range)
            var end = prefixEnd
            var parentheses = 0
            while end < source.length {
                if let token = placeholder.firstMatch(in: text, options: .anchored, range: NSRange(location: end, length: source.length - end)) {
                    end = NSMaxRange(token.range)
                    continue
                }
                let char = source.character(at: end)
                // ASCII URL paths stop before whitespace, adjacent Chinese prose, or markup.
                if char < 0x21 || char > 0x7e || "<>\"'`[]{}".utf16.contains(char) { break }
                if char == 40 { parentheses += 1 }
                if char == 41 {
                    if parentheses == 0 { break }
                    parentheses -= 1
                }
                end += 1
            }
            while end > prefixEnd && ".,!?;:".utf16.contains(source.character(at: end - 1)) { end -= 1 }
            result += removed
            cursor = end
        }
        return result + source.substring(from: cursor)
    }

    private static func closingDelimiter(_ text: [UInt16], start: Int, open: UInt16, close: UInt16) -> Int? {
        var depth = 1
        var quote: UInt16 = 0
        var index = start + 1
        while index < text.count {
            let char = text[index]
            if char == 92 { index += 2; continue }
            if open == 40 && (char == 34 || char == 39) {
                if quote == 0 { quote = char }
                else if quote == char { quote = 0 }
                index += 1
                continue
            }
            if quote == 0 {
                if char == open { depth += 1 }
                if char == close {
                    depth -= 1
                    if depth == 0 { return index }
                }
            }
            index += 1
        }
        return nil
    }

    private static func stripMarkdown(_ value: String) -> String {
        let text = Array(value.utf16)
        var result: [UInt16] = []
        var index = 0
        while index < text.count {
            let image = text[index] == 33 && index + 1 < text.count && text[index + 1] == 91
            let start = image ? index + 1 : index
            if text[start] == 91,
               let labelEnd = closingDelimiter(text, start: start, open: 91, close: 93),
               labelEnd + 1 < text.count {
                let destination = labelEnd + 1
                let delimiter = text[destination]
                if (delimiter == 40 || delimiter == 91),
                   let destinationEnd = closingDelimiter(text, start: destination, open: delimiter, close: delimiter == 40 ? 41 : 93) {
                    if image { result.append(0) }
                    else { result += stripMarkdown(String(decoding: text[(start + 1)..<labelEnd], as: UTF16.self)).utf16 }
                    index = destinationEnd + 1
                    continue
                }
            }
            result.append(text[index])
            index += 1
        }
        return String(decoding: result, as: UTF16.self)
    }

    private static func stripFences(_ text: String) -> String {
        let opening = try! NSRegularExpression(pattern: #"^\s*(`{3,}|~{3,})"#)
        let closing = try! NSRegularExpression(pattern: #"^\s*(`{3,}|~{3,})\s*$"#)
        var fence: String?
        let lines = text.components(separatedBy: "\n")
        return lines.enumerated().map { index, rawLine in
            let hasCR = index < lines.count - 1 && rawLine.hasSuffix("\r")
            let line = hasCR ? String(rawLine.dropLast()) : rawLine
            let range = NSRange(location: 0, length: (line as NSString).length)
            if let current = fence {
                if let match = closing.firstMatch(in: line, range: range) {
                    let delimiter = (line as NSString).substring(with: match.range(at: 1))
                    if delimiter.first == current.first && delimiter.count >= current.count { fence = nil }
                }
                return removed + (hasCR ? "\r" : "")
            }
            if let match = opening.firstMatch(in: line, range: range) {
                fence = (line as NSString).substring(with: match.range(at: 1))
                return removed + (hasCR ? "\r" : "")
            }
            return rawLine
        }.joined(separator: "\n")
    }
}
