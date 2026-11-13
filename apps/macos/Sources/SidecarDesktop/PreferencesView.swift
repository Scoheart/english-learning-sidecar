import SwiftUI
import AppKit
import ServiceManagement
import SidecarCore

struct PreferencesView: View {
    @ObservedObject var store: DesktopStore
    @State private var selectedTab = "general"

    var body: some View {
        VStack(spacing: 0) {
            // Studio Header & Tab Bar
            HStack(spacing: 14) {
                HStack(spacing: 9) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(StudioPalette.primary)
                            .frame(width: 28, height: 28)
                        Image(systemName: "slider.horizontal.3")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(StudioPalette.primaryForeground)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Preferences · 偏好设置")
                            .font(StudioFont.ui(size: 14, weight: .semibold))
                            .foregroundStyle(StudioPalette.foreground)
                        Text("与 Web 端共享本地 SQLite 数据、采集策略与模型配置")
                            .font(StudioFont.ui(size: 11))
                            .foregroundStyle(StudioPalette.mutedForeground)
                    }
                }

                Spacer()

                StudioSegmentedTabs(
                    selection: $selectedTab,
                    options: [
                        StudioTabOption(id: "general", title: "通用与采集", icon: "slider.horizontal.3"),
                        StudioTabOption(id: "models", title: "模型配置", icon: "cpu"),
                        StudioTabOption(id: "integrations", title: "Agent 接入", icon: "point.3.connected.trianglepath.dotted")
                    ],
                    fullWidth: false,
                    compact: true
                )
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 14)
            .background(StudioPalette.sidebarBackground)

            Rectangle()
                .fill(StudioPalette.border)
                .frame(height: 1)

            Group {
                switch selectedTab {
                case "models":
                    ModelsPreferences(store: store)
                case "integrations":
                    IntegrationsPreferences(store: store)
                default:
                    GeneralPreferences(store: store, engine: store.engine)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(StudioPalette.stageBackground)
        }
        .frame(width: 720, height: 640)
        .background(DesktopAppearance(colorScheme: store.colorScheme).frame(width: 0, height: 0))
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
}

// MARK: - Tab 1: General & Capture Policy Preferences

private struct GeneralPreferences: View {
    @ObservedObject var store: DesktopStore
    @ObservedObject var engine: EngineManager
    @State private var port = "4317"
    @State private var login = SMAppService.mainApp.status == .enabled
    @State private var captureMode = "all"
    @State private var allowedProjectsText = ""
    @State private var excludedProjectsText = ""
    @State private var savingPolicy = false
    @State private var policySaved = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // 1. Appearance & Learning Island
                StudioSurfaceCard(topStripe: .solid(.indigo), padding: 18, spacing: 12, hoverable: false) {
                    Text("外观与灵动学习岛 · Appearance & Island")
                        .font(StudioFont.ui(size: 13.5, weight: .semibold))
                        .foregroundStyle(StudioPalette.foreground)

                    HStack {
                        Text("界面主题")
                            .font(StudioFont.ui(size: 12.5, weight: .medium))
                            .foregroundStyle(StudioPalette.foreground)
                        Spacer()
                        StudioSegmentedTabs(
                            selection: $store.appearance,
                            options: [
                                StudioTabOption(id: "system", title: "跟随系统"),
                                StudioTabOption(id: "light", title: "浅色 Alabaster"),
                                StudioTabOption(id: "dark", title: "深色 Slate")
                            ],
                            fullWidth: false,
                            compact: true
                        )
                    }

                    Divider().overlay(StudioPalette.border.opacity(0.6))

                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("显示悬浮学习岛")
                                .font(StudioFont.ui(size: 12.5, weight: .medium))
                                .foregroundStyle(StudioPalette.foreground)
                            Text("默认贴顶刘海；无刘海显示器也可贴顶或切换为浮动胶囊。隐藏小岛不会停止后台采集。")
                                .font(StudioFont.ui(size: 11))
                                .foregroundStyle(StudioPalette.mutedForeground)
                        }
                        Spacer()
                        Toggle("", isOn: $store.islandEnabled)
                            .labelsHidden()
                            .toggleStyle(.switch)
                    }

