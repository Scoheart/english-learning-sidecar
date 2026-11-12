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
    private var firstVocab: Vocabulary? {
        store.islandLesson?.analysis?.vocabulary?.first
    }
    private var takeaway: String {
        guard let lesson = store.islandLesson else { return "" }
        if let item = firstVocab { return "\(item.term) · \(item.meaning)" }
        return lesson.analysis?.summary ?? lesson.preview.takeaway
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
            } else {
                VStack(alignment: .leading, spacing: 11) {
                    // Header Row
                    HStack(spacing: 9) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(
                                    LinearGradient(
                                        colors: [
                                            Color(red: 0.25, green: 0.36, blue: 0.88),
                                            Color(red: 0.16, green: 0.52, blue: 0.85)
                                        ],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                                .frame(width: 28, height: 28)
                            Image(systemName: "book.closed.fill")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(.white)
                        }

                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text(store.islandLesson.map { LessonHistory.sourceName($0.source) } ?? "English Sidecar")
                                    .font(StudioFont.ui(size: 12, weight: .semibold))
                                    .foregroundStyle(.white)
                                if let corr = store.islandLesson?.analysis?.correctionStatus {
                                    let meta = StudioCorrectionMeta.from(corr)
                                    Text(meta.label.components(separatedBy: " · ").first ?? meta.label)
                                        .font(StudioFont.ui(size: 9.5, weight: .semibold))
                                        .foregroundStyle(Color(red: 0.68, green: 0.78, blue: 1.0))
                                        .padding(.horizontal, 5.5)
                                        .padding(.vertical, 1.5)
                                        .background(Color.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                                }
                            }
                            HStack(spacing: 5) {
                                Circle()
                                    .fill(statusDotColor)
                                    .frame(width: 5, height: 5)
                                Text(title)
                                    .font(StudioFont.ui(size: 10.5))
                                    .foregroundStyle(.white.opacity(0.60))
                            }
                        }

                        Spacer(minLength: 4)

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

                    if let lesson = store.islandLesson, !lesson.preview.english.isEmpty {
                        // Editorial English Preview
                        Text(verbatim: lesson.preview.english)
                            .font(StudioFont.editorial(size: 15, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.96))
                            .lineLimit(2)
                            .lineSpacing(2.5)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        // Highlighted Vocabulary or Takeaway Pill
                        if let vocab = firstVocab {
                            HStack(spacing: 6) {
                                Text(verbatim: vocab.term)
                                    .font(StudioFont.phonetic(size: 11, weight: .semibold))
                                    .foregroundStyle(Color(red: 0.68, green: 0.78, blue: 1.0))
                                if let pos = vocab.pos, !pos.isEmpty {
                                    Text(pos)
                                        .font(StudioFont.ui(size: 10, weight: .medium))
                                        .foregroundStyle(.white.opacity(0.50))
                                }
                                Text(vocab.meaning)
                                    .font(StudioFont.ui(size: 11))
                                    .foregroundStyle(.white.opacity(0.78))
                                    .lineLimit(1)
                            }
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                        } else if !takeaway.isEmpty {
                            Text(verbatim: takeaway)
                                .font(StudioFont.ui(size: 11))
                                .foregroundStyle(.white.opacity(0.68))
                                .lineLimit(1)
                        }

                        // Action Footer
                        HStack {
                            LessonActions(store: store, text: lesson.preview.english)
                            Spacer()
                            Button {
                                store.openLesson(lesson.id)
                            } label: {
                                HStack(spacing: 4) {
                                    Text("完整讲解")
                                    Image(systemName: "arrow.up.right")
                                        .font(.system(size: 9.5, weight: .semibold))
                                }
                                .font(StudioFont.ui(size: 11, weight: .semibold))
                                .foregroundStyle(Color(red: 0.68, green: 0.78, blue: 1.0))
                                .padding(.horizontal, 9)
                                .padding(.vertical, 4)
                                .background(Color(red: 0.30, green: 0.44, blue: 0.95).opacity(0.24), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            }
                        }
                    } else {
                        Text("下一次提问，也可以是一小课。")
                            .font(StudioFont.editorial(size: 13.5, weight: .medium))
                            .foregroundStyle(.white.opacity(0.75))
                        HStack {
                            Spacer()
                            Button("打开学习窗口 →") {
                                store.revealMain?()
                            }
                            .font(StudioFont.ui(size: 11, weight: .semibold))
                            .foregroundStyle(Color(red: 0.68, green: 0.78, blue: 1.0))
                        }
                    }
                }
                .padding(.top, 6)
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
