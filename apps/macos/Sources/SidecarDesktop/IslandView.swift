import SwiftUI
import AppKit
import SidecarCore

struct IslandView: View {
    @ObservedObject var store: DesktopStore
    @ObservedObject var state: IslandState
    let pin: () -> Void
    let measured: (IslandProbeView) -> Void
    private var title: String { islandStatus(store) }
    private var takeaway: String {
        guard let lesson = store.islandLesson else { return "" }
        if let item = lesson.analysis?.vocabulary?.first { return "\(item.term) · \(item.meaning)" }
        return lesson.analysis?.summary ?? lesson.preview.takeaway
    }
    var body: some View {
        Group {
            if state.compactInExpandedShell && !state.expanded {
                HStack(spacing: 10) {
                    Image(systemName: "book.closed.fill")
                    Text(title).lineLimit(1)
                    Image(systemName: "chevron.down").font(.system(size: 9))
                }.font(.system(size: 12, weight: .medium)).frame(width: 205, height: 20)
                    .contentShape(Rectangle()).onTapGesture(perform: pin)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        Image(systemName: "book.closed.fill").font(.system(size: 22, weight: .regular))
                            .frame(width: 30).foregroundStyle(.white.opacity(0.85))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(store.islandLesson.map { LessonHistory.sourceName($0.source) } ?? "English Sidecar")
                                .font(.system(size: 12, weight: .semibold))
                            Text(title).font(.system(size: 10)).foregroundStyle(.white.opacity(0.55))
                        }
                        Spacer(minLength: 4)
                        Button(action: pin) { Image(systemName: state.pinned ? "pin.fill" : "pin") }.help("固定 / 取消固定")
                        Button { store.islandEnabled = false } label: { Image(systemName: "xmark") }.help("隐藏学习岛；可从菜单栏恢复")
                    }.font(.system(size: 11))
                    if let lesson = store.islandLesson, !lesson.preview.english.isEmpty {
                        Text(verbatim: lesson.preview.english).font(.system(size: 14, weight: .medium))
                            .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if !takeaway.isEmpty {
                            Text(verbatim: takeaway).font(.system(size: 11)).foregroundStyle(.white.opacity(0.65)).lineLimit(1)
                        }
                        HStack {
                            LessonActions(store: store, text: lesson.preview.english)
                            Spacer()
                            Button("完整讲解 →") { store.openLesson(lesson.id) }
                        }.font(.system(size: 11))
                    } else {
                        Text("下一次提问，也可以是一小课。").font(.system(size: 13)).foregroundStyle(.white.opacity(0.7))
                        Button("打开学习窗口 →") { store.revealMain?() }.font(.system(size: 11))
                    }
                    if store.status?.mode == "demo" { Text("DEMO · 样例结果").font(.system(size: 9)).foregroundStyle(.white.opacity(0.45)) }
                }.padding(.top, 6).frame(width: 330)
            }
        }
        .foregroundStyle(.white).buttonStyle(.borderless)
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
        Image(systemName: "book.closed.fill").font(.system(size: 12)).foregroundStyle(.white)
            .frame(width: 24, height: 18).contentShape(Rectangle()).onTapGesture(perform: pin)
            .background(IslandGeometryProbe(changed: measured))
            .accessibilityLabel("展开英语学习岛")
    }
}
struct IslandCompactTrailing: View {
    @ObservedObject var store: DesktopStore
    let pin: () -> Void
    let measured: (IslandProbeView) -> Void
    var body: some View {
        Text(!store.connected ? "离线" : store.status?.paused == true ? "暂停" : (store.status?.stats.pending ?? 0) > 0 ? "分析中" : store.unreadCount > 0 ? "\(store.unreadCount) 条" : "EN")
            .font(.system(size: 11, weight: .medium)).foregroundStyle(.white)
            .frame(minWidth: 34, minHeight: 18).contentShape(Rectangle()).onTapGesture(perform: pin)
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
