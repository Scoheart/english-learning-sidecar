import SwiftUI
import AppKit

@main struct EnglishSidecarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    var body: some Scene {
        WindowGroup("English Sidecar", id: "learning") {
            MainView(store: delegate.store)
                .frame(minWidth: 900, minHeight: 580)
                .preferredColorScheme(delegate.store.colorScheme)
        }
        .defaultSize(width: 1180, height: 760)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("学习") {
                Button("刷新学习记录") { Task { await delegate.store.refresh() } }.keyboardShortcut("r")
                Button("停止朗读") { delegate.store.speech.stop() }.keyboardShortcut(".")
                Button("显示 / 隐藏学习岛") { delegate.store.islandEnabled.toggle() }.keyboardShortcut("i", modifiers: [.command, .shift])
            }
        }
        Settings { PreferencesView(store: delegate.store).preferredColorScheme(delegate.store.colorScheme) }
        MenuBarExtra("English Sidecar", systemImage: "book.closed") { TrayView(store: delegate.store) }
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
        Task { await store.shutdown(); NSApp.reply(toApplicationShouldTerminate: true) }
        return .terminateLater
    }
}
private struct TrayView: View {
    @ObservedObject var store: DesktopStore
    var body: some View {
        Text(store.connected ? "已连接 · \(store.unreadCount) 条未读" : "学习服务未连接")
        Button("打开学习窗口") { store.revealMain?() }
        Toggle("显示学习岛", isOn: $store.islandEnabled)
        Button(store.status?.paused == true ? "恢复采集" : "暂停采集") {
            Task { await store.mutate("/api/settings", body: ["paused": !(store.status?.paused ?? false)]) }
        }.disabled(!store.connected)
        Button("停止朗读") { store.speech.stop() }
        Divider()
        SettingsLink { Text("设置…") }
        Button("退出 English Sidecar") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}
