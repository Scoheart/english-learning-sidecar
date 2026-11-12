import SwiftUI
import AppKit
import SidecarCore

// MARK: - Adaptive Studio Color Palette (Aligned with src/web/index.css)

enum StudioPalette {
    private static func dynamic(light: (CGFloat, CGFloat, CGFloat, CGFloat), dark: (CGFloat, CGFloat, CGFloat, CGFloat)) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .vibrantDark, .aqua]) != .aqua
            let c = isDark ? dark : light
            return NSColor(srgbRed: c.0, green: c.1, blue: c.2, alpha: c.3)
        })
    }

    /// Warm alabaster in light (`hsl(40, 23%, 98%)`), deep midnight slate in dark (`hsl(224, 25%, 8.2%)`)
    static let background = dynamic(light: (0.984, 0.980, 0.969, 1.0), dark: (0.062, 0.075, 0.102, 1.0))

    /// Subtle warm-tinted canvas for the right-hand main stage (`bg-muted/10`)
    static let stageBackground = dynamic(light: (0.976, 0.971, 0.958, 1.0), dark: (0.068, 0.081, 0.110, 1.0))

    /// Sidebar background (`bg-muted/20`)
    static let sidebarBackground = dynamic(light: (0.964, 0.958, 0.944, 1.0), dark: (0.076, 0.090, 0.122, 1.0))

    /// Elevated card surface (`--card`)
    static let card = dynamic(light: (1.000, 1.000, 1.000, 1.0), dark: (0.088, 0.103, 0.138, 1.0))

    /// Hover-elevated card surface
    static let cardHover = dynamic(light: (1.000, 1.000, 1.000, 1.0), dark: (0.102, 0.119, 0.158, 1.0))

    /// Muted control / pill surface (`--muted`)
    static let muted = dynamic(light: (0.948, 0.942, 0.928, 1.0), dark: (0.125, 0.143, 0.184, 1.0))

    /// Secondary badge / button surface (`--secondary`)
    static let secondary = dynamic(light: (0.934, 0.941, 0.956, 1.0), dark: (0.138, 0.158, 0.200, 1.0))

    /// Selected prompt item accent fill (`--accent`)
    static let accentSurface = dynamic(light: (0.922, 0.935, 0.978, 1.0), dark: (0.136, 0.168, 0.244, 1.0))

    /// Primary brand color: Royal Indigo in light (`hsl(228, 64%, 40%)`), Luminous Indigo in dark (`hsl(222, 82%, 66%)`)
    static let primary = dynamic(light: (0.145, 0.239, 0.655, 1.0), dark: (0.384, 0.545, 0.941, 1.0))

    /// Primary foreground text on primary buttons
    static let primaryForeground = dynamic(light: (0.992, 0.992, 0.996, 1.0), dark: (0.070, 0.086, 0.125, 1.0))

    /// Primary ink text (`--foreground`)
    static let foreground = dynamic(light: (0.086, 0.106, 0.157, 1.0), dark: (0.929, 0.941, 0.957, 1.0))

    /// Secondary muted text (`--muted-foreground`)
    static let mutedForeground = dynamic(light: (0.376, 0.408, 0.478, 1.0), dark: (0.612, 0.647, 0.710, 1.0))

    /// Subtle hairline border (`--border`)
    static let border = dynamic(light: (0.867, 0.882, 0.906, 1.0), dark: (0.157, 0.180, 0.224, 1.0))

    /// Stronger border on card hover or active input
    static let borderStrong = dynamic(light: (0.760, 0.792, 0.855, 1.0), dark: (0.235, 0.270, 0.340, 1.0))

    /// Destructive red (`--destructive`)
    static let destructive = dynamic(light: (0.863, 0.196, 0.196, 1.0), dark: (0.925, 0.345, 0.345, 1.0))

    /// Card drop shadow color
    static let shadow = dynamic(light: (0.086, 0.106, 0.157, 0.055), dark: (0.000, 0.000, 0.000, 0.28))
}

