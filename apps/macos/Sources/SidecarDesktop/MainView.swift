import SwiftUI
import AppKit
import SidecarCore

struct MainView: View {
    @ObservedObject var store: DesktopStore
    @Environment(\.openWindow) private var openWindow
    private var filtered: [Lesson] { store.filteredLessons }
    private var agents: [AgentOption] { LessonHistory.agents(in: store.lessons) }
    private var hasFilters: Bool { !store.historyAgent.isEmpty || !store.historyQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

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
                } else if store.status?.mode != "live" {
                    HStack {
                        Label(store.status?.configurationMessage ?? "请配置文本模型以开始分析。", systemImage: "info.circle")
                        Spacer(); SettingsLink { Text("配置模型") }
                    }.font(.callout).padding(12).background(Color.primary.opacity(0.04))
                }
                if store.section == "knowledge" { KnowledgeView(store: store, query: store.historyQuery) }
                else {
                    HSplitView {
                        VStack(spacing: 0) {
                            historyHeader
                            Divider()
                            if filtered.isEmpty {
                                VStack(spacing: 12) {
                                    Image(systemName: hasFilters ? "line.3.horizontal.decrease.circle" : "text.book.closed").font(.title2)
                                    Text(hasFilters ? "没有匹配的记录" : "等待你的下一次提问").font(.callout)
                                    if hasFilters { Button("清除筛选") { store.clearHistoryFilters() } }
                                }.foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity).padding()
                            } else {
                                List(selection: $store.selectedID) {
                                    ForEach(filtered) { lesson in
                                        HistoryRow(lesson: lesson, unread: lesson.status == "complete" && !store.readIDs.contains(lesson.id))
                                            .tag(lesson.id)
                                            .contextMenu {
                                                Button("复制原文") {
                                                    NSPasteboard.general.clearContents()
                                                    NSPasteboard.general.setString(lesson.content, forType: .string)
                                                }
                                            }
                                    }
                                }.listStyle(.inset)
                            }
                            Text("原文 · 当前加载最近最多 150 条")
                                .font(.caption2).foregroundStyle(.tertiary).padding(8)
                        }.frame(minWidth: 230, idealWidth: 300, maxWidth: 380)
                        if let lesson = store.selectedLesson {
                            LessonDetail(store: store, lesson: lesson).id(lesson.id).frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)
                        } else {
                            ContentUnavailableView("把日常提问变成学习素材", systemImage: "text.book.closed", description: Text("选择左侧原文查看英文表达、词汇、句法和例句。\n可按来源 Agent 筛选，也可搜索原文或英文。"))
                                .frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)
                        }
                    }
                }
            }
        }
        .searchable(text: $store.historyQuery, placement: .toolbar, prompt: "搜索原文、英文或来源")
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

    private var historyHeader: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("学习记录").font(.headline)
                Spacer()
                Text(hasFilters ? "\(filtered.count) / \(store.lessons.count)" : "\(store.lessons.count)")
                    .font(.callout.monospacedDigit()).foregroundStyle(.secondary)
                    .accessibilityLabel("筛选后 \(filtered.count) 条，已加载 \(store.lessons.count) 条")
            }
            Picker("来源 Agent", selection: $store.historyAgent) {
                Text("全部 Agent · \(store.lessons.count)").tag("")
                ForEach(agents) { agent in Text("\(agent.name) · \(agent.count)").tag(agent.id) }
                if !store.historyAgent.isEmpty && !agents.contains(where: { $0.id == store.historyAgent }) {
                    Text("\(LessonHistory.sourceName(store.historyAgent)) · 0").tag(store.historyAgent)
                }
            }.pickerStyle(.menu).labelsHidden().accessibilityLabel("按来源 Agent 筛选")
        }.padding()
    }
}

private struct HistoryRow: View {
    let lesson: Lesson
    let unread: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(verbatim: LessonHistory.sourceName(lesson.source)).font(.caption).foregroundStyle(.secondary)
                Spacer()
                if unread { Image(systemName: "circle.fill").font(.system(size: 5)).accessibilityLabel("未读") }
            }
            Text(verbatim: LessonHistory.originalText(lesson)).font(.system(size: 13, weight: .medium))
                .lineLimit(3).help(lesson.content)
            HStack {
                Text(statusLabel(lesson.status)); Spacer()
                if let date = lesson.date { Text(date, style: .time) }
            }.font(.caption2).foregroundStyle(.secondary)
        }.padding(.vertical, 6).accessibilityElement(children: .combine)
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