                    HStack(spacing: 16) {
                        HStack(spacing: 8) {
                            Text("呈现样式")
                                .font(StudioFont.ui(size: 12))
                                .foregroundStyle(StudioPalette.mutedForeground)
                            Picker("学习岛样式", selection: $store.islandPresentation) {
                                ForEach(IslandPresentationMode.allCases, id: \.self) { mode in
                                    Text(mode.label).tag(mode)
                                }
                            }
                            .labelsHidden()
                            .frame(width: 155)
                        }

                        HStack(spacing: 8) {
                            Text("目标显示器")
                                .font(StudioFont.ui(size: 12))
                                .foregroundStyle(StudioPalette.mutedForeground)
                            Picker("显示器", selection: $store.islandDisplay) {
                                Text("主显示器").tag("primary")
                                ForEach(Array(NSScreen.screens.enumerated()), id: \.offset) { _, screen in
                                    Text(screen.localizedName).tag(displayID(screen))
                                }
                            }
                            .labelsHidden()
                            .frame(width: 170)
                        }
                    }
                }

                // 2. Prompt Capture & Project Scope (Aligned with Web Settings Dialog)
                StudioSurfaceCard(topStripe: .solid(.emerald), padding: 18, spacing: 12, hoverable: false) {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("提示采集与项目范围 · Capture Policy")
                                .font(StudioFont.ui(size: 13.5, weight: .semibold))
                                .foregroundStyle(StudioPalette.foreground)
                            Text("监听本机编码助手 Hook；可按项目绝对路径设置允许或排除名单。")
                                .font(StudioFont.ui(size: 11))
                                .foregroundStyle(StudioPalette.mutedForeground)
                        }
                        Spacer()
                        HStack(spacing: 8) {
                            Text(store.status?.paused == true ? "已暂停" : "采集中")
                                .font(StudioFont.ui(size: 11.5, weight: .medium))
                                .foregroundStyle(store.status?.paused == true ? StudioAccent.amber.text : StudioAccent.emerald.text)
                            Toggle(
                                "",
                                isOn: Binding(
                                    get: { !(store.status?.paused ?? false) },
                                    set: { active in
                                        Task { await store.mutate("/api/settings", body: ["paused": !active]) }
                                    }
                                )
                            )
                            .labelsHidden()
                            .toggleStyle(.switch)
                            .disabled(!store.connected)
                        }
                    }

                    Divider().overlay(StudioPalette.border.opacity(0.6))

                    HStack {
                        Text("项目采集范围")
                            .font(StudioFont.ui(size: 12, weight: .medium))
                            .foregroundStyle(StudioPalette.foreground)
                        Spacer()
                        StudioSegmentedTabs(
                            selection: $captureMode,
                            options: [
                                StudioTabOption(id: "all", title: "所有项目（排除名单除外）"),
                                StudioTabOption(id: "allowlist", title: "仅允许名单")
                            ],
                            fullWidth: false,
                            compact: true
                        )
                    }

                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("允许的项目目录（每行一个绝对路径）")
                                .font(StudioFont.ui(size: 11, weight: .medium))
                                .foregroundStyle(StudioPalette.mutedForeground)
                            TextEditor(text: $allowedProjectsText)
                                .font(StudioFont.phonetic(size: 11.5))
                                .frame(height: 62)
                                .padding(6)
                                .background(StudioPalette.background, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                                        .strokeBorder(StudioPalette.border, lineWidth: 1)
                                )
                        }

                        VStack(alignment: .leading, spacing: 5) {
                            Text("排除的项目目录（优先排除）")
                                .font(StudioFont.ui(size: 11, weight: .medium))
                                .foregroundStyle(StudioPalette.mutedForeground)
                            TextEditor(text: $excludedProjectsText)
                                .font(StudioFont.phonetic(size: 11.5))
                                .frame(height: 62)
                                .padding(6)
                                .background(StudioPalette.background, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                                        .strokeBorder(StudioPalette.border, lineWidth: 1)
                                )
                        }
                    }

                    HStack {
                        Text("排除名单优先级高于允许名单；修改后点击右侧保存同步至本地引擎。")
                            .font(StudioFont.ui(size: 11))
                            .foregroundStyle(StudioPalette.mutedForeground)
                        Spacer()
                        StudioActionButton(
                            label: policySaved ? "已保存" : (savingPolicy ? "保存中…" : "保存采集范围"),
                            icon: policySaved ? "checkmark" : "square.and.arrow.down",
                            variant: .primary,
                            small: true,
                            disabled: !store.connected || savingPolicy
                        ) {
                            saveCapturePolicy()
                        }
                    }
                }

                // 3. Local Engine & Startup
                StudioSurfaceCard(topStripe: .solid(.sky), padding: 18, spacing: 12, hoverable: false) {
                    Text("本地学习服务与启动 · Local Engine & Startup")
                        .font(StudioFont.ui(size: 13.5, weight: .semibold))
                        .foregroundStyle(StudioPalette.foreground)

                    HStack(spacing: 10) {
                        Text("回环地址")
                            .font(StudioFont.ui(size: 12, weight: .medium))
                            .foregroundStyle(StudioPalette.foreground)
                        Text("127.0.0.1 :")
                            .font(StudioFont.phonetic(size: 12))
                            .foregroundStyle(StudioPalette.mutedForeground)
                        TextField("端口", text: $port)
                            .textFieldStyle(.roundedBorder)
                            .font(StudioFont.phonetic(size: 12))
                            .frame(width: 84)
                            .disabled(engine.owned)
                        StudioActionButton(
                            label: "连接端口",
                            icon: "link",
                            variant: .outline,
                            small: true,
                            disabled: engine.owned
                        ) {
                            store.connect(port: Int(port) ?? 0)
                        }

                        Spacer()

                        EngineStartButton(store: store, engine: engine)

                        StudioActionButton(
                            label: "停止内置引擎",
                            icon: "stop.fill",
                            variant: .outline,
                            small: true,
                            disabled: !engine.owned
                        ) {
                            Task {
                                await engine.stop()
                                await store.refresh()
                            }
                        }
                    }

                    Text(engine.message)
                        .font(StudioFont.ui(size: 11))
                        .foregroundStyle(StudioPalette.mutedForeground)

                    Divider().overlay(StudioPalette.border.opacity(0.6))

                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("登录 macOS 后自动启动")
                                .font(StudioFont.ui(size: 12.5, weight: .medium))
                                .foregroundStyle(StudioPalette.foreground)
                            Text("关闭主窗口仍保留菜单栏与学习岛；无键盘监听或屏幕录制。")
                                .font(StudioFont.ui(size: 11))
                                .foregroundStyle(StudioPalette.mutedForeground)
                        }
                        Spacer()
                        Toggle(
                            "",
                            isOn: Binding(
                                get: { login },
                                set: { enabled in
                                    do {
                                        if enabled { try SMAppService.mainApp.register() }
                                        else { try SMAppService.mainApp.unregister() }
                                        login = SMAppService.mainApp.status == .enabled
                                    } catch {
                                        store.lastError = error.localizedDescription
                                    }
                                }
                            )
                        )
                        .labelsHidden()
                        .toggleStyle(.switch)
                    }
                }
            }
            .padding(20)
        }
        .onAppear {
            port = String(store.api.endpoint.port)
            syncCapturePolicyFromStore()
        }
        .onChange(of: store.status?.capturePolicy) { _, _ in
            syncCapturePolicyFromStore()
        }
    }

    private func syncCapturePolicyFromStore() {
        guard let policy = store.status?.capturePolicy else { return }
        captureMode = policy.mode
        allowedProjectsText = policy.allowedProjects.joined(separator: "\n")
        excludedProjectsText = policy.excludedProjects.joined(separator: "\n")
    }

    private func saveCapturePolicy() {
        savingPolicy = true
        let allowed = allowedProjectsText
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let excluded = excludedProjectsText
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        Task {
            let ok = await store.mutate(
                "/api/settings",
                body: [
                    "capturePolicy": [
                        "mode": captureMode,
                        "allowedProjects": allowed,
                        "excludedProjects": excluded
                    ]
                ]
            )
            savingPolicy = false
            if ok {
                policySaved = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) { policySaved = false }
            }
        }
    }
}