// MARK: - Semantic Color Themes (Matching studio-elements.tsx & task-status-badge.tsx)

enum StudioAccent: String, CaseIterable, Sendable {
    case indigo
    case sky
    case emerald
    case amber
    case violet
    case rose
    case cyan
    case teal
    case slate

    private static func dynamic(light: (CGFloat, CGFloat, CGFloat, CGFloat), dark: (CGFloat, CGFloat, CGFloat, CGFloat)) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .vibrantDark, .aqua]) != .aqua
            let c = isDark ? dark : light
            return NSColor(srgbRed: c.0, green: c.1, blue: c.2, alpha: c.3)
        })
    }

    var solid: Color {
        switch self {
        case .indigo:  return Self.dynamic(light: (0.310, 0.275, 0.898, 1), dark: (0.455, 0.490, 0.965, 1))
        case .sky:     return Self.dynamic(light: (0.055, 0.647, 0.914, 1), dark: (0.220, 0.741, 0.973, 1))
        case .emerald: return Self.dynamic(light: (0.063, 0.725, 0.506, 1), dark: (0.204, 0.827, 0.600, 1))
        case .amber:   return Self.dynamic(light: (0.961, 0.620, 0.043, 1), dark: (0.984, 0.749, 0.141, 1))
        case .violet:  return Self.dynamic(light: (0.545, 0.361, 0.965, 1), dark: (0.655, 0.545, 0.980, 1))
        case .rose:    return Self.dynamic(light: (0.957, 0.247, 0.369, 1), dark: (0.984, 0.443, 0.522, 1))
        case .cyan:    return Self.dynamic(light: (0.024, 0.714, 0.831, 1), dark: (0.133, 0.827, 0.933, 1))
        case .teal:    return Self.dynamic(light: (0.078, 0.722, 0.651, 1), dark: (0.176, 0.831, 0.749, 1))
        case .slate:   return Self.dynamic(light: (0.392, 0.455, 0.545, 1), dark: (0.580, 0.639, 0.722, 1))
        }
    }

    var text: Color {
        switch self {
        case .indigo:  return Self.dynamic(light: (0.216, 0.188, 0.639, 1), dark: (0.647, 0.706, 0.988, 1))
        case .sky:     return Self.dynamic(light: (0.012, 0.412, 0.631, 1), dark: (0.490, 0.827, 0.988, 1))
        case .emerald: return Self.dynamic(light: (0.016, 0.471, 0.341, 1), dark: (0.431, 0.906, 0.718, 1))
        case .amber:   return Self.dynamic(light: (0.573, 0.251, 0.055, 1), dark: (0.988, 0.827, 0.302, 1))
        case .violet:  return Self.dynamic(light: (0.357, 0.129, 0.714, 1), dark: (0.769, 0.710, 0.992, 1))
        case .rose:    return Self.dynamic(light: (0.624, 0.071, 0.224, 1), dark: (0.992, 0.643, 0.686, 1))
        case .cyan:    return Self.dynamic(light: (0.055, 0.455, 0.565, 1), dark: (0.404, 0.910, 0.976, 1))
        case .teal:    return Self.dynamic(light: (0.059, 0.463, 0.431, 1), dark: (0.369, 0.918, 0.831, 1))
        case .slate:   return Self.dynamic(light: (0.200, 0.255, 0.333, 1), dark: (0.796, 0.835, 0.882, 1))
        }
    }

    var badgeFill: Color {
        solid.opacity(0.13)
    }

    var badgeBorder: Color {
        solid.opacity(0.30)
    }

    var surfaceFill: Color {
        solid.opacity(0.065)
    }

    var surfaceBorder: Color {
        solid.opacity(0.26)
    }

    /// Part-of-Speech color mapping matching `getPosBadgeStyle` in `studio-elements.tsx`
    static func forPOS(_ pos: String?) -> StudioAccent {
        let clean = (pos ?? "").lowercased()
        if clean.contains("v") { return .rose }
        if clean.contains("n") { return .sky }
        if clean.contains("adj") || clean.contains("adv") { return .amber }
        return .indigo
    }

    /// Sentence constituent role color mapping matching `getConstituentTheme` in `studio-elements.tsx`
    static func forConstituent(role: String, index: Int) -> StudioAccent {
        let r = role.lowercased()
        if r.contains("主") || r.contains("subject") { return .sky }
        if r.contains("谓") || r.contains("动") || r.contains("verb") || r.contains("predicate") || r.contains("modal") {
            return .rose
        }
        if r.contains("宾") || r.contains("表") || r.contains("object") || r.contains("complement") {
            return .emerald
        }
        if r.contains("状") || r.contains("修") || r.contains("目的") || r.contains("条件") || r.contains("介") || r.contains("adverb") || r.contains("modifier") || r.contains("prep") {
            return .amber
        }
        if r.contains("定") || r.contains("从句") || r.contains("同位") || r.contains("clause") || r.contains("attribute") {
            return .violet
        }
        let rotation: [StudioAccent] = [.sky, .rose, .emerald, .amber, .violet]
        return rotation[abs(index) % rotation.count]
    }
}

