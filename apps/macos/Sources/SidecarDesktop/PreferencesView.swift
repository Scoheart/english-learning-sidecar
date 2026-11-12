import SwiftUI
import AppKit
import ServiceManagement
import SidecarCore

struct PreferencesView: View {
    @ObservedObject var store: DesktopStore
    var body: some View {
        TabView {
            GeneralPreferences(store: store, engine: store.engine).tabItem { Label("通用", systemImage: "slider.horizontal.3") }
            ModelsPreferences(store: store).tabItem { Label("模型", systemImage: "cpu") }
            IntegrationsPreferences(store: store).tabItem { Label("Agent 接入", systemImage: "point.3.connected.trianglepath.dotted") }
        }.padding(12).frame(width: 670, height: 620).preferredColorScheme(store.colorScheme)
        .alert("操作未完成", isPresented: Binding(get: { store.lastError != nil }, set: { if !$0 { store.lastError = nil } })) {
            Button("好", role: .cancel) { store.lastError = nil }
        } message: { Text(store.lastError ?? "") }
    }
}
private struct GeneralPreferences: View {
    @ObservedObject var store: DesktopStore
    @ObservedObject var engine: EngineManager
    @State private var port = "4317"
    @State private var login = SMAppService.mainApp.status == .enabled
    var body: some View {
        Form {
            Section("外观与学习岛") {
                Picker("外观", selection: $store.appearance) { Text("跟随系统").tag("system"); Text("浅色").tag("light"); Text("深色").tag("dark") }
                Toggle("显示悬浮学习岛", isOn: $store.islandEnabled)
                Picker("显示器", selection: $store.islandDisplay) {
                    Text("主显示器").tag("primary")
                    ForEach(Array(NSScreen.screens.enumerated()), id: \.offset) { _, screen in Text(screen.localizedName).tag(displayID(screen)) }
                }
                Picker("学习岛样式", selection: $store.islandPresentation) {
                    ForEach(IslandPresentationMode.allCases, id: \.self) { mode in Text(mode.label).tag(mode) }
                }
                Text("使用 DynamicNotchKit。默认贴顶刘海；无刘海显示器也可选择贴顶，或切换为浮动胶囊。隐藏小岛不会停止采集。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("本地学习服务") {
                HStack {
                    Text("127.0.0.1 :")
                    TextField("端口", text: $port).frame(width: 85).disabled(engine.owned)
                    Button("连接") { store.connect(port: Int(port) ?? 0) }.disabled(engine.owned)
                }
                Text(engine.message).font(.caption).foregroundStyle(.secondary)
                HStack {
                    EngineStartButton(store: store, engine: engine)
                    Button("停止内置引擎") { Task { await engine.stop(); await store.refresh() } }.disabled(!engine.owned)
                }
                Text("只停止本 App 启动的引擎。已有 Web 服务、数据和模型配置保持共用。").font(.caption).foregroundStyle(.secondary)
                Toggle("暂停采集", isOn: Binding(get: { store.status?.paused ?? false }, set: { paused in Task { await store.mutate("/api/settings", body: ["paused": paused]) } })).disabled(!store.connected)
                Text("暂停采集会忽略新输入，不只是关闭提醒。").font(.caption).foregroundStyle(.secondary)
            }
            Section("启动与权限") {
                Toggle("登录后启动", isOn: Binding(get: { login }, set: { enabled in
                    do { if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }; login = SMAppService.mainApp.status == .enabled }
                    catch { store.lastError = error.localizedDescription }
                }))
                Text("退出 App 会停止它启动的引擎；关闭主窗口则保留菜单栏和小岛。没有键盘监听或屏幕录制。").font(.caption).foregroundStyle(.secondary)
            }
        }.formStyle(.grouped).onAppear { port = String(store.api.endpoint.port) }
    }
}
private struct ModelsPreferences: View {
    @ObservedObject var store: DesktopStore
    @State private var editing: ModelDraft?
    @State private var deleting: SafeModel?
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Text("模型配置").font(.title2.weight(.semibold)); Spacer(); Button("添加模型", systemImage: "plus") { editing = ModelDraft() }.disabled(!store.connected) }
            Text("与 Web 共用已有模型配置。API Key 仍由学习引擎保存在本机 models.json，本版不迁移到 Keychain。").font(.caption).foregroundStyle(.secondary)
            List {
                ForEach(store.models) { model in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(model.name).fontWeight(.medium)
                            Text("\(model.kind == "speech" ? "语音" : "文字") · \(model.model)").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if model.id == store.activeTextID || model.id == store.activeSpeechID { Image(systemName: "checkmark.circle.fill").help("当前模型") }
                        else { Button("启用") { Task { await store.mutate("/api/models/\(model.id)/active") } } }
                        Button { editing = ModelDraft(model) } label: { Image(systemName: "pencil") }.help("编辑")
                        Button(role: .destructive) { deleting = model } label: { Image(systemName: "trash") }.help("删除")
                    }.padding(.vertical, 6)
                }
            }.listStyle(.inset)
        }.padding(16)
        .sheet(item: $editing) { ModelEditor(store: store, draft: $0) }
        .confirmationDialog("删除模型？这会同时影响 Web 的模型配置。", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("删除", role: .destructive) { if let model = deleting { Task { await store.mutate("/api/models/\(model.id)", method: "DELETE"); deleting = nil } } }
        }
    }
}
private struct ModelDraft: Identifiable, Equatable {
    let id = UUID()
    var modelID: String?
    var name = ""
    var kind = "text"
    var baseURL = "https://api.openai.com/v1"
    var model = ""
    var voice = "alloy"
    var authMode = "bearer"
    var resetTemperature = false
    var key = ""
    var clearKey = false

