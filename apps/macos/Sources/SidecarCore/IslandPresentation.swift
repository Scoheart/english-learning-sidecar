public enum IslandCommand: Equatable, Sendable { case hide, compact, expand }

public enum IslandPresentationMode: String, CaseIterable, Sendable {
    case notch, automatic, floating

    public static func stored(_ value: String?) -> Self { value.flatMap(Self.init(rawValue:)) ?? .notch }

    public var label: String {
        switch self {
        case .notch: return "贴顶刘海"
        case .automatic: return "自动识别显示器"
        case .floating: return "浮动胶囊"
        }
    }

    public func isFloating(hasHardwareNotch: Bool) -> Bool {
        self == .floating || (self == .automatic && !hasHardwareNotch)
    }

    public func command(visible: Bool, expanded: Bool, hasHardwareNotch: Bool) -> IslandCommand {
        guard visible else { return .hide }
        // Upstream compact() HIDES floating windows. Keep expanded() and render
        // our own small content in floating mode so there is always a hover target.
        return expanded || isFloating(hasHardwareNotch: hasHardwareNotch) ? .expand : .compact
    }
}

public struct IslandInteraction: Equatable, Sendable {
    public private(set) var expanded = false
    public private(set) var pinned = false
    public private(set) var hovering = false
    public init() {}
    public mutating func hover(_ inside: Bool) {
        hovering = inside
        expanded = pinned || inside
    }
    public mutating func togglePin() {
        pinned.toggle()
        expanded = pinned || hovering
    }
    public mutating func hide() { expanded = false; pinned = false; hovering = false }
}