struct StudioStatusMeta {
    let label: String
    let accent: StudioAccent

    static func from(_ status: String) -> StudioStatusMeta {
        switch status {
        case "pending":
            return StudioStatusMeta(label: "排队中", accent: .amber)
        case "processing":
            return StudioStatusMeta(label: "分析中", accent: .sky)
        case "complete":
            return StudioStatusMeta(label: "已完成", accent: .emerald)
        case "failed":
            return StudioStatusMeta(label: "失败", accent: .rose)
        case "skipped":
            return StudioStatusMeta(label: "已跳过", accent: .violet)
        case "cancelled":
            return StudioStatusMeta(label: "已取消", accent: .slate)
        default:
            return StudioStatusMeta(label: status, accent: .slate)
        }
    }
}

struct StudioCorrectionMeta {
    let label: String
    let accent: StudioAccent

    static func from(_ status: String?) -> StudioCorrectionMeta {
        switch status {
        case "natural":
            return StudioCorrectionMeta(label: "表达地道 · Natural", accent: .emerald)
        case "natural_but_improvable":
            return StudioCorrectionMeta(label: "可进一步润色 · Improvable", accent: .indigo)
        case "needs_correction":
            return StudioCorrectionMeta(label: "建议修正 · Needs Fix", accent: .amber)
        default:
            return StudioCorrectionMeta(label: "自然英文表达 · Native Rewrite", accent: .sky)
        }
    }
}

// MARK: - Studio Typography System (Aligned with .font-editorial & .font-phonetic)

enum StudioFont {
    static func editorial(size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    static func phonetic(size: CGFloat, weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }

    static func ui(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .default)
    }
}

// MARK: - Relative Time Formatter (Aligned with formatRelativeTime in App.tsx)

enum StudioTime {
    static func relative(_ raw: String, date: Date? = nil) -> String {
        let resolved: Date? = date ?? {
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return f.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
        }()
        guard let target = resolved else { return "" }
        let diffSec = Int(Date().timeIntervalSince(target))
        if diffSec < 60 { return "Just now" }
        let diffMin = diffSec / 60
        if diffMin < 60 { return "\(diffMin)m ago" }
        let diffHour = diffMin / 60
        if diffHour < 24 { return "\(diffHour)h ago" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "MMM d"
        return formatter.string(from: target)
    }
}

// MARK: - Reusable Studio Components

struct StudioTaskStatusBadge: View {
    let status: String
    var body: some View {
        let meta = StudioStatusMeta.from(status)
        Text(meta.label)
            .font(StudioFont.ui(size: 10.5, weight: .semibold))
            .foregroundStyle(meta.accent.text)
            .padding(.horizontal, 6.5)
            .padding(.vertical, 2.5)
            .background(meta.accent.badgeFill, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .strokeBorder(meta.accent.badgeBorder.opacity(0.55), lineWidth: 0.75)
            )
            .help("任务状态：\(meta.label)")
    }
}

struct StudioBadge: View {
    enum Style {
        case accent(StudioAccent)
        case secondary
        case outline
        case dashedOutline
    }