    init() {}
    init(_ source: SafeModel) {
        modelID = source.id
        name = source.name
        kind = source.kind
        baseURL = source.baseUrl
        model = source.model
        voice = source.voice ?? "alloy"
        authMode = source.authMode ?? "bearer"
    }

    var canSubmit: Bool {
        [name, baseURL, model].allSatisfy { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    var payload: [String: Any] {
        var body: [String: Any] = ["name": name, "kind": kind, "baseUrl": baseURL, "model": model]
        if kind == "speech" { body["voice"] = voice }
        else {
            body["authMode"] = authMode
            if resetTemperature { body["temperature"] = NSNull() }
        }
        if clearKey || (kind == "text" && authMode == "none") { body["apiKey"] = "" }
        else if modelID == nil || !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { body["apiKey"] = key }
        return body
    }

    mutating func changeEndpoint(_ url: String) {
        if baseURL.trimmingCharacters(in: .whitespacesAndNewlines) != url.trimmingCharacters(in: .whitespacesAndNewlines) {
            key = ""
        }
        baseURL = url
    }

    mutating func apply(_ preset: TextModelPreset) {
        if baseURL != preset.baseUrl {
            name = preset.name
            model = ""
        } else if name.isEmpty {
            name = preset.name
        }
        baseURL = preset.baseUrl
        authMode = preset.authMode
        resetTemperature = true
        key = ""
        clearKey = false
    }
}

private struct ModelEditor: View {
    @ObservedObject var store: DesktopStore
    @Environment(\.dismiss) private var dismiss
    @State var draft: ModelDraft
    @State private var saving = false
    @State private var errorText: String?
    @State private var testMessage: String?
    @State private var testTask: Task<Void, Never>?

    private var busy: Bool { saving || testTask != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(draft.modelID == nil ? "添加模型" : "编辑模型").font(.title2.weight(.semibold))
            Form {
                Picker("类型", selection: $draft.kind) {
                    Text("文字分析").tag("text")
                    Text("语音合成").tag("speech")
                }.disabled(draft.modelID != nil)
                if draft.kind == "text", !store.textPresets.isEmpty {
                    Menu("服务商预设") {
                        ForEach(store.textPresets) { preset in
                            Button(preset.name) { draft.apply(preset) }
                        }
                    }
                }
                TextField("名称", text: $draft.name)
                TextField("Base URL", text: Binding(get: { draft.baseURL }, set: { draft.changeEndpoint($0) }))
                TextField("模型 ID", text: $draft.model)
                if draft.kind == "speech" {
                    TextField("Voice", text: $draft.voice)
                } else {
                    Picker("认证", selection: $draft.authMode) {
                        Text("API Key").tag("bearer")
                        Text("本机免密（仅回环地址）").tag("none")
                    }
                }
                if draft.kind == "speech" || draft.authMode != "none" {
                    SecureField(draft.modelID == nil ? "API Key" : "API Key · 留空保留", text: $draft.key)
                        .disabled(draft.clearKey)
                    if draft.modelID != nil { Toggle("清除现有 Key", isOn: $draft.clearKey) }
                }
            }.disabled(busy)
            if let errorText { Text(errorText).font(.caption).foregroundStyle(.red) }
            if let testMessage { Text(testMessage).font(.caption).textSelection(.enabled) }
            HStack {
                if draft.kind == "text" {
                    Button(testTask == nil ? "测试模型" : "测试中…", action: testModel)
                        .disabled(busy || !draft.canSubmit)
                        .help("发送一句固定样例，生成学习卡，不保存测试记录。")
                }
                Spacer()
                Button("取消") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(saving ? "保存中…" : "保存", action: saveModel)
                    .keyboardShortcut(.defaultAction).disabled(busy || !draft.canSubmit)
            }
        }.padding(24).frame(width: 490)
            .onChange(of: draft) { errorText = nil; testMessage = nil }
            .onDisappear { testTask?.cancel() }
    }

    private func testModel() {
        var body = draft.payload
        if let id = draft.modelID { body["id"] = id }
        let api = store.api
        errorText = nil
        testMessage = nil
        testTask = Task {
            defer { testTask = nil }
            do {
                let data = try await api.data("/api/models/test", method: "POST", body: body, timeout: 190)
                let result = try JSONDecoder().decode(ModelTestResult.self, from: data)
                if !Task.isCancelled { testMessage = "样例翻译 · \(result.translation)" }
            } catch {
                if !Task.isCancelled { errorText = error.localizedDescription }
            }
        }
    }

    private func saveModel() {
        saving = true
        let path = draft.modelID.map { "/api/models/\($0)" } ?? "/api/models"
        let method = draft.modelID == nil ? "POST" : "PATCH"
        let body = draft.payload
        Task {
            let ok = await store.mutate(path, method: method, body: body)
            saving = false
            if ok { dismiss() }
            else { errorText = store.lastError; store.lastError = nil }
        }
    }
}
private struct IntegrationsPreferences: View {
    @ObservedObject var store: DesktopStore
    @State private var agent = "codex"
    @State private var project: URL?
    @State private var userScope = true
    @State private var confirm = false
    @State private var installed: String?
    var body: some View {
        Form {
            Section("安装原生 Hook") {
                Picker("Agent", selection: $agent) { Text("Codex").tag("codex"); Text("Cursor").tag("cursor"); Text("Claude Code").tag("claude"); Text("Grok Build").tag("grok") }
                Toggle("用户级配置 · 所有项目", isOn: $userScope)
                if !userScope {
                    HStack {
                        Text(project?.lastPathComponent ?? "尚未选择项目")
                        Button("选择文件夹…") { let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false; if panel.runModal() == .OK { project = panel.url } }
                    }
                }
                Text("请先将 App 放到固定位置，例如 /Applications。安装会追加 Hook 并备份已有文件，不修改 Agent Prompt。移动 App 后需重新安装 Hook。").font(.caption).foregroundStyle(.secondary)
                Button("安装 Hook…") { confirm = true }.disabled(!userScope && project == nil)
                if let installed { Text(installed).font(.caption).textSelection(.enabled) }
            }
            Section("验证接入") {
                Text("配置写入成功不等于 Agent 已启用。请在 Agent 中信任该 Hook，并发送一次自然语言提问，再检查学习记录中的来源。").font(.callout)
                Text("Pi 可继续使用仓库现有 Extension；本面板暂不自动安装 Pi、DSH 或 Qoder。Hook 需要本地引擎正在运行。").font(.caption).foregroundStyle(.secondary)
            }
        }.formStyle(.grouped)
        .confirmationDialog("允许追加 \(agent) 的 Hook 配置？", isPresented: $confirm) {
            Button("备份并安装") {
                do {
                    let directory = userScope ? FileManager.default.homeDirectoryForCurrentUser : project!
                    let file = try HookInstaller.install(agent: agent, directory: directory, port: store.api.endpoint.port)
                    installed = "已写入 \(file.path)\n请用一次真实 Agent 提问验证。"
                } catch { store.lastError = error.localizedDescription }
            }
        }
    }
}
