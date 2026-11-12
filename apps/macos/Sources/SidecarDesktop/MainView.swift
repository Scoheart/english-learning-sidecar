import SwiftUI
import AppKit
import SidecarCore

struct MainView: View {
    @ObservedObject var store: DesktopStore
    @Environment(\.openWindow) private var openWindow
    @State private var lexiconCategory: String = "all"
    @State private var changingCapture = false
    @State private var deletingLesson: Lesson?

    private var filtered: [Lesson] { store.filteredLessons }
    private var agents: [AgentOption] { LessonHistory.agents(in: store.lessons) }
    private var hasFilters: Bool {
        !store.historyAgent.isEmpty || !store.historyQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    private var activeSection: String {
        Binding(
            get: { store.section ?? "feed" },
            set: { store.section = $0 }
        ).wrappedValue
    }

    var body: some View {
        HStack(spacing: 0) {
            studioSidebar
                .frame(width: 304)
                .background(StudioPalette.sidebarBackground)

            Rectangle()
                .fill(StudioPalette.border)
                .frame(width: 1)

            studioMainStage
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(StudioPalette.stageBackground)
        }
        .background(StudioPalette.background)
        .preferredColorScheme(store.colorScheme)
        .onAppear {
            store.revealMain = {
                openWindow(id: "learning")
                NSApp.activate(ignoringOtherApps: true)
            }
        }
        .onChange(of: activeSection) { _, _ in lexiconCategory = "all" }
        .confirmationDialog("删除提示卡片？", isPresented: Binding(
            get: { deletingLesson != nil },
            set: { if !$0 { deletingLesson = nil } }
        ), titleVisibility: .visible) {
            if let lesson = deletingLesson {
                Button("只删除卡片", role: .destructive) { removeLesson(lesson, purgeKnowledge: false) }
                Button("删除卡片及关联知识", role: .destructive) { removeLesson(lesson, purgeKnowledge: true) }
            }
            Button("取消", role: .cancel) { deletingLesson = nil }
        } message: {
            Text("默认保留已积累的词汇与语法。此操作不可撤销。")
        }
        .alert(
            "操作未完成",
            isPresented: Binding(
                get: { store.lastError != nil },
                set: { if !$0 { store.lastError = nil } }
            )
        ) {
            Button("好", role: .cancel) { store.lastError = nil }
        } message: {
            Text(store.lastError ?? "")
        }
    }

    // MARK: - Left Studio Sidebar (Aligned with Web <aside>)

    private var studioSidebar: some View {
        VStack(spacing: 0) {
            // Keep the brand readable; native-only controls sit on their own row.
            VStack(alignment: .leading, spacing: 10) {
              HStack(spacing: 9) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(StudioPalette.primary)
                        .frame(width: 28, height: 28)
                    Image(systemName: "book.closed.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(StudioPalette.primaryForeground)
                }

                Text("English Sidecar")
                    .font(StudioFont.ui(size: 13.5, weight: .semibold))
                    .foregroundStyle(StudioPalette.foreground)
                    .lineLimit(1)

                connectionBadge

                Spacer(minLength: 0)
              }

              HStack(spacing: 8) {
                Toggle("采集提示", isOn: Binding(
                    get: { !(store.status?.paused ?? false) },
                    set: { enabled in
                        changingCapture = true
                        Task {
                            await store.mutate("/api/settings", body: ["paused": !enabled])
                            changingCapture = false
                        }
                    }
                ))
                .toggleStyle(.switch)
                .controlSize(.mini)
                .font(StudioFont.ui(size: 11.5))
                .disabled(!store.connected || changingCapture)
                .help("暂停只影响新提示采集，已有学习记录仍可浏览。")

                Spacer(minLength: 4)
                HStack(spacing: 2) {
                    StudioActionButton(
                        label: nil,
                        icon: appearanceIcon,
                        variant: .ghost,
                        small: true,
                        helpText: "切换外观主题（浅色 / 深色 / 跟随系统）"
                    ) {
                        cycleAppearance()
                    }

                    StudioActionButton(
                        label: nil,
                        icon: store.islandEnabled ? "capsule.fill" : "capsule",
                        iconColor: store.islandEnabled ? StudioPalette.primary : nil,
                        variant: .ghost,
                        small: true,
                        helpText: store.islandEnabled ? "隐藏灵动学习岛" : "显示灵动学习岛"
                    ) {
                        store.islandEnabled.toggle()
                    }

                    StudioActionButton(
                        label: nil,
                        icon: "arrow.clockwise",
                        variant: .ghost,
                        small: true,
                        helpText: "刷新数据 (⌘R)"
                    ) {
                        Task { await store.refresh() }
                    }

                    SettingsLink {
                        Image(systemName: "slider.horizontal.3")
                            .font(.system(size: 11.5, weight: .medium))
                            .foregroundStyle(StudioPalette.mutedForeground)
                            .frame(width: 26, height: 26)
                            .background(Color.clear, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                            .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .help("偏好设置 (⌘,)")
                    .accessibilityLabel("打开偏好设置")
                }
              }
            }
            .padding(.horizontal, 14)
            .padding(.top, 14)
            .padding(.bottom, 12)

            // 2. Mode Switcher + Search + Agent Filter
            VStack(spacing: 9) {
                StudioSegmentedTabs(
                    selection: Binding(
                        get: {
                            let s = store.section ?? "feed"
                            return s == "knowledge" ? "history" : s
                        },
                        set: { next in
                            store.openedLesson = nil
                            store.section = next
                        }
                    ),
                    options: [
                        StudioTabOption(
                            id: "feed",
                            title: "Prompts"
                        ),
                        StudioTabOption(
                            id: "favorites",
                            title: "我的收藏",
                            icon: "star.fill"
                        ),
                        StudioTabOption(
                            id: "history",
                            title: "History",
                            icon: "clock.arrow.circlepath"
                        )
                    ],
                    fullWidth: true,
                    compact: true
                )

                // Search Input
                HStack(spacing: 7) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(StudioPalette.mutedForeground)

                    TextField(
                        activeSection == "feed"
                            ? "Search prompts..."
                            : activeSection == "favorites"
                                ? "搜索收藏…"
                                : "搜索所有历史记录…",
                        text: $store.historyQuery
                    )
                    .textFieldStyle(.plain)
                    .font(StudioFont.ui(size: 12))
                    .foregroundStyle(StudioPalette.foreground)

                    if !store.historyQuery.isEmpty {
                        Button {
                            store.historyQuery = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 11.5))
                                .foregroundStyle(StudioPalette.mutedForeground)
                        }
                        .buttonStyle(.plain)
                        .help("清空搜索")
                    }
                }
                .padding(.horizontal, 10)
                .frame(height: 31)
                .background(StudioPalette.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(StudioPalette.border, lineWidth: 1)
                )

                // Agent Filter Bar in Feed Mode
                if activeSection == "feed" {
                    HStack(spacing: 6) {
                        Menu {
                            Button {
                                store.historyAgent = ""
                            } label: {
                                HStack {
                                    Text("全部 Agent · \(store.lessons.count)")
                                    if store.historyAgent.isEmpty { Image(systemName: "checkmark") }
                                }
                            }
                            Divider()
                            ForEach(agents) { agent in
                                Button {
                                    store.historyAgent = agent.id
                                } label: {
                                    HStack {
                                        Text("\(agent.name) · \(agent.count)")
                                        if store.historyAgent == agent.id { Image(systemName: "checkmark") }
                                    }
                                }
                            }
                        } label: {
                            HStack(spacing: 5) {
                                Image(systemName: "line.3.horizontal.decrease.circle")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(store.historyAgent.isEmpty ? StudioPalette.mutedForeground : StudioPalette.primary)
                                Text(selectedAgentLabel)
                                    .font(StudioFont.ui(size: 11.5, weight: .medium))
                                    .foregroundStyle(StudioPalette.foreground)
                                    .lineLimit(1)
                                Spacer(minLength: 4)
                                Text(hasFilters ? "\(filtered.count)/\(store.lessons.count)" : "\(store.lessons.count)")
                                    .font(StudioFont.phonetic(size: 10.5))
                                    .foregroundStyle(StudioPalette.mutedForeground)
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 9, weight: .semibold))
                                    .foregroundStyle(StudioPalette.mutedForeground)
                            }
                            .padding(.horizontal, 9)
                            .frame(height: 27)
                            .background(StudioPalette.card.opacity(0.85), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 7, style: .continuous)
                                    .strokeBorder(
                                        store.historyAgent.isEmpty ? StudioPalette.border : StudioPalette.primary.opacity(0.4),
                                        lineWidth: 1
                                    )
                            )
                        }
                        .menuStyle(.borderlessButton)
                        .accessibilityLabel("按来源 Agent 筛选")

                        if hasFilters {
                            StudioActionButton(
                                label: "重置",
                                icon: "xmark",
                                variant: .ghost,
                                small: true,
                                helpText: "清除筛选条件"
                            ) {
                                store.clearHistoryFilters()
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 12)

            Rectangle()
                .fill(StudioPalette.border)
                .frame(height: 1)

            // 3. Scrollable List Area
            if activeSection == "feed" {
                feedSidebarList
            } else {
                lexiconSidebarSummary
            }

            Rectangle()
                .fill(StudioPalette.border)
                .frame(height: 1)

            // 4. Quiet Studio Footer
            HStack(spacing: 8) {
                Circle()
                    .fill(statusDotColor)
                    .frame(width: 6.5, height: 6.5)

                Text(footerStatusText)
                    .font(StudioFont.ui(size: 11, weight: .medium))
                    .foregroundStyle(StudioPalette.mutedForeground)
                    .lineLimit(1)

                Spacer()

                if store.unreadCount > 0 {
                    Button {
                        for lesson in store.lessons where lesson.status == "complete" {
                            store.markRead(lesson.id)
                        }
                    } label: {
                        Text("\(store.unreadCount) 未读")
                            .font(StudioFont.phonetic(size: 10.5, weight: .semibold))
                            .foregroundStyle(StudioAccent.indigo.text)
                            .padding(.horizontal, 6.5)
                            .padding(.vertical, 2)
                            .background(StudioAccent.indigo.badgeFill, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .help("点击全部标为已读")
                } else {
                    Text("Local SQLite")
                        .font(StudioFont.phonetic(size: 10.5))
                        .foregroundStyle(StudioPalette.mutedForeground.opacity(0.85))
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 40)
        }
    }

    private var feedSidebarList: some View {
        ScrollView {
            LazyVStack(spacing: 5) {
                if filtered.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: hasFilters ? "magnifyingglass" : "text.book.closed")
                            .font(.system(size: 20, weight: .regular))
                            .foregroundStyle(StudioPalette.mutedForeground.opacity(0.75))
                        Text(
                            hasFilters
                                ? "没有匹配的提示，请尝试其他关键词或切换 Agent。"
                                : store.status?.mode == "unconfigured"
                                    ? "先接入文本模型。采集的提示会保留在队列中，接入后自动处理。"
                                    : "暂无提示。从编码助手提交提示后会自动出现在这里。"
                        )
                        .font(StudioFont.ui(size: 12))
                        .foregroundStyle(StudioPalette.mutedForeground)
                        .multilineTextAlignment(.center)
                        .lineSpacing(3)

                        if hasFilters {
                            StudioActionButton(label: "清除筛选", icon: "arrow.uturn.backward", variant: .outline, small: true) {
                                store.clearHistoryFilters()
                            }
                            .padding(.top, 2)
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 42)
                    .frame(maxWidth: .infinity)
                } else {
                    ForEach(filtered) { lesson in
                        StudioHistoryItemRow(
                            lesson: lesson,
                            isSelected: store.selectedLesson?.id == lesson.id,
                            isUnread: lesson.status == "complete" && !store.readIDs.contains(lesson.id),
                            onSelect: {
                                store.openedLesson = nil
                                store.selectedID = lesson.id
                            },
                            onCopyOriginal: {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(lesson.displayOriginalText, forType: .string)
                            },
                            onCopyEnglish: {
                                if let en = lesson.analysis?.translation, !en.isEmpty {
                                    NSPasteboard.general.clearContents()
                                    NSPasteboard.general.setString(en, forType: .string)
                                }
                            },
                            onRetry: {
                                Task { await store.mutate("/api/events/\(lesson.id)/retry") }
                            },
                            onDelete: { deletingLesson = lesson }
                        )
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
        }
    }

    private var lexiconSidebarSummary: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if activeSection == "favorites" {
                    StudioSurfaceCard(topStripe: .solid(.amber), padding: 14, spacing: 10, hoverable: false) {
                        HStack(spacing: 6) {
                            Image(systemName: "star.fill")
                                .font(.system(size: 12))
                                .foregroundStyle(StudioAccent.amber.solid)
                            Text("我的收藏 · Favorites")
                                .font(StudioFont.ui(size: 12.5, weight: .semibold))
                                .foregroundStyle(StudioPalette.foreground)
                        }

                        Text("已收藏 \(store.favorites.count) 项。在分析卡片或 History 中点击星标，即可加入收藏；相同内容不会重复保存。")
                            .font(StudioFont.ui(size: 11.5))
                            .foregroundStyle(StudioPalette.mutedForeground)
                            .lineSpacing(2.5)
                    }
                } else {
                    StudioSurfaceCard(topStripe: .solid(.indigo), padding: 14, spacing: 10, hoverable: false) {
                        HStack(spacing: 6) {
                            Image(systemName: "clock.arrow.circlepath")
                                .font(.system(size: 12))
                                .foregroundStyle(StudioAccent.indigo.solid)
                            Text("History · 累计历史")
                                .font(StudioFont.ui(size: 12.5, weight: .semibold))
                                .foregroundStyle(StudioPalette.foreground)
                        }

                        Text("History 自动保存所有查询与分析，并累计单词、语法和例句的出现次数。")
                            .font(StudioFont.ui(size: 11.5))
                            .foregroundStyle(StudioPalette.mutedForeground)
                            .lineSpacing(2.5)
                    }
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("分类筛选 · Category")
                        .font(StudioFont.ui(size: 11, weight: .semibold))
                        .foregroundStyle(StudioPalette.mutedForeground)
                        .padding(.horizontal, 4)

                    let categories: [(String, String, StudioAccent)] = activeSection == "favorites"
                        ? [
                            ("all", "全部 · All", .indigo),
                            ("vocabulary", "单词 · Vocabulary", .indigo),
                            ("grammar", "语法 · Grammar", .violet),
                            ("example", "例句 · Example", .teal)
                        ]
                        : [
                            ("all", "全部 · All", .indigo),
                            ("analysis", "查询与分析 · Analysis", .sky),
                            ("vocabulary", "单词 · Vocabulary", .indigo),
                            ("grammar", "语法 · Grammar", .violet),
                            ("example", "例句 · Example", .teal)
                        ]

                    ForEach(categories, id: \.0) { key, title, accent in
                        let selected = lexiconCategory == key
                        Button {
                            withAnimation(.spring(response: 0.22, dampingFraction: 0.85)) {
                                lexiconCategory = key
                            }
                        } label: {
                            HStack {
                                Circle()
                                    .fill(selected ? accent.solid : StudioPalette.mutedForeground.opacity(0.4))
                                    .frame(width: 6, height: 6)
                                Text(title)
                                    .font(StudioFont.ui(size: 12, weight: selected ? .semibold : .regular))
                                    .foregroundStyle(selected ? StudioPalette.foreground : StudioPalette.mutedForeground)
                                Spacer()
                            }
                            .padding(.horizontal, 11)
                            .padding(.vertical, 8)
                            .background(
                                RoundedRectangle(cornerRadius: 9, style: .continuous)
                                    .fill(selected ? StudioPalette.accentSurface : Color.clear)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 9, style: .continuous)
                                    .strokeBorder(selected ? StudioPalette.primary.opacity(0.25) : Color.clear, lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(12)
        }
    }

    // MARK: - Right Studio Main Stage (Aligned with Web <main>)

    private var studioMainStage: some View {
        VStack(spacing: 0) {
            if !store.connected {
                studioBanner(
                    icon: "bolt.horizontal.circle.fill",
                    accent: .amber,
                    title: "未连接本地学习服务",
                    subtitle: "已有学习记录仍可正常浏览；启动内置引擎或连接本机服务即可继续实时采集。"
                ) {
                    EngineStartButton(store: store, engine: store.engine)
                }
            } else if store.status?.mode != "live" {
                studioBanner(
                    icon: "sparkles",
                    accent: .indigo,
                    title: "先接入文本模型，开始生成学习内容",
                    subtitle: store.status?.configurationMessage ?? "配置并启用文本模型后，已采集的提示会自动在后台处理。"
                ) {
                    SettingsLink {
                        HStack(spacing: 5) {
                            Image(systemName: "cpu")
                                .font(.system(size: 11, weight: .semibold))
                            Text("接入模型")
                                .font(StudioFont.ui(size: 12, weight: .semibold))
                        }
                        .foregroundStyle(StudioPalette.primaryForeground)
                        .padding(.horizontal, 12)
                        .frame(height: 28)
                        .background(StudioPalette.primary, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }

            if let notice = store.favoriteNotice {
                HStack(spacing: 8) {
                    Image(systemName: "star.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(StudioAccent.amber.solid)
                    Text(notice)
                        .font(StudioFont.ui(size: 12, weight: .medium))
                        .foregroundStyle(StudioPalette.foreground)
                    Spacer()
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 8)
                .background(StudioPalette.muted.opacity(0.85))
                .overlay(alignment: .bottom) {
                    Rectangle().fill(StudioPalette.border).frame(height: 1)
                }
            }

            if activeSection != "feed" {
                KnowledgeView(
                    store: store,
                    mode: activeSection == "favorites" ? "favorites" : "history",
                    query: store.historyQuery,
                    categoryFilter: $lexiconCategory
                )
            } else if let lesson = store.selectedLesson {
                LessonDetail(store: store, lesson: lesson)
                    .id(lesson.id)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                studioEmptyState
            }
        }
    }

    private func studioBanner<ActionContent: View>(
        icon: String,
        accent: StudioAccent,
        title: String,
        subtitle: String,
        @ViewBuilder action: () -> ActionContent
    ) -> some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(accent.badgeFill)
                    .frame(width: 32, height: 32)
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(accent.text)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(StudioFont.ui(size: 12.5, weight: .semibold))
                    .foregroundStyle(StudioPalette.foreground)
                Text(subtitle)
                    .font(StudioFont.ui(size: 11.5))
                    .foregroundStyle(StudioPalette.mutedForeground)
                    .lineLimit(1)
            }

            Spacer()

            action()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(StudioPalette.card)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(StudioPalette.border)
                .frame(height: 1)
        }
    }

    private var studioEmptyState: some View {
        VStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(StudioPalette.muted)
                    .frame(width: 46, height: 46)
                Image(systemName: "book.closed")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(StudioPalette.mutedForeground)
            }

            VStack(spacing: 5) {
                Text(
                    store.status?.mode == "unconfigured"
                        ? "先接入文本模型"
                        : hasFilters
                            ? "没有匹配的提示"
                            : "把日常提问变成学习素材"
                )
                .font(StudioFont.ui(size: 16, weight: .semibold))
                .foregroundStyle(StudioPalette.foreground)

                Text(
                    store.status?.mode == "unconfigured"
                        ? "配置并启用文本模型后即可生成四维英语学习卡片。"
                        : hasFilters
                            ? "请尝试其他搜索词，或清空筛选条件查看全部历史提示。"
                            : "从编码助手提交自然语言提示，系统会在后台自动拆解词汇、句法、篇章与实战例句。"
                )
                .font(StudioFont.ui(size: 12.5))
                .foregroundStyle(StudioPalette.mutedForeground)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 380)
                .lineSpacing(3)
            }

            if hasFilters {
                StudioActionButton(label: "清除筛选条件", icon: "xmark.circle", variant: .outline) {
                    store.clearHistoryFilters()
                }
                .padding(.top, 4)
            } else if store.status?.mode == "unconfigured" {
                SettingsLink {
                    HStack(spacing: 6) {
                        Image(systemName: "cpu")
                            .font(.system(size: 12, weight: .semibold))
                        Text("打开模型设置")
                            .font(StudioFont.ui(size: 12.5, weight: .semibold))
                    }
                    .foregroundStyle(StudioPalette.primaryForeground)
                    .padding(.horizontal, 14)
                    .frame(height: 32)
                    .background(StudioPalette.primary, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
    }

    // MARK: - Helpers

    private func removeLesson(_ lesson: Lesson, purgeKnowledge: Bool) {
        deletingLesson = nil
        let suffix = purgeKnowledge ? "?knowledge=purge" : ""
        Task {
            if await store.mutate("/api/events/\(lesson.id)\(suffix)", method: "DELETE") {
                if store.openedLesson?.id == lesson.id { store.openedLesson = nil }
                store.reconcileHistorySelection()
            }
        }
    }

    private var connectionBadge: some View {
        Group {
            if !store.connected {
                StudioBadge(text: "离线", style: .accent(.rose))
            } else if store.status?.paused == true {
                StudioBadge(text: "已暂停", style: .accent(.amber))
            } else if store.status?.mode == "live" {
                StudioBadge(text: "Live", style: .accent(.emerald))
            } else {
                StudioBadge(text: "未配置", style: .secondary)
            }
        }
    }

    private var statusDotColor: Color {
        if !store.connected { return StudioAccent.rose.solid }
        if store.status?.paused == true { return StudioAccent.amber.solid }
        if store.status?.mode == "live" { return StudioAccent.emerald.solid }
        return StudioAccent.slate.solid
    }

    private var footerStatusText: String {
        if !store.connected { return "未连接 · 127.0.0.1:\(store.api.endpoint.port)" }
        if store.status?.paused == true { return "采集已暂停" }
        if let pending = store.status?.stats.pending, pending > 0 {
            return "队列分析中 (\(pending))"
        }
        return "已连接 · 最近 \(store.lessons.count) 条"
    }

    private var selectedAgentLabel: String {
        if store.historyAgent.isEmpty {
            return "全部 Agent"
        }
        if let match = agents.first(where: { $0.id == store.historyAgent }) {
            return match.name
        }
        return LessonHistory.sourceName(store.historyAgent)
    }

    private var appearanceIcon: String {
        switch store.appearance {
        case "light": return "sun.max.fill"
        case "dark": return "moon.fill"
        default: return "circle.lefthalf.filled"
        }
    }

    private func cycleAppearance() {
        switch store.appearance {
        case "system": store.appearance = "light"
        case "light": store.appearance = "dark"
        default: store.appearance = "system"
        }
    }
}

// MARK: - Sidebar Prompt Item Card (Aligned with .sidebar-prompt-item in App.tsx)

private struct StudioHistoryItemRow: View {
    let lesson: Lesson
    let isSelected: Bool
    let isUnread: Bool
    let onSelect: () -> Void
    let onCopyOriginal: () -> Void
    let onCopyEnglish: () -> Void
    let onRetry: () -> Void
    let onDelete: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: onSelect) {
            HStack(alignment: .top, spacing: 9) {
                // Left active indicator pill (matching Web's `w-1 rounded-full bg-primary`)
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(StudioPalette.primary)
                    .frame(width: 3.5)
                    .padding(.vertical, 3)
                    .opacity(isSelected ? 1.0 : 0.0)
                    .scaleEffect(y: isSelected ? 1.0 : 0.45, anchor: .center)

                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(verbatim: lesson.originalDisplayTitle)
                            .font(StudioFont.ui(size: 13, weight: isSelected ? .semibold : .medium))
                            .foregroundStyle(StudioPalette.foreground)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        if isUnread {
                            Circle()
                                .fill(StudioPalette.primary)
                                .frame(width: 6.5, height: 6.5)
                                .help("未读学习卡片")
                                .accessibilityLabel("未读")
                        }
                    }

                    HStack(spacing: 6) {
                        StudioTaskStatusBadge(status: lesson.status)

                        Text(verbatim: LessonHistory.sourceName(lesson.source))
                            .font(StudioFont.ui(size: 11, weight: .medium))
                            .foregroundStyle(StudioPalette.foreground.opacity(0.75))
                            .lineLimit(1)

                        let relTime = StudioTime.relative(lesson.createdAt, date: lesson.date)
                        if !relTime.isEmpty {
                            Text("·")
                                .font(StudioFont.ui(size: 11))
                                .foregroundStyle(StudioPalette.mutedForeground)
                            Text(relTime)
                                .font(StudioFont.ui(size: 11))
                                .foregroundStyle(StudioPalette.mutedForeground)
                                .lineLimit(1)
                        }

                        Spacer(minLength: 0)
                    }
                }
            }
            .padding(.leading, 6)
            .padding(.trailing, 11)
            .padding(.vertical, 9.5)
            .background(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(
                        isSelected
                            ? StudioPalette.accentSurface
                            : hovering
                                ? StudioPalette.muted.opacity(0.70)
                                : Color.clear
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .strokeBorder(
                        isSelected
                            ? StudioPalette.primary.opacity(0.28)
                            : hovering
                                ? StudioPalette.border
                                : Color.clear,
                        lineWidth: 1
                    )
            )
            .offset(x: hovering && !isSelected ? 1.5 : 0)
            .animation(.spring(response: 0.22, dampingFraction: 0.84), value: hovering)
            .animation(.spring(response: 0.22, dampingFraction: 0.84), value: isSelected)
            .contentShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(lesson.originalDisplayTitle)
        .accessibilityLabel(lesson.originalDisplayTitle)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .contextMenu {
            Button("复制原文", action: onCopyOriginal)
                .disabled(lesson.displayOriginalText.isEmpty)
            if let en = lesson.analysis?.translation, !en.isEmpty {
                Button("复制英文表达", action: onCopyEnglish)
            }
            if ["failed", "cancelled"].contains(lesson.status) {
                Divider()
                Button("重试分析", action: onRetry)
            }
            Divider()
            Button("删除记录", role: .destructive, action: onDelete)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Shared Legacy Helpers & Engine Start Button

struct EngineStartButton: View {
    @ObservedObject var store: DesktopStore
    @ObservedObject var engine: EngineManager
    @State private var starting = false

    var body: some View {
        StudioActionButton(
            label: starting ? "正在启动…" : "启动内置引擎",
            icon: "play.fill",
            variant: .primary,
            small: true,
            disabled: starting || engine.owned || !engine.available,
            helpText: engine.available ? "复用现有数据目录，不会停止其它服务" : "此构建没有打包 Node 引擎，请先运行 npm start"
        ) {
            starting = true
            Task {
                await store.startEngine()
                starting = false
            }
        }
    }
}

func statusLabel(_ status: String) -> String {
    StudioStatusMeta.from(status).label
}

struct NativeCard<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View {
        StudioSurfaceCard { content }
    }
}

struct InfoBlock: View {
    let title: String
    let text: String?
    var accent: StudioAccent = .indigo
    var body: some View {
        if let text, !text.isEmpty {
            StudioCalloutBlock(title: title, text: text, accent: accent)
        }
    }
}