// MARK: - Tab 2: Models Preferences (Aligned with Web Multi-Model Settings)

private struct ModelsPreferences: View {
    @ObservedObject var store: DesktopStore
    @State private var modelKindTab = "text"
    @State private var editing: ModelDraft?
    @State private var deleting: SafeModel?

    private var activeTextModel: SafeModel? {
        store.models.first { $0.id == store.activeTextID && $0.kind == "text" } ?? store.status?.activeTextModel
    }
    private var activeSpeechModel: SafeModel? {
        store.models.first { $0.id == store.activeSpeechID && $0.kind == "speech" } ?? store.status?.activeSpeechModel
    }
    private var filteredModels: [SafeModel] {
        store.models.filter { $0.kind == modelKindTab }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Active Engine Summary Card
                StudioSurfaceCard(topStripe: .heroGradient, padding: 16, spacing: 10, hoverable: false) {
                    HStack(alignment: .center) {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 8) {
                                Text("Model Engine · 当前模型引擎")
                                    .font(StudioFont.ui(size: 13.5, weight: .semibold))
                                    .foregroundStyle(StudioPalette.foreground)
                                StudioBadge(
                                    text: store.status?.mode == "live" ? "LIVE" : "未配置",
                                    style: store.status?.mode == "live" ? .accent(.emerald) : .secondary
                                )
                            }
                            Text(
                                activeTextModel.map { "文本分析：\($0.name) (\($0.model))" }
                                    ?? "尚未接入文本模型；配置并启用后队列中的提示会自动开始分析。"
                            )
                            .font(StudioFont.ui(size: 11.5))
                            .foregroundStyle(StudioPalette.mutedForeground)
                        }
                        Spacer()
                        StudioBadge(
                            text: activeSpeechModel.map { "TTS: \($0.name)" } ?? "TTS: 系统语音",
                            style: .dashedOutline
                        )
                    }
                }

                // Filter + Add Model Bar
                HStack {
                    StudioSegmentedTabs(
                        selection: $modelKindTab,
                        options: [
                            StudioTabOption(
                                id: "text",
                                title: "Text Models",
                                count: store.models.filter { $0.kind == "text" }.count
                            ),
                            StudioTabOption(
                                id: "speech",
                                title: "TTS Models",
                                count: store.models.filter { $0.kind == "speech" }.count
                            )
                        ],
                        fullWidth: false,
                        compact: true
                    )

                    Spacer()

                    StudioActionButton(
                        label: modelKindTab == "text" ? "Add Text Model" : "Add TTS Model",
                        icon: "plus",
                        variant: .primary,
                        small: true,
                        disabled: !store.connected
                    ) {
                        var draft = ModelDraft()
                        draft.kind = modelKindTab
                        draft.model = modelKindTab == "text" ? "gpt-4o-mini" : "tts-1"
                        editing = draft
                    }
                }

                if filteredModels.isEmpty {
                    StudioSurfaceCard(padding: 28, spacing: 8, hoverable: false) {
                        VStack(spacing: 8) {
                            Image(systemName: modelKindTab == "text" ? "cpu" : "waveform")
                                .font(.system(size: 20))
                                .foregroundStyle(StudioPalette.mutedForeground)
                            Text(modelKindTab == "text" ? "尚未添加文本分析模型" : "尚未添加远程 TTS 语音模型")
                                .font(StudioFont.ui(size: 13, weight: .semibold))
                                .foregroundStyle(StudioPalette.foreground)
                            Text(
                                modelKindTab == "text"
                                    ? "点击右上角 Add Text Model 接入 OpenAI 兼容接口或本机回环模型。"
                                    : "未配置远程 TTS 时，朗读功能会自动使用 macOS 系统英文语音。"
                            )
                            .font(StudioFont.ui(size: 11.5))
                            .foregroundStyle(StudioPalette.mutedForeground)
                        }
                        .frame(maxWidth: .infinity)
                    }
                } else {
                    VStack(spacing: 10) {
                        ForEach(filteredModels) { model in
                            let isActive = model.id == store.activeTextID || model.id == store.activeSpeechID
                            StudioSurfaceCard(
                                leftStripe: isActive ? .emerald : nil,
                                padding: 15,
                                spacing: 8,
                                hoverable: true
                            ) {
                                HStack(alignment: .center, spacing: 10) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        HStack(spacing: 7) {
                                            Text(model.name)
                                                .font(StudioFont.ui(size: 13.5, weight: .semibold))
                                                .foregroundStyle(StudioPalette.foreground)
                                            if isActive {
                                                StudioBadge(text: "Active · 当前启用", dotColor: StudioAccent.emerald.solid, style: .accent(.emerald))
                                            }
                                            if model.authMode == "none" {
                                                StudioBadge(text: "免密回环", style: .accent(.sky))
                                            } else if model.apiKeySet == true {
                                                StudioBadge(text: model.apiKeyMasked ?? "已配置 Key", style: .secondary, monospaced: true)
                                            }
                                        }

                                        HStack(spacing: 6) {
                                            Text(model.model)
                                                .font(StudioFont.phonetic(size: 11.5, weight: .semibold))
                                                .foregroundStyle(StudioAccent.indigo.text)
                                            Text("·")
                                                .foregroundStyle(StudioPalette.mutedForeground)
                                            Text(model.baseUrl)
                                                .font(StudioFont.phonetic(size: 11))
                                                .foregroundStyle(StudioPalette.mutedForeground)
                                                .lineLimit(1)
                                            if model.kind == "speech", let voice = model.voice, !voice.isEmpty {
                                                Text("· Voice: \(voice)")
                                                    .font(StudioFont.phonetic(size: 11))
                                                    .foregroundStyle(StudioPalette.mutedForeground)
                                            }
                                        }
                                    }

                                    Spacer()

                                    HStack(spacing: 6) {
                                        if !isActive {
                                            StudioActionButton(
                                                label: "启用",
                                                icon: "checkmark.circle",
                                                variant: .outline,
                                                small: true
                                            ) {
                                                Task { await store.mutate("/api/models/\(model.id)/active") }
                                            }
                                        }
                                        StudioActionButton(
                                            label: "编辑",
                                            icon: "pencil",
                                            variant: .ghost,
                                            small: true
                                        ) {
                                            editing = ModelDraft(model)
                                        }
                                        StudioActionButton(
                                            label: nil,
                                            icon: "trash",
                                            variant: .ghost,
                                            small: true,
                                            helpText: "删除模型"
                                        ) {
                                            deleting = model
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .padding(20)
        }
        .sheet(item: $editing) { ModelEditor(store: store, draft: $0) }
        .confirmationDialog(
            "删除模型配置？这会同时影响 Web 端的模型列表。",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })
        ) {
            Button("删除模型", role: .destructive) {
                if let model = deleting {
                    Task {
                        await store.mutate("/api/models/\(model.id)", method: "DELETE")
                        deleting = nil
                    }
                }
            }
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
    var voice = "marin"
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
        voice = source.voice ?? "marin"
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
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(draft.modelID == nil ? "添加模型配置" : "编辑模型配置")
                        .font(StudioFont.ui(size: 16, weight: .semibold))
                        .foregroundStyle(StudioPalette.foreground)
                    Text("远程接口须使用 HTTPS；本机回环地址支持 HTTP 与免密连接。")
                        .font(StudioFont.ui(size: 11.5))
                        .foregroundStyle(StudioPalette.mutedForeground)
                }
                Spacer()
                if draft.kind == "text", !store.textPresets.isEmpty {
                    Menu {
                        ForEach(store.textPresets) { preset in
                            Button(preset.name) { draft.apply(preset) }
                        }
                    } label: {
                        Label("服务商预设", systemImage: "sparkles")
                            .font(StudioFont.ui(size: 11.5, weight: .medium))
                    }
                    .disabled(busy)
                }
            }

            Form {
                Picker("模型类型", selection: $draft.kind) {
                    Text("文字分析 (Text)").tag("text")
                    Text("语音合成 (TTS)").tag("speech")
                }
                .disabled(draft.modelID != nil)

                TextField("显示名称 (Display Name)", text: $draft.name)
                TextField("模型标识 (Model ID)", text: $draft.model)
                    .font(StudioFont.phonetic(size: 12))
                TextField("Base URL", text: Binding(get: { draft.baseURL }, set: { draft.changeEndpoint($0) }))
                    .font(StudioFont.phonetic(size: 12))

                if draft.kind == "speech" {
                    TextField("Voice (如 marin / alloy)", text: $draft.voice)
                        .font(StudioFont.phonetic(size: 12))
                } else {
                    Picker("认证方式", selection: $draft.authMode) {
                        Text("Bearer API Key").tag("bearer")
                        Text("本机免密（仅回环地址）").tag("none")
                    }
                }

                if draft.kind == "speech" || draft.authMode != "none" {
                    SecureField(draft.modelID == nil ? "API Key (sk-...)" : "API Key · 留空保留现有密钥", text: $draft.key)
                        .font(StudioFont.phonetic(size: 12))
                        .disabled(draft.clearKey)
                    if draft.modelID != nil {
                        Toggle("清除现有 API Key", isOn: $draft.clearKey)
                    }
                }
            }
            .formStyle(.grouped)
            .disabled(busy)

            if let errorText {
                StudioCalloutBlock(title: "连接或保存失败", text: errorText, accent: .rose, enclosedBox: true)
            }
            if let testMessage {
                StudioCalloutBlock(title: "模型连通性验证通过", text: testMessage, accent: .emerald, enclosedBox: true)
            }

            HStack(spacing: 10) {
                if draft.kind == "text" {
                    StudioActionButton(
                        label: testTask == nil ? "测试模型连通性" : "正在测试…",
                        icon: "antenna.radiowaves.left.and.right",
                        variant: .outline,
                        disabled: busy || !draft.canSubmit,
                        helpText: "发送固定测试短句验证接口与模型配置"
                    ) {
                        testModel()
                    }
                }
                Spacer()
                StudioActionButton(label: "取消", variant: .ghost, disabled: saving) {
                    dismiss()
                }
                StudioActionButton(
                    label: saving ? "保存中…" : "保存配置",
                    icon: "checkmark",
                    variant: .primary,
                    disabled: busy || !draft.canSubmit
                ) {
                    saveModel()
                }
            }
        }
        .padding(22)
        .frame(width: 520)
        .background(StudioPalette.background)
        .onChange(of: draft) { _, _ in
            errorText = nil
            testMessage = nil
        }
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