    let text: String
    var icon: String? = nil
    var dotColor: Color? = nil
    var style: Style = .secondary
    var monospaced: Bool = false

    var body: some View {
        HStack(spacing: 4.5) {
            if let dotColor {
                Circle()
                    .fill(dotColor)
                    .frame(width: 5.5, height: 5.5)
            }
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 9.5, weight: .semibold))
            }
            Text(text)
                .font(monospaced ? StudioFont.phonetic(size: 10.5, weight: .semibold) : StudioFont.ui(size: 11, weight: .medium))
                .lineLimit(1)
        }
        .foregroundStyle(foregroundColor)
        .padding(.horizontal, 7.5)
        .padding(.vertical, 3)
        .background(backgroundColor, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay(borderOverlay)
    }

    private var foregroundColor: Color {
        switch style {
        case .accent(let accent): return accent.text
        case .secondary: return StudioPalette.foreground.opacity(0.88)
        case .outline, .dashedOutline: return StudioPalette.mutedForeground
        }
    }

    private var backgroundColor: Color {
        switch style {
        case .accent(let accent): return accent.badgeFill
        case .secondary: return StudioPalette.secondary
        case .outline, .dashedOutline: return Color.clear
        }
    }

    @ViewBuilder
    private var borderOverlay: some View {
        switch style {
        case .accent(let accent):
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(accent.badgeBorder, lineWidth: 1)
        case .secondary:
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(StudioPalette.border.opacity(0.6), lineWidth: 0.5)
        case .outline:
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(StudioPalette.border, lineWidth: 1)
        case .dashedOutline:
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [3, 2.5]))
                .foregroundStyle(StudioPalette.borderStrong)
        }
    }
}

enum StudioTopStripe {
    case none
    case heroGradient
    case lexisGradient
    case solid(StudioAccent)
}

struct StudioSurfaceCard<Content: View>: View {
    var topStripe: StudioTopStripe = .none
    var leftStripe: StudioAccent? = nil
    var tint: StudioAccent? = nil
    var padding: CGFloat = 18
    var spacing: CGFloat = 12
    var hoverable: Bool = true
    let content: Content

    @State private var hovering = false

