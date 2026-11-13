import SwiftUI
import AppKit

@main struct EnglishSidecarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup("English Sidecar", id: "learning") {
            MainView(store: delegate.store)
                .frame(minWidth: 960, minHeight: 620)
        }
        .defaultSize(width: 1260, height: 800)
        .windowToolbarStyle(.unifiedCompact(showsTitle: false))
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("学习") {
                Button("切换到 Prompts 提示列表") {
                    delegate.store.section = "feed"
                }
                .keyboardShortcut("1", modifiers: [.command])

                Button("切换到 我的收藏") {
                    delegate.store.section = "favorites"
                }
                .keyboardShortcut("2", modifiers: [.command])

                Button("切换到 History 历史累计") {
                    delegate.store.section = "history"
                }
                .keyboardShortcut("3", modifiers: [.command])

                Divider()

                Button("刷新学习记录") {
                    Task { await delegate.store.refresh() }
                }
                .keyboardShortcut("r")

                Button("停止朗读") {
                    delegate.store.speech.stop()
                }
                .keyboardShortcut(".")

                Button("显示 / 隐藏学习岛") {
                    delegate.store.islandEnabled.toggle()
                }
                .keyboardShortcut("i", modifiers: [.command, .shift])
            }
        }

        Settings {
            PreferencesView(store: delegate.store)
        }

        MenuBarExtra("English Sidecar", systemImage: "book.closed.fill") {
            TrayView(store: delegate.store)
        }
    }
}

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    let store = DesktopStore()
    private var island: IslandController?
    private var quitting = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        island = IslandController(store: store)
        store.connect()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !quitting else { return .terminateLater }
        quitting = true
        island?.hide()
        Task {
            await store.shutdown()
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
}

private struct TrayView: View {
    @ObservedObject var store: DesktopStore

    var body: some View {
        Text(
            !store.connected
                ? "学习服务未连接"
                : store.status?.paused == true
                    ? "已连接 · 采集已暂停"
                    : "已连接 · \(store.unreadCount) 条未读"
        )
        if let latest = store.islandLesson, !latest.preview.english.isEmpty {
            Button("最近：\(String(latest.preview.english.prefix(34)))") {
                store.openLesson(latest.id)
            }
        }
        Divider()
        Button("打开主工作台") { store.revealMain?() }
            .keyboardShortcut("o")
        Toggle("显示灵动学习岛", isOn: $store.islandEnabled)
        Button(store.status?.paused == true ? "恢复提示采集" : "暂停提示采集") {
            Task { await store.mutate("/api/settings", body: ["paused": !(store.status?.paused ?? false)]) }
        }
        .disabled(!store.connected)
        Button("停止朗读") { store.speech.stop() }
            .disabled(store.speech.currentText == nil)
        Divider()
        SettingsLink { Text("偏好设置…") }
            .keyboardShortcut(",")
        Button("退出 English Sidecar") { NSApp.terminate(nil) }
            .keyboardShortcut("q")
    }
}
