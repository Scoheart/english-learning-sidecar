import AppKit
import SwiftUI
import Combine
import SidecarCore
import DynamicNotchKit

@MainActor final class IslandState: ObservableObject {
    @Published var interaction = IslandInteraction()
    @Published var floating = false
    @Published var compactInExpandedShell = false
    var expanded: Bool { interaction.expanded }
    var pinned: Bool { interaction.pinned }
}
func displayID(_ screen: NSScreen) -> String { (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.stringValue ?? "primary" }

/// Own application behavior; delegate the actual notch shape, safe area and
/// animation to the pinned upstream package. Never run overlapping transitions.
@MainActor final class IslandController {
    private typealias Notch = DynamicNotch<AnyView, AnyView, AnyView>
    private let store: DesktopStore
    private let state = IslandState()
    private var cache: [Bool: Notch] = [:]
    private var active: Notch?
    private var activeDisplay: String?
    private var probes: [String: WeakIslandProbe] = [:]
    private var cancellables = Set<AnyCancellable>()
    private var hoverTask: Task<Void, Never>?
    private var worker: Task<Void, Never>?
    private var displayTask: Task<Void, Never>?
    private var monitors: [Any] = []
    private var suspended = false
    private var dirty = false
    private var reload = false
    private var pointerInside = false

    init(store: DesktopStore) {
        self.store = store
        store.$islandEnabled.receive(on: RunLoop.main).sink { [weak self] enabled in
            if !enabled { self?.resetInteraction(); self?.orderOutAll() }
            self?.requestPresentation()
        }.store(in: &cancellables)
        store.$islandDisplay.receive(on: RunLoop.main).sink { [weak self] _ in self?.requestPresentation(reload: true) }.store(in: &cancellables)
        store.$islandPresentation.receive(on: RunLoop.main).sink { [weak self] _ in
            self?.resetInteraction(); self?.requestPresentation(reload: true)
        }.store(in: &cancellables)
        NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)
            .sink { [weak self] _ in
                guard let self else { return }
                orderOutAll()
                displayTask?.cancel()
                displayTask = Task {
                    // Let the library finish its own screen observer before reapplying
                    // the user's display choice and closing unused cached panels.
                    do { try await Task.sleep(nanoseconds: 150_000_000) } catch { return }
                    self.requestPresentation(reload: true)
                }
            }.store(in: &cancellables)
        for name in [NSWorkspace.screensDidSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
            NSWorkspace.shared.notificationCenter.publisher(for: name).sink { [weak self] _ in
                self?.suspended = true; self?.hide()
            }.store(in: &cancellables)
        }
        for name in [NSWorkspace.screensDidWakeNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
            NSWorkspace.shared.notificationCenter.publisher(for: name).sink { [weak self] _ in
                self?.suspended = false; self?.requestPresentation(reload: true)
            }.store(in: &cancellables)
        }
        let mask: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDragged]
        if let m = NSEvent.addGlobalMonitorForEvents(matching: mask, handler: { [weak self] _ in self?.updateHitTesting() }) { monitors.append(m) }
        if let m = NSEvent.addLocalMonitorForEvents(matching: mask, handler: { [weak self] event in self?.updateHitTesting(); return event }) { monitors.append(m) }
        requestPresentation()
    }

    func hide() { suspended = true; resetInteraction(); orderOutAll(); requestPresentation() }
    private func resetInteraction() {
        hoverTask?.cancel(); pointerInside = false
        state.interaction.hide(); store.islandInteracting = false
    }
    private func orderOutAll() { for notch in cache.values { notch.windowController?.window?.orderOut(nil) } }
    private var screen: NSScreen? {
        NSScreen.screens.first { displayID($0) == store.islandDisplay } ?? NSScreen.screens.first
    }
    private func notch(floating: Bool) -> Notch {
        if let existing = cache[floating] { return existing }
        let instance = Notch(hoverBehavior: [], style: floating ? .floating : .notch, expanded: { [weak self] in
            guard let self else { return AnyView(EmptyView()) }
            return AnyView(IslandView(store: store, state: state, pin: { [weak self] in self?.togglePin() }, measured: { [weak self] in self?.record("expanded", $0) }))
        }, compactLeading: { [weak self] in
            AnyView(IslandCompactLeading(pin: { [weak self] in self?.togglePin() }, measured: { [weak self] in self?.record("leading", $0) }))
        }, compactTrailing: { [weak self] in
            guard let self else { return AnyView(EmptyView()) }
            return AnyView(IslandCompactTrailing(store: store, pin: { [weak self] in self?.togglePin() }, measured: { [weak self] in self?.record("trailing", $0) }))
        })
        // Reuse only two instances: upstream owns a long-lived screen observer.
        cache[floating] = instance
        instance.objectWillChange.receive(on: RunLoop.main).sink { [weak self, weak instance] _ in
            guard let self, let instance else { return }
            if active === instance && store.islandEnabled && !suspended {
                if let controller = instance.windowController { _ = IslandPanelBridge.nonactivating(controller) }
                updateHitTesting()
            } else { instance.windowController?.window?.orderOut(nil) }
        }.store(in: &cancellables)
        return instance
    }

    private func requestPresentation(reload: Bool = false) {
        dirty = true; self.reload = self.reload || reload
        guard worker == nil else { return }
        worker = Task { [weak self] in
            guard let self else { return }
            while dirty && !Task.isCancelled {
                dirty = false
                let recreate = self.reload; self.reload = false
                await present(recreate: recreate)
            }
            worker = nil
        }
    }
    private func present(recreate: Bool) async {
        guard store.islandEnabled, !suspended, let screen else {
            for instance in cache.values { await instance.hide(); instance.windowController?.close(); instance.windowController = nil }
            active = nil; activeDisplay = nil; probes.removeAll()
            return
        }
        let hardwareNotch = screen.auxiliaryTopLeftArea != nil && screen.auxiliaryTopRightArea != nil
        let floating = store.islandPresentation.isFloating(hasHardwareNotch: hardwareNotch)
        let next = notch(floating: floating)
        if recreate || active !== next || activeDisplay != displayID(screen) {
            if let active { await active.hide(); active.windowController?.close(); active.windowController = nil }
            for instance in cache.values where instance !== next { instance.windowController?.window?.orderOut(nil) }
            probes.removeAll()
            active = next; activeDisplay = displayID(screen)
        }
        guard store.islandEnabled, !suspended else { dirty = true; return }
        state.floating = floating
        state.compactInExpandedShell = floating || !hardwareNotch
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        next.transitionConfiguration = .init(
            openingAnimation: reduceMotion ? .linear(duration: 0) : nil,
            closingAnimation: reduceMotion ? .linear(duration: 0) : nil,
            conversionAnimation: reduceMotion ? .linear(duration: 0) : nil,
            skipIntermediateHides: true)
        let command = store.islandPresentation.command(visible: true, expanded: state.expanded, hasHardwareNotch: hardwareNotch)
        let transition = Task { @MainActor in
            if command == .compact { await next.compact(on: screen) }
            else { await next.expand(on: screen) }
        }
        await Task.yield()
        if let controller = next.windowController { _ = IslandPanelBridge.nonactivating(controller) }
        await transition.value
        if let controller = next.windowController { _ = IslandPanelBridge.nonactivating(controller) }
        if !store.islandEnabled || suspended { orderOutAll(); dirty = true }
        updateHitTesting()
    }

    private func record(_ part: String, _ view: IslandProbeView) {
        guard view.window === active?.windowController?.window else { return }
        probes[part] = WeakIslandProbe(view)
        updateHitTesting()
    }
    private func area(_ part: String) -> CGRect? {
        guard let view = probes[part]?.view, view.window === active?.windowController?.window else { return nil }
        return view.screenRect
    }
    private func updateHitTesting() {
        guard let window = active?.windowController?.window, window.isVisible, let screen else { return }
        let rect: CGRect
        if state.floating {
            guard let content = area("expanded") else { window.ignoresMouseEvents = true; return }
            rect = content.insetBy(dx: -15, dy: -15)
        } else if state.expanded || state.compactInExpandedShell {
            guard let content = area("expanded") else { window.ignoresMouseEvents = true; return }
            let notchWidth: CGFloat
            if let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
                notchWidth = screen.frame.width - left.width - right.width
            } else { notchWidth = 300 } // Same virtual-notch minimum as pinned upstream.
            let width = max(content.width + 60, notchWidth + 30)
            rect = CGRect(x: screen.frame.midX - width / 2, y: content.minY - 15, width: width, height: max(0, screen.frame.maxY - content.minY + 15))
        } else {
            guard let leading = area("leading"), let trailing = area("trailing") else { window.ignoresMouseEvents = true; return }
            let content = leading.union(trailing)
            let height = max(screen.safeAreaInsets.top, screen.frame.maxY - screen.visibleFrame.maxY, content.height)
            rect = CGRect(x: content.minX - 14, y: screen.frame.maxY - height, width: content.width + 28, height: height)
        }
        let inside: Bool
        if state.floating {
            inside = CGPath(roundedRect: rect, cornerWidth: 20, cornerHeight: 20, transform: nil).contains(NSEvent.mouseLocation)
        } else { inside = rect.contains(NSEvent.mouseLocation) }
        window.ignoresMouseEvents = !inside
        hover(inside)
    }
    private func hover(_ inside: Bool) {
        guard inside != pointerInside else { return }
        pointerInside = inside
        hoverTask?.cancel()
        hoverTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: inside ? 350_000_000 : 500_000_000) } catch { return }
            guard let self, store.islandEnabled, !suspended else { return }
            state.interaction.hover(inside)
            store.islandInteracting = state.expanded
            requestPresentation()
            if !state.expanded { store.islandLessonID = store.lessons.first { $0.status == "complete" }?.id }
        }
    }
    private func togglePin() {
        hoverTask?.cancel()
        state.interaction.hover(pointerInside)
        state.interaction.togglePin()
        store.islandInteracting = state.expanded
        requestPresentation()
    }
    deinit {
        hoverTask?.cancel(); worker?.cancel(); displayTask?.cancel()
        for monitor in monitors { NSEvent.removeMonitor(monitor) }
    }
}
