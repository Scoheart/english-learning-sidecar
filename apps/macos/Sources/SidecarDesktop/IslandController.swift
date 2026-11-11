import AppKit
import SwiftUI
import Combine

@MainActor final class IslandState: ObservableObject {
    @Published var expanded = false
    @Published var pinned = false
}
private final class LearningPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
private final class IslandHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
func displayID(_ screen: NSScreen) -> String { (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.stringValue ?? "primary" }

@MainActor final class IslandController {
    private let store: DesktopStore
    private let state = IslandState()
    private let panel: LearningPanel
    private var cancellables = Set<AnyCancellable>()
    private var hoverTask: Task<Void, Never>?
    private var monitors: [Any] = []
    private var suspended = false
    private var pointerInside = false

    init(store: DesktopStore) {
        self.store = store
        panel = LearningPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = false
        panel.level = .floating; panel.hidesOnDeactivate = false; panel.isReleasedWhenClosed = false
        panel.isMovable = false; panel.becomesKeyOnlyIfNeeded = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        let hosting = IslandHostingView(rootView: IslandView(store: store, state: state,
            hover: { [weak self] inside in self?.hover(inside) },
            pin: { [weak self] in self?.togglePin() }))
        hosting.sizingOptions = []
        panel.contentView = hosting
        store.$islandEnabled.sink { [weak self] enabled in
            if enabled { self?.show() } else { self?.hide() }
        }.store(in: &cancellables)
        store.$islandDisplay.sink { [weak self] _ in self?.position() }.store(in: &cancellables)
        NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)
            .sink { [weak self] _ in self?.position() }.store(in: &cancellables)
        for name in [NSWorkspace.screensDidSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
            NSWorkspace.shared.notificationCenter.publisher(for: name).sink { [weak self] _ in
                self?.suspended = true; self?.hide()
            }.store(in: &cancellables)
        }
        for name in [NSWorkspace.screensDidWakeNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
            NSWorkspace.shared.notificationCenter.publisher(for: name).sink { [weak self] _ in
                self?.suspended = false; self?.show()
            }.store(in: &cancellables)
        }
        if let monitor = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved], handler: { [weak self] _ in self?.updateHitTesting() }) { monitors.append(monitor) }
        if let monitor = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved], handler: { [weak self] event in self?.updateHitTesting(); return event }) { monitors.append(monitor) }
        show()
    }
    func hide() { pointerInside = false; hoverTask?.cancel(); panel.orderOut(nil); state.expanded = false; state.pinned = false; store.islandInteracting = false }
    private func show() { guard store.islandEnabled, !suspended else { return }; position(); panel.orderFrontRegardless(); updateHitTesting() }
    private func position(animated: Bool = false) {
        guard let screen = NSScreen.screens.first(where: { displayID($0) == store.islandDisplay }) ?? NSScreen.screens.first else { return }
        let width: CGFloat = state.expanded ? 420 : 220
        let height: CGFloat = state.expanded ? 226 : 36
        // Visible frame deliberately puts content BELOW menu bar/notch on every display.
        let frame = NSRect(x: screen.visibleFrame.midX - width / 2, y: screen.visibleFrame.maxY - height - 8, width: width, height: height)
        if animated && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.18
                panel.animator().setFrame(frame, display: true)
            }
        } else { panel.setFrame(frame, display: true) }
        updateHitTesting()
    }
    private func updateHitTesting() {
        guard panel.isVisible else { return }
        let mouse = NSEvent.mouseLocation
        let local = CGPoint(x: mouse.x - panel.frame.minX, y: mouse.y - panel.frame.minY)
        let radius: CGFloat = state.expanded ? 22 : 18
        let shape = CGPath(roundedRect: CGRect(origin: .zero, size: panel.frame.size), cornerWidth: radius, cornerHeight: radius, transform: nil)
        let inside = shape.contains(local)
        panel.ignoresMouseEvents = !inside
        hover(inside)
    }
    private func hover(_ inside: Bool) {
        guard inside != pointerInside else { return }
        pointerInside = inside
        hoverTask?.cancel()
        if state.pinned { return }
        hoverTask = Task {
            do { try await Task.sleep(nanoseconds: inside ? 350_000_000 : 500_000_000) } catch { return }
            state.expanded = inside; store.islandInteracting = inside; position(animated: true)
            if !inside { store.islandLessonID = store.lessons.first { $0.status == "complete" }?.id }
        }
    }
    private func togglePin() {
        hoverTask?.cancel(); state.pinned.toggle(); state.expanded = state.pinned
        store.islandInteracting = state.pinned; position(animated: true)
    }
    deinit { for monitor in monitors { NSEvent.removeMonitor(monitor) } }
}
