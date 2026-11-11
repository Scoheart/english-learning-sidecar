import SwiftUI
import AppKit
import SidecarCore

@MainActor final class DesktopStore: ObservableObject {
    @Published var status: Status?
    @Published var lessons: [Lesson] = []
    @Published var knowledge: [Knowledge] = []
    @Published var models: [SafeModel] = []
    @Published var activeTextID: String?
    @Published var activeSpeechID: String?
    @Published var selectedID: String?
    @Published var section: String? = "feed"
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
    var selectedLesson: Lesson? { lessons.first { $0.id == selectedID } }
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
            lessons = []; knowledge = []; models = []; status = nil; selectedID = nil
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
                guard identity == generation else { refreshAgain = true; continue }
                status = st; lessons = events.events; knowledge = words.knowledge; models = configs.models
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
    func openLesson(_ id: String?) { section = "feed"; selectedID = id; if let id { markRead(id) }; revealMain?() }
    func startEngine() async {
        do { try await engine.start(port: api.endpoint.port); connect() }
        catch { lastError = error.localizedDescription }
    }
    func shutdown() async { connectionTask?.cancel(); api.close(); speech.stop(); await engine.stop() }
}
