import SwiftUI
import SidecarCore

struct KnowledgeView: View {
    @ObservedObject var store: DesktopStore
    let mode: String
    let query: String
    @Binding var categoryFilter: String

    @State private var page = 0
    @State private var loadingHistory = false
    @State private var historyError: String?
    @State private var fetchedHistory: [HistoryRecord] = []
    @State private var fetchedTotal = 0
    @State private var deletingFavorite: FavoriteItem?
    @State private var historyRequestID = UUID()
    @State private var loadedHistoryKey: [String]?
    @State private var historyRetry = 0

    private let pageSize = 60
    private var historyQueryKey: [String] { [mode, query, categoryFilter, String(page)] }

    init(
        store: DesktopStore,
        mode: String = "history",
        query: String,
        categoryFilter: Binding<String> = .constant("all")
    ) {
        self.store = store
        self.mode = mode
        self.query = query
        self._categoryFilter = categoryFilter
    }

    private var isFavoritesMode: Bool { mode == "favorites" }

    private var filteredFavorites: [FavoriteItem] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return store.favorites.filter { item in
            let matchesCategory = categoryFilter == "all" || item.category == categoryFilter
            let matchesQuery = q.isEmpty || "\(item.term) \(item.meaning)".localizedCaseInsensitiveContains(q)
            return matchesCategory && matchesQuery
        }
    }

    private var fallbackHistoryItems: [HistoryRecord] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return store.knowledge
            .filter { item in
                let matchesCategory = categoryFilter == "all" || item.category == categoryFilter
                let matchesQuery = q.isEmpty || "\(item.term) \(item.meaning)".localizedCaseInsensitiveContains(q)
                return matchesCategory && matchesQuery
            }
            .map {
                HistoryRecord(
                    id: $0.id,
                    term: $0.term,
                    meaning: $0.meaning,
                    category: $0.category,
                    encounters: $0.encounters,
                    last_seen: $0.last_seen,
                    event_id: nil,
                    status: nil
                )
            }
    }

    private var activeHistoryItems: [HistoryRecord] {
        guard loadedHistoryKey == historyQueryKey else { return store.connected ? [] : fallbackHistoryItems }
        if !fetchedHistory.isEmpty || (historyError == nil && !loadingHistory && store.connected) {
            return fetchedHistory.isEmpty && fetchedTotal == 0 && !store.knowledge.isEmpty && query.isEmpty && categoryFilter == "all"
                ? fallbackHistoryItems
                : fetchedHistory
        }
        return fallbackHistoryItems
    }

    private var totalCount: Int {
        isFavoritesMode ? filteredFavorites.count : max(fetchedTotal, activeHistoryItems.count)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Image(systemName: isFavoritesMode ? "star.fill" : "clock.arrow.circlepath")
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(isFavoritesMode ? StudioAccent.amber.solid : StudioPalette.primary)
                            Text(isFavoritesMode ? "我的收藏" : "History")
                                .font(StudioFont.ui(size: 20, weight: .semibold))
                                .foregroundStyle(StudioPalette.foreground)
                        }
                        Text(
                            isFavoritesMode
                                ? "收藏值得回看的单词、词组、语法和例句。"
                                : "所有查询与分析，以及其中出现的单词、语法和例句。相同内容累计计数。"
                        )
                        .font(StudioFont.ui(size: 12.5))
                        .foregroundStyle(StudioPalette.mutedForeground)
                    }

                    Spacer()

                    StudioBadge(text: "\(totalCount) 项", style: .outline, monospaced: true)
                }

                // Category Tabs
                HStack {
                    StudioSegmentedTabs(
                        selection: Binding(
                            get: {
                                if isFavoritesMode && categoryFilter == "analysis" { return "all" }
                                return categoryFilter
                            },
                            set: { next in
                                categoryFilter = next
                                page = 0
                            }
                        ),
                        options: isFavoritesMode
                            ? [
                                StudioTabOption(id: "all", title: "全部"),
                                StudioTabOption(id: "vocabulary", title: "单词"),
                                StudioTabOption(id: "grammar", title: "语法"),
                                StudioTabOption(id: "example", title: "例句")
                            ]
                            : [
                                StudioTabOption(id: "all", title: "全部"),
                                StudioTabOption(id: "analysis", title: "查询与分析"),
                                StudioTabOption(id: "vocabulary", title: "单词"),
                                StudioTabOption(id: "grammar", title: "语法"),
                                StudioTabOption(id: "example", title: "例句")
                            ],
                        fullWidth: false,
                        compact: true
                    )
                    Spacer()
                }

                // Content Grid
                if isFavoritesMode {
                    if filteredFavorites.isEmpty {
                        emptyCollectionCard
                    } else {
                        LazyVGrid(
                            columns: [GridItem(.adaptive(minimum: 280, maximum: 460), spacing: 16, alignment: .top)],
                            alignment: .leading,
                            spacing: 16
                        ) {
                            ForEach(filteredFavorites) { item in
                                favoriteCard(item)
                            }
                        }
                    }
                } else {
                    if let historyError {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(historyError)
                                .font(StudioFont.ui(size: 12.5))
                                .foregroundStyle(StudioPalette.destructive)
                                .accessibilityLabel("历史记录加载失败：\(historyError)")
                            StudioActionButton(label: "重试", icon: "arrow.clockwise", variant: .outline, small: true) {
                                historyRetry += 1
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 24)
                    } else if loadingHistory && activeHistoryItems.isEmpty {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text("正在加载历史记录…")
                                .font(StudioFont.ui(size: 12.5))
                                .foregroundStyle(StudioPalette.mutedForeground)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 48)
                    } else if activeHistoryItems.isEmpty {
                        emptyCollectionCard
                    } else {
                        LazyVGrid(
                            columns: [GridItem(.adaptive(minimum: 280, maximum: 460), spacing: 16, alignment: .top)],
                            alignment: .leading,
                            spacing: 16
                        ) {
                            ForEach(activeHistoryItems) { item in
                                historyCard(item)
                            }
                        }

                        if fetchedTotal > pageSize {
                            HStack {
                                StudioActionButton(
                                    label: "上一页",
                                    icon: "chevron.left",
                                    variant: .outline,
                                    small: true,
                                    disabled: page == 0
                                ) {
                                    page = max(0, page - 1)
                                }
                                Spacer()
                                Text("第 \(page + 1) / \(max(1, Int(ceil(Double(fetchedTotal) / Double(pageSize))))) 页")
                                    .font(StudioFont.phonetic(size: 11.5))
                                    .foregroundStyle(StudioPalette.mutedForeground)
                                Spacer()
                                StudioActionButton(
                                    label: "下一页",
                                    icon: "chevron.right",
                                    variant: .outline,
                                    small: true,
                                    disabled: (page + 1) * pageSize >= fetchedTotal
                                ) {
                                    page += 1
                                }
                            }
                            .padding(.top, 6)
                        }
                    }
                }
            }
            .padding(.horizontal, 26)
            .padding(.vertical, 24)
            .frame(maxWidth: 1280, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .onChange(of: mode) { _, _ in page = 0 }
        .onChange(of: query) { _, _ in page = 0 }
        .onChange(of: categoryFilter) { _, _ in page = 0 }
        .task(id: historyQueryKey + [String(store.historyRevision), String(historyRetry)]) {
            await loadHistoryIfNeeded()
        }
        .confirmationDialog(
            "取消收藏「\(deletingFavorite?.term ?? "")」？History 中的记录和出现次数不受影响。",
            isPresented: Binding(
                get: { deletingFavorite != nil },
                set: { if !$0 { deletingFavorite = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("取消收藏", role: .destructive) {
                if let item = deletingFavorite {
                    Task {
                        await store.removeFavorite(item.id)
                        deletingFavorite = nil
                    }
                }
            }
            Button("保留收藏", role: .cancel) { deletingFavorite = nil }
        }
    }

    private func favoriteCard(_ item: FavoriteItem) -> some View {
        let accent = categoryAccent(item.category)
        return StudioSurfaceCard(topStripe: .solid(accent), padding: 17, spacing: 11) {
            HStack {
                StudioBadge(text: categoryLabel(item.category), style: .accent(accent))
                Spacer()
            }

            HStack(alignment: .top, spacing: 8) {
                Text(verbatim: item.term)
                    .font(StudioFont.editorial(size: 16.5, weight: .bold))
                    .foregroundStyle(StudioPalette.foreground)
                    .lineSpacing(2.5)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                HStack(spacing: 4) {
                    StudioFavoriteStarButton(
                        store: store,
                        term: item.term,
                        meaning: item.meaning,
                        category: item.category,
                        eventID: item.event_id
                    )
                    if item.category == "vocabulary" || item.category == "example" {
                        SpeechButton(
                            speech: store.speech,
                            api: store.api,
                            remote: store.activeSpeechID != nil,
                            text: item.term
                        )
                    }
                }
            }

            if !item.meaning.isEmpty {
                StudioCalloutBlock(title: "", text: item.meaning, accent: accent)
            }

            HStack {
                if let eventID = item.event_id, !eventID.isEmpty {
                    Button {
                        Task { await store.openEventByID(eventID) }
                    } label: {
                        HStack(spacing: 4) {
                            Text("查看完整分析")
                            Image(systemName: "arrow.right")
                                .font(.system(size: 10, weight: .semibold))
                        }
                        .font(StudioFont.ui(size: 11.5, weight: .medium))
                        .foregroundStyle(StudioPalette.mutedForeground)
                    }
                    .buttonStyle(.plain)
                } else {
                    Text("原始分析已删除")
                        .font(StudioFont.ui(size: 11))
                        .foregroundStyle(StudioPalette.mutedForeground)
                }

                Spacer()

                StudioActionButton(
                    label: nil,
                    icon: "trash",
                    variant: .ghost,
                    small: true,
                    helpText: "取消收藏 \(item.term)"
                ) {
                    deletingFavorite = item
                }
            }
            .padding(.top, 2)
        }
    }

    private func historyCard(_ item: HistoryRecord) -> some View {
        let accent = categoryAccent(item.category)
        let original = store.lessons.first { $0.id == item.event_id }?.originalDisplayTitle
        let cleanedTitle = OriginalText.clean(item.term)
        let title = item.category == "analysis" ? (original ?? (cleanedTitle.isEmpty ? "无可展示的自然语言" : cleanedTitle)) : item.term
        return StudioSurfaceCard(topStripe: .solid(accent), padding: 17, spacing: 11) {
            HStack {
                StudioBadge(text: categoryLabel(item.category), style: .accent(accent))
                Spacer()
                Text("\(item.category == "analysis" ? "查询" : "出现") \(item.encounters) 次")
                    .font(StudioFont.phonetic(size: 11))
                    .foregroundStyle(StudioPalette.mutedForeground)
            }

            HStack(alignment: .top, spacing: 8) {
                Text(verbatim: title)
                    .font(StudioFont.editorial(size: 16.5, weight: .bold))
                    .foregroundStyle(StudioPalette.foreground)
                    .lineSpacing(2.5)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                HStack(spacing: 4) {
                    if item.category != "analysis" {
                        StudioFavoriteStarButton(
                            store: store,
                            term: item.term,
                            meaning: item.meaning,
                            category: item.category,
                            eventID: item.event_id
                        )
                    }
                    if item.category == "vocabulary" || item.category == "example" {
                        SpeechButton(
                            speech: store.speech,
                            api: store.api,
                            remote: store.activeSpeechID != nil,
                            text: item.term
                        )
                    }
                }
            }

            if !item.meaning.isEmpty {
                StudioCalloutBlock(title: "", text: item.meaning, accent: accent)
            }

            if let status = item.status, !status.isEmpty {
                HStack {
                    StudioTaskStatusBadge(status: status)
                    Spacer()
                }
            }

            HStack {
                if let eventID = item.event_id, !eventID.isEmpty {
                    Button {
                        Task { await store.openEventByID(eventID) }
                    } label: {
                        HStack(spacing: 4) {
                            Text("查看完整分析")
                            Image(systemName: "arrow.right")
                                .font(.system(size: 10, weight: .semibold))
                        }
                        .font(StudioFont.ui(size: 11.5, weight: .medium))
                        .foregroundStyle(StudioPalette.mutedForeground)
                    }
                    .buttonStyle(.plain)
                } else {
                    Text("原始分析已删除")
                        .font(StudioFont.ui(size: 11))
                        .foregroundStyle(StudioPalette.mutedForeground)
                }
                Spacer()
            }
            .padding(.top, 2)
        }
    }

    private var emptyCollectionCard: some View {
        let hasQuery = !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return StudioSurfaceCard(padding: 36, spacing: 12, hoverable: false) {
            VStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(StudioPalette.muted)
                        .frame(width: 42, height: 42)
                    Image(systemName: isFavoritesMode ? "star" : "clock.arrow.circlepath")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(StudioPalette.mutedForeground)
                }
                Text(hasQuery ? "没有匹配的内容" : isFavoritesMode ? "这里还没有收藏" : "还没有历史记录")
                    .font(StudioFont.ui(size: 14, weight: .semibold))
                    .foregroundStyle(StudioPalette.foreground)
                Text(
                    hasQuery
                        ? "试试其他关键词，或清空搜索。"
                        : isFavoritesMode
                            ? "在分析卡片或 History 中点击星标，即可将内容加入收藏。"
                            : "查询或分析过的内容会自动保存在这里。"
                )
                .font(StudioFont.ui(size: 12))
                .foregroundStyle(StudioPalette.mutedForeground)

                StudioActionButton(label: "查看 Prompts", icon: "text.book.closed", variant: .outline, small: true) {
                    store.section = "feed"
                    store.historyQuery = ""
                }
                .padding(.top, 4)
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func categoryLabel(_ category: String) -> String {
        switch category {
        case "analysis": return "查询与分析"
        case "vocabulary": return "单词"
        case "grammar": return "语法"
        case "example": return "例句"
        default: return category
        }
    }

    private func categoryAccent(_ category: String) -> StudioAccent {
        switch category {
        case "analysis": return .sky
        case "vocabulary": return .indigo
        case "grammar": return .violet
        case "example": return .teal
        default: return .indigo
        }
    }

    private func loadHistoryIfNeeded() async {
        guard !isFavoritesMode else { return }
        let requestID = UUID()
        let queryKey = historyQueryKey
        historyRequestID = requestID
        loadingHistory = true
        historyError = nil
        defer { if historyRequestID == requestID { loadingHistory = false } }
        var components = URLComponents()
        components.path = "/api/history"
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "category", value: categoryFilter),
            URLQueryItem(name: "offset", value: String(page * pageSize)),
            URLQueryItem(name: "limit", value: String(pageSize))
        ]
        guard let pathWithQuery = components.string else { return }
        do {
            let res = try await store.api.get(pathWithQuery, as: HistoryResponse.self)
            guard !Task.isCancelled, historyRequestID == requestID, queryKey == historyQueryKey else { return }
            if page > 0 && page * pageSize >= res.total { page = 0; return }
            fetchedHistory = res.history
            fetchedTotal = res.total
            loadedHistoryKey = queryKey
        } catch {
            guard !Task.isCancelled, historyRequestID == requestID, queryKey == historyQueryKey else { return }
            historyError = error.localizedDescription
        }
    }
}

// MARK: - Studio Favorite Star Button (Aligned with favorite-button.tsx)

struct StudioFavoriteStarButton: View {
    @ObservedObject var store: DesktopStore
    let term: String
    let meaning: String
    let category: String
    let eventID: String?
    @State private var hovering = false

    var body: some View {
        let saved = store.isFavorite(category: category, term: term)
        Button {
            Task {
                await store.saveFavorite(
                    term: term,
                    meaning: meaning,
                    category: category,
                    eventID: eventID
                )
            }
        } label: {
            Image(systemName: saved ? "star.fill" : "star")
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(saved ? StudioPalette.primary : (hovering ? StudioPalette.primary : StudioPalette.mutedForeground))
                .frame(width: 24, height: 24)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(hovering ? StudioPalette.muted : Color.clear)
                )
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(saved ? "已在收藏夹，无需重复收藏" : "加入我的收藏")
        .accessibilityLabel(saved ? "已收藏 \(term)" : "收藏 \(term)")
    }
}
