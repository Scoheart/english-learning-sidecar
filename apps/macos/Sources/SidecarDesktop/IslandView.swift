import SwiftUI
import AppKit

struct IslandView: View {
    @ObservedObject var store: DesktopStore
    @ObservedObject var state: IslandState
    let hover: (Bool) -> Void
    let pin: () -> Void
    private var title: String {
        if !store.connected { return "学习服务未连接" }
        if store.status?.paused == true { return "采集已暂停" }
        if let pending = store.status?.stats.pending, pending > 0 { return "分析中 · \(pending)" }
        return store.unreadCount > 0 ? "\(store.unreadCount) 条未读" : "English Sidecar"
    }
    var body: some View {
        Group {
            if state.expanded {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Label(store.islandLesson?.sourceName ?? "English Sidecar", systemImage: "book.closed")
                        Spacer()
                        Button(action: pin) { Image(systemName: state.pinned ? "pin.fill" : "pin") }.help("固定 / 收起")
                        Button { store.islandEnabled = false } label: { Image(systemName: "xmark") }.help("隐藏学习岛；可从菜单栏恢复")
                    }.font(.caption).foregroundStyle(.white.opacity(0.65))
                    if let lesson = store.islandLesson, !lesson.preview.english.isEmpty {
                        Text(lesson.preview.english).font(.system(size: 18, weight: .medium)).lineLimit(3).frame(maxWidth: .infinity, alignment: .leading)
                        Text(lesson.preview.takeaway).font(.callout).foregroundStyle(.white.opacity(0.65)).lineLimit(2)
                        Spacer(minLength: 0)
                        HStack {
                            LessonActions(store: store, text: lesson.preview.english)
                            Spacer()
                            Button("完整讲解 →") { store.openLesson(lesson.id) }
                        }.font(.callout)
                    } else {
                        Text(title).font(.headline)
                        Text("下一次提问，也可以是一小课。").foregroundStyle(.white.opacity(0.6))
                        Spacer()
                        Button("打开学习窗口") { store.revealMain?() }
                    }
                    if store.status?.mode == "demo" { Text("DEMO · 样例结果").font(.system(size: 9)).foregroundStyle(.white.opacity(0.45)) }
                }.padding(20).frame(width: 420, height: 226)
            } else {
                HStack(spacing: 10) {
                    Image(systemName: "book.closed.fill").font(.system(size: 12))
                    Text(title).font(.system(size: 12, weight: .medium)).lineLimit(1)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down").font(.system(size: 9)).foregroundStyle(.white.opacity(0.5))
                }.padding(.horizontal, 16).frame(width: 220, height: 36)
                .contentShape(Capsule()).onTapGesture(perform: pin)
            }
        }
        .foregroundStyle(.white).buttonStyle(.borderless)
        .background(Color(white: 0.06), in: RoundedRectangle(cornerRadius: state.expanded ? 22 : 18))
        .clipShape(RoundedRectangle(cornerRadius: state.expanded ? 22 : 18))
        .environment(\.colorScheme, .dark)
        .onHover(perform: hover)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("英语学习岛")
    }
}
