import SwiftUI
import AppKit
import SidecarCore

struct MainView: View {
    @ObservedObject var store: DesktopStore
    @Environment(\.openWindow) private var openWindow
    @State private var query = ""
    private var filtered: [Lesson] {
        store.lessons.filter { query.isEmpty || "\($0.content) \($0.analysis?.translation ?? "") \($0.sourceName)".localizedCaseInsensitiveContains(query) }
    }
    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 18) {
                Label("English Sidecar", systemImage: "book.closed.fill").font(.headline).padding([.horizontal, .top])
                List(selection: $store.section) {
                    Label("学习记录", systemImage: "text.book.closed").tag("feed")
                    Label("知识库", systemImage: "square.grid.2x2").tag("knowledge")
                }.listStyle(.sidebar)
                VStack(alignment: .leading, spacing: 8) {
                    Label(store.connected ? "学习服务已连接" : "学习服务未连接", systemImage: store.connected ? "checkmark.circle" : "circle.dashed")
                    Text("\(store.unreadCount) 条未读 · 仅在此 Mac 标记").font(.caption).foregroundStyle(.secondary)
                    Text("原生桌面端").font(.caption2).foregroundStyle(.tertiary)
                }.font(.caption).padding()
            }
            .navigationSplitViewColumnWidth(min: 175, ideal: 200, max: 230)
        } detail: {
            VStack(spacing: 0) {
                if !store.connected {
                    HStack {
                        Label("未连接本地学习服务；已有内容不会被清空。", systemImage: "network.slash")
                        Spacer()
                        EngineStartButton(store: store, engine: store.engine)
                    }.font(.callout).padding(12).background(Color.primary.opacity(0.04))
                } else if store.status?.mode == "demo" {
                    HStack {
                        Label("演示 / 未配置模式 · 请配置模型后启用真实分析。", systemImage: "info.circle")
                        Spacer(); SettingsLink { Text("配置模型") }
                    }.font(.callout).padding(12).background(Color.primary.opacity(0.04))
                }
                if store.section == "knowledge" { KnowledgeView(store: store, query: query) }
                else {
                    HSplitView {
                        VStack(spacing: 0) {
                            HStack {
                                Text("学习记录").font(.headline)
                                Spacer(); Text("\(filtered.count)").foregroundStyle(.secondary)
                            }.padding()
                            Divider()
                            List(selection: $store.selectedID) {
                                ForEach(filtered) { lesson in
                                    VStack(alignment: .leading, spacing: 6) {
                                        HStack {
                                            Text(lesson.sourceName).font(.caption).foregroundStyle(.secondary)
                                            Spacer()
                                            if lesson.status == "complete" && !store.readIDs.contains(lesson.id) {
                                                Image(systemName: "circle.fill").font(.system(size: 5)).accessibilityLabel("未读")
                                            }
                                        }
                                        Text(lesson.analysis?.translation ?? lesson.content).font(.system(size: 13, weight: .medium)).lineLimit(2)
                                        HStack {
                                            Text(statusLabel(lesson.status))
                                            Spacer()
                                            if let date = lesson.date { Text(date, style: .time) }
                                        }.font(.caption2).foregroundStyle(.secondary)
                                    }.padding(.vertical, 6).tag(lesson.id)
                                }
                            }.listStyle(.inset)
                            if filtered.isEmpty { Text(query.isEmpty ? "等待你的下一次提问" : "没有匹配的记录").font(.callout).foregroundStyle(.secondary).padding() }
                        }.frame(minWidth: 220, idealWidth: 280, maxWidth: 350)
                        if let lesson = store.selectedLesson {
                            LessonDetail(store: store, lesson: lesson).id(lesson.id).frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)
                        } else {
                            ContentUnavailableView("把日常提问变成学习素材", systemImage: "text.book.closed", description: Text("选择左侧记录查看英文表达、词汇、句法和例句。\n通过设置安装 Agent Hook 后，新记录会自动出现。"))
                                .frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)
                        }
                    }
                }
            }
        }
        .searchable(text: $query, placement: .toolbar, prompt: "搜索英文、原句或来源")
        .toolbar {
            ToolbarItemGroup {
                Button { Task { await store.refresh() } } label: { Image(systemName: "arrow.clockwise") }.help("刷新")
                Button { store.islandEnabled.toggle() } label: { Image(systemName: "capsule") }.help("显示或隐藏学习岛")
                SettingsLink { Image(systemName: "slider.horizontal.3") }
            }
        }
        .preferredColorScheme(store.colorScheme)
        .onAppear { store.revealMain = { openWindow(id: "learning"); NSApp.activate(ignoringOtherApps: true) } }
        .alert("操作未完成", isPresented: Binding(get: { store.lastError != nil }, set: { if !$0 { store.lastError = nil } })) {
            Button("好", role: .cancel) { store.lastError = nil }
        } message: { Text(store.lastError ?? "") }
    }
}
struct EngineStartButton: View {
    @ObservedObject var store: DesktopStore
    @ObservedObject var engine: EngineManager
    @State private var starting = false
    var body: some View {
        Button(starting ? "正在启动…" : "启动内置引擎") {
            starting = true
            Task { await store.startEngine(); starting = false }
        }.disabled(starting || engine.owned || !engine.available)
        .help(engine.available ? "复用现有数据目录，不会停止其它服务" : "此构建没有打包 Node 引擎，请先运行 npm start")
    }
}
func statusLabel(_ status: String) -> String {
    ["complete":"已生成", "pending":"排队中", "processing":"分析中", "failed":"失败", "skipped":"已跳过"][status] ?? status
}
struct NativeCard<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .frame(maxWidth: .infinity, alignment: .leading).padding(18)
            .background(.background, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.1), lineWidth: 1))
    }
}
struct InfoBlock: View {
    let title: String
    let text: String?
    var body: some View {
        if let text, !text.isEmpty {
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.caption.weight(.medium)).foregroundStyle(.secondary)
                Text(text).font(.callout).textSelection(.enabled)
            }
        }
    }
}
