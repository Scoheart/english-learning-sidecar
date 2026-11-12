import SwiftUI
import AppKit
import SidecarCore

struct IslandView: View {
    @ObservedObject var store: DesktopStore
    @ObservedObject var state: IslandState
    let pin: () -> Void
    let measured: (IslandProbeView) -> Void

    private var title: String { islandStatus(store) }
    private var statusDotColor: Color {
        if !store.connected { return StudioAccent.rose.solid }
        if store.status?.paused == true { return StudioAccent.amber.solid }
        if (store.status?.stats.pending ?? 0) > 0 { return StudioAccent.sky.solid }
        return StudioAccent.emerald.solid
    }
    private var accentText: Color { Color(red: 0.68, green: 0.78, blue: 1.0) }

    private func glanceOriginal(_ lesson: Lesson) -> String {
        lesson.displayOriginalText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func glanceTranslation(_ lesson: Lesson) -> String {
        (lesson.analysis?.translation ?? "")
            .replacingOccurrences(of: "[Demo preview]", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func glanceVocabulary(_ lesson: Lesson) -> [Vocabulary] {
        Array((lesson.analysis?.vocabulary ?? []).prefix(4).filter {
            !$0.term.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        })
    }

    private func hasGlance(_ lesson: Lesson) -> Bool {
        let original = glanceOriginal(lesson)
        let translation = glanceTranslation(lesson)
        return !original.isEmpty || (!translation.isEmpty && translation != original) || !glanceVocabulary(lesson).isEmpty
    }

    var body: some View {
        Group {
            if state.compactInExpandedShell && !state.expanded {
                HStack(spacing: 8) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(Color(red: 0.35, green: 0.48, blue: 0.95).opacity(0.28))
                            .frame(width: 18, height: 18)
                        Image(systemName: "book.closed.fill")
                            .font(.system(size: 9.5, weight: .semibold))
                            .foregroundStyle(Color(red: 0.65, green: 0.75, blue: 1.0))
                    }
                    Circle()
                        .fill(statusDotColor)
                        .frame(width: 5.5, height: 5.5)
                    Text(title)
                        .font(StudioFont.ui(size: 11.5, weight: .medium))
                        .lineLimit(1)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 8.5, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.55))
                }
                .frame(width: 214, height: 22)
                .contentShape(Rectangle())
                .onTapGesture(perform: pin)
            } else if let lesson = store.islandLesson, hasGlance(lesson) {
                glanceCard(lesson)
                    .padding(.top, 2)
                    .frame(width: 340)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Spacer(minLength: 0)
                        windowControls
                    }
                    Text("下一次提问，也可以是一小课。")
                        .font(StudioFont.editorial(size: 13.5, weight: .medium))
                        .foregroundStyle(.white.opacity(0.75))
                    HStack {
                        Spacer()
                        Button("打开学习窗口 →") {
                            store.revealMain?()
                        }
                        .font(StudioFont.ui(size: 11, weight: .semibold))
                        .foregroundStyle(accentText)
                    }
                }
                .padding(.top, 2)
                .frame(width: 340)
            }
        }
        .foregroundStyle(.white)
        .buttonStyle(.borderless)
        .environment(\.colorScheme, .dark)
        // No rounded-rectangle background here: DynamicNotchKit draws the shell.
        .background(IslandGeometryProbe(changed: measured))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("英语学习岛")
    }

    private var windowControls: some View {
        HStack(spacing: 4) {
            Button(action: pin) {
                Image(systemName: state.pinned ? "pin.fill" : "pin")
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(state.pinned ? Color(red: 0.55, green: 0.70, blue: 1.0) : .white.opacity(0.75))
                    .frame(width: 22, height: 22)
                    .background(Color.white.opacity(state.pinned ? 0.16 : 0.08), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
            .help("固定 / 取消固定")

            Button {
                store.islandEnabled = false
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.70))
                    .frame(width: 22, height: 22)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
            .help("隐藏学习岛；可从菜单栏或主窗口恢复")
        }
    }

    private func glanceCard(_ lesson: Lesson) -> some View {
        let original = glanceOriginal(lesson)
        let translation = glanceTranslation(lesson)
        let words = glanceVocabulary(lesson)
        let showTranslation = !translation.isEmpty && translation != original
        let controlsOnOriginal = !original.isEmpty
        let controlsOnTranslation = !controlsOnOriginal && showTranslation
        return VStack(alignment: .leading, spacing: 12) {
            if !original.isEmpty {
                glanceBlock(label: "原文", text: original, emphasis: false, controls: controlsOnOriginal)
            }
            if showTranslation {
                glanceBlock(label: "翻译", text: translation, emphasis: true, controls: controlsOnTranslation)
            }
            if !words.isEmpty {
                vocabularyBlock(words, controls: !controlsOnOriginal && !controlsOnTranslation)
            }
        }
    }

    private func glanceBlock(label: String, text: String, emphasis: Bool, controls: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            sectionLabel(label, controls: controls)
            Text(verbatim: text)
                .font(StudioFont.editorial(size: emphasis ? 16 : 14.5, weight: .semibold))
                .foregroundStyle(emphasis ? accentText : .white.opacity(0.96))
                .lineLimit(4)
                .lineSpacing(2.5)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
    }

    private func vocabularyBlock(_ words: [Vocabulary], controls: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionLabel("重点词汇", controls: controls)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(words.enumerated()), id: \.offset) { _, word in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(verbatim: word.term.trimmingCharacters(in: .whitespacesAndNewlines))
                            .font(StudioFont.phonetic(size: 12, weight: .semibold))
                            .foregroundStyle(accentText)
                            .lineLimit(1)
                        if let pos = word.pos?.trimmingCharacters(in: .whitespacesAndNewlines), !pos.isEmpty {
                            Text(pos)
                                .font(StudioFont.ui(size: 10, weight: .medium))
                                .foregroundStyle(.white.opacity(0.45))
                                .lineLimit(1)
                        }
                        Text(word.meaning)
                            .font(StudioFont.ui(size: 12))
                            .foregroundStyle(.white.opacity(0.82))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }

    private func sectionLabel(_ title: String, controls: Bool) -> some View {
        HStack(spacing: 8) {
            Text(title)
                .font(StudioFont.ui(size: 10, weight: .semibold))
                .foregroundStyle(.white.opacity(0.42))
            Spacer(minLength: 4)
            if controls { windowControls }
        }
    }
}

