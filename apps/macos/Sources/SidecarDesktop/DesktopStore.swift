import SwiftUI
import AppKit
import SidecarCore

@MainActor final class DesktopStore: ObservableObject {
    @Published var status: Status?
    @Published var lessons: [Lesson] = [] { didSet { reconcileHistorySelection() } }
    @Published var knowledge: [Knowledge] = []
    @Published var favorites: [FavoriteItem] = []
    @Published var historyRecords: [HistoryRecord] = []
    @Published var historyTotal: Int = 0
    @Published var historyRevision: Int = 0
    @Published var favoriteNotice: String?
    @Published var openedLesson: Lesson?
    @Published var models: [SafeModel] = []
    @Published var textPresets: [TextModelPreset] = []
    @Published var activeTextID: String?
    @Published var activeSpeechID: String?
    @Published var selectedID: String?
    @Published var section: String? = "feed"
    @Published var historyQuery = "" { didSet { reconcileHistorySelection() } }
    @Published var historyAgent = UserDefaults.standard.string(forKey: "native.history.agent") ?? "" {
        didSet {
            UserDefaults.standard.set(historyAgent, forKey: "native.history.agent")
            reconcileHistorySelection()
        }
    }
    @Published var islandPresentation = IslandPresentationMode.stored(UserDefaults.standard.string(forKey: "native.island.presentation")) {
        didSet { UserDefaults.standard.set(islandPresentation.rawValue, forKey: "native.island.presentation") }
    }
    @Published var connected = false
    @Published var lastError: String?
    @Published var islandLessonID: String?
    @Published var islandInteracting = false
    @Published var readIDs: Set<String> = []
    @Published var islandEnabled = UserDefaults.standard.object(forKey: "native.island") as? Bool ?? true {
        didSet { UserDefaults.standard.set(islandEnabled, forKey: "native.island") }
    }
    @Published var islandDisplay = UserDefaults.standard.string(forKey: "native.display") ?? "primary" {
        didSet { UserDefaults.standard.set(islandDisplay, forKey: "native.display") }
    }
    @Published var appearance = UserDefaults.standard.string(forKey: "native.appearance") ?? "system" {
        didSet { UserDefaults.standard.set(appearance, forKey: "native.appearance") }
    }
    var colorScheme: ColorScheme? { appearance == "system" ? nil : appearance == "dark" ? .dark : .light }
    let speech = SpeechController()
    let engine = EngineManager()
    private(set) var api: SidecarAPI
    private var connectionTask: Task<Void, Never>?
    private var tracker = CompletionTracker()
    private var refreshing = false
    private var refreshAgain = false
    private var generation = UUID()
    var revealMain: (() -> Void)?
    var filteredLessons: [Lesson] { LessonHistory.matching(lessons, agent: historyAgent, query: historyQuery) }
    var selectedLesson: Lesson? {
        if let opened = openedLesson, opened.id == selectedID { return opened }
        return filteredLessons.first { $0.id == selectedID }
    }
    func reconcileHistorySelection() {
        if let opened = openedLesson, opened.id == selectedID { return }
        let next = LessonHistory.selection(selectedID, in: filteredLessons)
        if next != selectedID { selectedID = next }
    }
    func clearHistoryFilters() { historyAgent = ""; historyQuery = "" }
    private static func normalizeFavoriteKey(category: String, term: String) -> String {
        let collapsed = term.precomposedStringWithCompatibilityMapping
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return "\(category):\(collapsed)"
    }
    func isFavorite(category: String, term: String) -> Bool {
        let target = Self.normalizeFavoriteKey(category: category, term: term)
        return favorites.contains { Self.normalizeFavoriteKey(category: $0.category, term: $0.term) == target }
    }
    func saveFavorite(term: String, meaning: String, category: String, eventID: String? = nil) async {
        if isFavorite(category: category, term: term) {
            showFavoriteNotice("已在收藏夹，无需重复收藏")
            return
        }
        var payload: [String: Any] = ["term": term, "meaning": meaning, "category": category]
        if let eventID, !eventID.isEmpty { payload["eventId"] = eventID }
        do {
            let data = try await api.data("/api/favorites", method: "POST", body: payload)
            let res = try JSONDecoder().decode(FavoriteMutationResponse.self, from: data)
            favorites.removeAll { $0.id == res.favorite.id }
            favorites.insert(res.favorite, at: 0)
            showFavoriteNotice(res.message)
        } catch {
            lastError = error.localizedDescription
        }
    }
    func removeFavorite(_ id: String) async {
        do {
            _ = try await api.data("/api/favorites/\(id)", method: "DELETE")
            favorites.removeAll { $0.id == id }
            showFavoriteNotice("已取消收藏，History 中的记录仍会保留。")
        } catch {
            lastError = error.localizedDescription
        }
    }
    func openEventByID(_ id: String) async {
        if lessons.contains(where: { $0.id == id }) {
            openedLesson = nil
            openLesson(id)
            return
        }
        do {
            let res = try await api.get("/api/events/\(id)", as: SingleEventResponse.self)
            openedLesson = res.event
            section = "feed"
            clearHistoryFilters()
            selectedID = res.event.id
            markRead(res.event.id)
            revealMain?()
        } catch {
            lastError = error.localizedDescription
        }
    }
    private func showFavoriteNotice(_ message: String) {
        favoriteNotice = message
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 2_600_000_000)
            if self?.favoriteNotice == message { self?.favoriteNotice = nil }
        }
    }
    var islandLesson: Lesson? { lessons.first { $0.id == islandLessonID } ?? lessons.first { $0.status == "complete" } }
    var unreadCount: Int { lessons.filter { $0.status == "complete" && !readIDs.contains($0.id) }.count }
    var readKey: String { "native.read.\(api.endpoint.port)" }

    init() {
        let stored = UserDefaults.standard.integer(forKey: "native.port")
        api = try! SidecarAPI(port: (1...65535).contains(stored) ? stored : 4317)
        readIDs = Set(UserDefaults.standard.stringArray(forKey: readKey) ?? [])
    }
    func connect(port: Int? = nil) {
        if let port {
            guard let next = try? SidecarAPI(port: port) else { lastError = "请输入 1–65535 之间的端口。"; return }
            api.close(); api = next; UserDefaults.standard.set(port, forKey: "native.port")
            readIDs = Set(UserDefaults.standard.stringArray(forKey: readKey) ?? [])
            lessons = []; knowledge = []; favorites = []; historyRecords = []; historyTotal = 0; openedLesson = nil
            models = []; textPresets = []; status = nil; selectedID = nil
            tracker.reset(); islandLessonID = nil
        }
        connectionTask?.cancel(); generation = UUID()
        let current = api
        let identity = generation
        connectionTask = Task {
            var delay: UInt64 = 1
            while !Task.isCancelled && identity == generation {
                await refresh()
                do {
                    let (bytes, response) = try await current.session.bytes(for: current.request("/api/stream"))
                    guard let response = response as? HTTPURLResponse, response.statusCode == 200,
                          response.value(forHTTPHeaderField: "Content-Type")?.contains("text/event-stream") == true else { throw SidecarError.invalidResponse }
                    delay = 1
                    await refresh() // Fetch again after subscribing to close the initial snapshot gap.
                    var parser = SSEParser()
                    var lineBytes = [UInt8]()
                    for try await byte in bytes {
                        try Task.checkCancellation()
                        if identity != generation { return }
                        if byte == 10 {
                            let line = String(decoding: lineBytes, as: UTF8.self); lineBytes.removeAll(keepingCapacity: true)
                            if parser.feed(line) { await refresh() }
                        } else {
                            lineBytes.append(byte)
                            if lineBytes.count > 16384 { throw SidecarError.invalidResponse }
                        }
                    }
                } catch {
                    if Task.isCancelled || identity != generation { return }
                    connected = false
                }
                try? await Task.sleep(nanoseconds: delay * 1_000_000_000)
                delay = min(delay * 2, 15)
            }
        }
    }
    func refresh() async {
        if refreshing { refreshAgain = true; return }
        refreshing = true
        defer { refreshing = false }
        repeat {
            refreshAgain = false
            let current = api; let identity = generation
            do {
                async let s = current.get("/api/status", as: Status.self)
                async let e = current.get("/api/events?limit=150", as: EventList.self)
                async let k = current.get("/api/knowledge", as: KnowledgeList.self)
                async let m = current.get("/api/models", as: ModelList.self)
                let (st, events, words, configs) = try await (s, e, k, m)
                let favs = try? await current.get("/api/favorites", as: FavoriteList.self)
                guard identity == generation else { refreshAgain = true; continue }
                status = st; lessons = events.events; knowledge = words.knowledge; models = configs.models
                if let favs { favorites = favs.favorites }
                historyRevision &+= 1
                textPresets = configs.textPresets ?? []
                activeTextID = configs.activeTextId; activeSpeechID = configs.activeSpeechId
                connected = true
                let fresh = tracker.observe(lessons)
                if !islandInteracting, let id = fresh.first { islandLessonID = id }
            } catch {
                if identity == generation { connected = false }
            }
        } while refreshAgain
    }
    @discardableResult func mutate(_ path: String, method: String = "POST", body: [String: Any]? = nil) async -> Bool {
        do { _ = try await api.data(path, method: method, body: body); await refresh(); return true }
        catch { lastError = error.localizedDescription; return false }
    }
    func markRead(_ id: String) {
        readIDs.insert(id)
        if readIDs.count > 5000 { readIDs = Set(lessons.map(\.id)).intersection(readIDs) }
        UserDefaults.standard.set(Array(readIDs), forKey: readKey)
    }
    func openLesson(_ id: String?) {
        section = "feed"
        if let id, LessonHistory.needsFilterReset(for: id, lessons: lessons, agent: historyAgent, query: historyQuery) {
            clearHistoryFilters()
        }
        selectedID = id
        if let id { markRead(id) }
        revealMain?()
    }
    func startEngine() async {
        do { try await engine.start(port: api.endpoint.port); connect() }
        catch { lastError = error.localizedDescription }
    }
    func shutdown() async { connectionTask?.cancel(); api.close(); speech.stop(); await engine.stop() }
}