    init(
        topStripe: StudioTopStripe = .none,
        leftStripe: StudioAccent? = nil,
        tint: StudioAccent? = nil,
        padding: CGFloat = 18,
        spacing: CGFloat = 12,
        hoverable: Bool = true,
        @ViewBuilder content: () -> Content
    ) {
        self.topStripe = topStripe
        self.leftStripe = leftStripe
        self.tint = tint
        self.padding = padding
        self.spacing = spacing
        self.hoverable = hoverable
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch topStripe {
            case .none:
                EmptyView()
            case .heroGradient:
                LinearGradient(
                    colors: [
                        StudioAccent.indigo.solid.opacity(0.85),
                        StudioAccent.sky.solid.opacity(0.75),
                        StudioAccent.emerald.solid.opacity(0.80)
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .frame(height: 4)
            case .lexisGradient:
                LinearGradient(
                    colors: [
                        StudioAccent.indigo.solid.opacity(0.75),
                        StudioAccent.amber.solid.opacity(0.65),
                        StudioAccent.violet.solid.opacity(0.75)
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .frame(height: 2.5)
            case .solid(let accent):
                Rectangle()
                    .fill(accent.solid)
                    .frame(height: 3)
            }

            HStack(alignment: .top, spacing: 0) {
                if let leftStripe {
                    Rectangle()
                        .fill(leftStripe.solid)
                        .frame(width: 3)
                }
                VStack(alignment: .leading, spacing: spacing) {
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(padding)
            }
        }
        .background(cardFill)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(borderColor, lineWidth: 1)
        )
        .shadow(
            color: StudioPalette.shadow,
            radius: hoverable && hovering ? 10 : 4,
            x: 0,
            y: hoverable && hovering ? 4 : 1
        )
        .offset(y: hoverable && hovering ? -1 : 0)
        .animation(.spring(response: 0.25, dampingFraction: 0.82), value: hovering)
        .onHover { inside in
            if hoverable { hovering = inside }
        }
    }

    private var cardFill: Color {
        if let tint {
            return tint.surfaceFill
        }
        return hoverable && hovering ? StudioPalette.cardHover : StudioPalette.card
    }

    private var borderColor: Color {
        if let tint {
            return hoverable && hovering ? tint.solid.opacity(0.50) : tint.surfaceBorder
        }
        return hoverable && hovering ? StudioPalette.borderStrong : StudioPalette.border
    }
}

/// Left-accented callout block (used for 核心释义, 字源构词, 词义辨析, 常用搭配, etc.)
struct StudioCalloutBlock: View {
    let title: String
    let text: String
    let accent: StudioAccent
    var monospacedText: Bool = false
    var enclosedBox: Bool = false

    var body: some View {
        if enclosedBox {
            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(StudioFont.ui(size: 11.5, weight: .semibold))
                    .foregroundStyle(accent.text)
                Text(text)
                    .font(monospacedText ? StudioFont.phonetic(size: 12, weight: .medium) : StudioFont.ui(size: 12.5))
                    .foregroundStyle(StudioPalette.foreground.opacity(0.92))
                    .lineSpacing(3)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 11)
            .padding(.vertical, 8.5)
            .background(accent.surfaceFill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(accent.surfaceBorder, lineWidth: 1)
            )
        } else {
            HStack(alignment: .top, spacing: 0) {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(accent.solid)
                    .frame(width: 3)
                VStack(alignment: .leading, spacing: 4) {
                    if !title.isEmpty {
                        Text(title)
                            .font(StudioFont.ui(size: 11.5, weight: .semibold))
                            .foregroundStyle(accent.text)
                    }
                    Text(text)
                        .font(monospacedText ? StudioFont.phonetic(size: 12, weight: .medium) : StudioFont.ui(size: 12.5, weight: title == "核心释义" ? .semibold : .regular))
                        .foregroundStyle(title == "核心释义" ? StudioPalette.foreground : StudioPalette.foreground.opacity(0.88))
                        .lineSpacing(3)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7.5)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(
                UnevenRoundedRectangle(
                    topLeadingRadius: 2,
                    bottomLeadingRadius: 2,
                    bottomTrailingRadius: 8,
                    topTrailingRadius: 8,
                    style: .continuous
                )
                .fill(accent.surfaceFill)
            )
        }
    }
}

// MARK: - Studio Segmented Pill Tabs (Aligned with shadcn/ui TabsList + TabsTrigger)

struct StudioTabOption<ID: Hashable>: Identifiable {
    let id: ID
    let title: String
    var count: Int? = nil
    var icon: String? = nil
}

struct StudioSegmentedTabs<ID: Hashable>: View {
    @Binding var selection: ID
    let options: [StudioTabOption<ID>]
    var fullWidth: Bool = true
    var compact: Bool = false

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options) { option in
                let isSelected = selection == option.id
                Button {
                    selection = option.id
                } label: {
                    HStack(spacing: 5) {
                        if let icon = option.icon {
                            Image(systemName: icon)
                                .font(.system(size: compact ? 10.5 : 11.5, weight: isSelected ? .semibold : .medium))
                        }
                        Text(option.title)
                            .font(StudioFont.ui(size: compact ? 11.5 : 12, weight: isSelected ? .semibold : .medium))
                            .lineLimit(1)
                        if let count = option.count {
                            Text("(\(count))")
                                .font(StudioFont.phonetic(size: compact ? 10.5 : 11, weight: isSelected ? .semibold : .regular))
                                .foregroundStyle(isSelected ? StudioPalette.foreground.opacity(0.85) : StudioPalette.mutedForeground)
                        }
                    }
                    .foregroundStyle(isSelected ? StudioPalette.foreground : StudioPalette.mutedForeground)
                    .frame(maxWidth: fullWidth ? .infinity : nil)
                    .padding(.horizontal, fullWidth ? 8 : 13)
                    .padding(.vertical, compact ? 5 : 6)
                    .background(
                        Group {
                            if isSelected {
                                RoundedRectangle(cornerRadius: 7, style: .continuous)
                                    .fill(StudioPalette.card)
                                    .shadow(color: StudioPalette.shadow, radius: 2, x: 0, y: 1)
                            }
                        }
                    )
                    .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(option.count.map { "\(option.title)，\($0) 项" } ?? option.title)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
        .onMoveCommand { direction in
            guard let current = options.firstIndex(where: { $0.id == selection }), !options.isEmpty else { return }
            let offset: Int
            switch direction {
            case .left: offset = -1
            case .right: offset = 1
            default: return
            }
            selection = options[(current + offset + options.count) % options.count].id
        }
        .accessibilityElement(children: .contain)
        .padding(3.5)
        .background(StudioPalette.muted, in: RoundedRectangle(cornerRadius: 9.5, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 9.5, style: .continuous)
                .strokeBorder(StudioPalette.border.opacity(0.6), lineWidth: 0.75)
        )
    }
}

// MARK: - Studio Action Buttons (Aligned with shadcn/ui Button variants)

struct StudioActionButton: View {
    enum Variant {
        case primary
        case outline
        case secondary
        case ghost
        case destructive
    }

    let label: String?
    var icon: String? = nil
    var iconColor: Color? = nil
    var variant: Variant = .outline
    var small: Bool = false
    var disabled: Bool = false
    var helpText: String? = nil
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: small ? 11 : 12, weight: .medium))
                        .foregroundStyle(iconColor ?? foregroundColor)
                }
                if let label, !label.isEmpty {
                    Text(label)
                        .font(StudioFont.ui(size: small ? 11.5 : 12, weight: .medium))
                        .lineLimit(1)
                }
            }
            .foregroundStyle(foregroundColor)
            .padding(.horizontal, label == nil || label?.isEmpty == true ? (small ? 6 : 7.5) : (small ? 9 : 11))
            .frame(height: small ? 26 : 30)
            .background(backgroundColor, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .strokeBorder(borderColor, lineWidth: borderWidth)
            )
            .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.48 : 1.0)
        .onHover { hovering = $0 }
        .help(helpText ?? label ?? "")
        .accessibilityLabel(label ?? helpText ?? "操作")
    }

    private var foregroundColor: Color {
        switch variant {
        case .primary:
            return StudioPalette.primaryForeground
        case .outline, .secondary:
            return StudioPalette.foreground
        case .ghost:
            return hovering ? StudioPalette.foreground : StudioPalette.mutedForeground
        case .destructive:
            return hovering ? .white : StudioPalette.destructive
        }
    }

    private var backgroundColor: Color {
        switch variant {
        case .primary:
            return hovering ? StudioPalette.primary.opacity(0.90) : StudioPalette.primary
        case .outline:
            return hovering ? StudioPalette.muted.opacity(0.85) : StudioPalette.card
        case .secondary:
            return hovering ? StudioPalette.secondary.opacity(0.80) : StudioPalette.secondary
        case .ghost:
            return hovering ? StudioPalette.muted.opacity(0.85) : Color.clear
        case .destructive:
            return hovering ? StudioPalette.destructive : StudioPalette.destructive.opacity(0.12)
        }
    }

    private var borderColor: Color {
        switch variant {
        case .primary:
            return StudioPalette.primary
        case .outline:
            return hovering ? StudioPalette.primary.opacity(0.45) : StudioPalette.border
        case .secondary, .ghost:
            return Color.clear
        case .destructive:
            return StudioPalette.destructive.opacity(0.35)
        }
    }

    private var borderWidth: CGFloat {
        switch variant {
        case .outline, .destructive: return 1
        default: return 0
        }
    }
}