struct IslandCompactLeading: View {
    let pin: () -> Void
    let measured: (IslandProbeView) -> Void
    var body: some View {
        Image(systemName: "book.closed.fill")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Color(red: 0.68, green: 0.78, blue: 1.0))
            .frame(width: 24, height: 18)
            .contentShape(Rectangle())
            .onTapGesture(perform: pin)
            .background(IslandGeometryProbe(changed: measured))
            .accessibilityLabel("展开英语学习岛")
    }
}

struct IslandCompactTrailing: View {
    @ObservedObject var store: DesktopStore
    let pin: () -> Void
    let measured: (IslandProbeView) -> Void
    var body: some View {
        let label = !store.connected
            ? "离线"
            : store.status?.paused == true
                ? "暂停"
                : (store.status?.stats.pending ?? 0) > 0
                    ? "分析中"
                    : store.unreadCount > 0
                        ? "\(store.unreadCount) 条"
                        : "EN"
        Text(label)
            .font(StudioFont.phonetic(size: 10.5, weight: .semibold))
            .foregroundStyle(.white.opacity(0.92))
            .frame(minWidth: 34, minHeight: 18)
            .contentShape(Rectangle())
            .onTapGesture(perform: pin)
            .background(IslandGeometryProbe(changed: measured))
            .accessibilityLabel(islandStatus(store))
    }
}

@MainActor private func islandStatus(_ store: DesktopStore) -> String {
    if !store.connected { return "学习服务未连接" }
    if store.status?.paused == true { return "采集已暂停" }
    if let pending = store.status?.stats.pending, pending > 0 { return "分析中 · \(pending)" }
    return store.unreadCount > 0 ? "\(store.unreadCount) 条未读" : "English Sidecar"
}