// MARK: - Tab 3: Agent Hook Integrations Preferences

private struct IntegrationsPreferences: View {
    @ObservedObject var store: DesktopStore
    @State private var agent = "codex"
    @State private var project: URL?
    @State private var userScope = true
    @State private var confirm = false
    @State private var installed: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                StudioSurfaceCard(topStripe: .solid(.indigo), padding: 18, spacing: 14, hoverable: false) {
                    Text("安装原生 Agent Hook · Native Hook Installer")
                        .font(StudioFont.ui(size: 13.5, weight: .semibold))
                        .foregroundStyle(StudioPalette.foreground)

                    Text("将本 App 置于固定目录（如 /Applications）后，可一键向编码助手写入无阻塞提示采集 Hook。安装前会自动备份原有配置文件。")
                        .font(StudioFont.ui(size: 11.5))
                        .foregroundStyle(StudioPalette.mutedForeground)
                        .lineSpacing(2.5)

                    HStack {
                        Text("目标编码助手")
                            .font(StudioFont.ui(size: 12.5, weight: .medium))
                            .foregroundStyle(StudioPalette.foreground)
                        Spacer()
                        StudioSegmentedTabs(
                            selection: $agent,
                            options: [
                                StudioTabOption(id: "codex", title: "Codex"),
                                StudioTabOption(id: "claude", title: "Claude Code"),
                                StudioTabOption(id: "cursor", title: "Cursor"),
                                StudioTabOption(id: "grok", title: "Grok Build")
                            ],
                            fullWidth: false,
                            compact: true
                        )
                    }

                    Divider().overlay(StudioPalette.border.opacity(0.6))

                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("用户级全局配置（对所有项目生效）")
                                .font(StudioFont.ui(size: 12.5, weight: .medium))
                                .foregroundStyle(StudioPalette.foreground)
                            Text("关闭后可指定单个项目目录写入项目级 Hook 配置。")
                                .font(StudioFont.ui(size: 11))
                                .foregroundStyle(StudioPalette.mutedForeground)
                        }
                        Spacer()
                        Toggle("", isOn: $userScope)
                            .labelsHidden()
                            .toggleStyle(.switch)
                    }

                    if !userScope {
                        HStack(spacing: 10) {
                            Image(systemName: "folder")
                                .foregroundStyle(StudioPalette.primary)
                            Text(project?.path ?? "尚未选择项目目录")
                                .font(StudioFont.phonetic(size: 11.5))
                                .foregroundStyle(StudioPalette.foreground)
                                .lineLimit(1)
                            Spacer()
                            StudioActionButton(label: "选择文件夹…", icon: "folder.badge.plus", variant: .outline, small: true) {
                                let panel = NSOpenPanel()
                                panel.canChooseDirectories = true
                                panel.canChooseFiles = false
                                panel.allowsMultipleSelection = false
                                if panel.runModal() == .OK { project = panel.url }
                            }
                        }
                        .padding(10)
                        .background(StudioPalette.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }

                    HStack {
                        Spacer()
                        StudioActionButton(
                            label: "备份并安装 Hook…",
                            icon: "bolt.badge.checkmark",
                            variant: .primary,
                            disabled: !userScope && project == nil
                        ) {
                            confirm = true
                        }
                    }

                    if let installed {
                        StudioCalloutBlock(title: "Hook 配置已写入", text: installed, accent: .emerald, monospacedText: true, enclosedBox: true)
                    }
                }

                StudioSurfaceCard(leftStripe: .amber, tint: .amber, padding: 16, spacing: 8, hoverable: false) {
                    Text("验证接入说明 · VERIFICATION GUIDE")
                        .font(StudioFont.ui(size: 10.5, weight: .bold))
                        .tracking(0.5)
                        .foregroundStyle(StudioAccent.amber.text)
                    Text("配置写入成功不等于 Agent 已启用。请在对应编码助手中信任该 Hook，随后发送一次自然语言提问，并在左侧 Prompts 列表检查是否出现新卡片。")
                        .font(StudioFont.ui(size: 12))
                        .foregroundStyle(StudioPalette.foreground.opacity(0.88))
                        .lineSpacing(3)
                    Text("Pi 可继续使用仓库现有 Extension；Hook 采集需要本地学习引擎处于运行状态。")
                        .font(StudioFont.ui(size: 11.5))
                        .foregroundStyle(StudioPalette.mutedForeground)
                }
            }
            .padding(20)
        }
        .confirmationDialog("允许追加 \(agent) 的 Hook 配置？", isPresented: $confirm) {
            Button("备份并安装") {
                do {
                    let directory = userScope ? FileManager.default.homeDirectoryForCurrentUser : project!
                    let file = try HookInstaller.install(agent: agent, directory: directory, port: store.api.endpoint.port)
                    installed = "已写入 \(file.path)\n请用一次真实 Agent 提问验证。"
                } catch {
                    store.lastError = error.localizedDescription
                }
            }
        }
    }
}
