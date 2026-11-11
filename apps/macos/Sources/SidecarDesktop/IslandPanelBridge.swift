import AppKit
import SwiftUI

/// DynamicNotchKit exposes windowController for integration. Keep its actual
/// SwiftUI content/shape/animations, but never let the learning overlay take keys.
final class LearningPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

@MainActor enum IslandPanelBridge {
    static func nonactivating(_ controller: NSWindowController) -> LearningPanel? {
        if let panel = controller.window as? LearningPanel { return panel }
        guard let previous = controller.window, let content = previous.contentView else { return nil }
        let visible = previous.isVisible
        previous.ignoresMouseEvents = true
        let panel = LearningPanel(contentRect: previous.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .statusBar
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.acceptsMouseMovedEvents = true
        panel.ignoresMouseEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        panel.appearance = NSAppearance(named: .darkAqua)
        previous.contentView = nil
        panel.contentView = content
        controller.window = panel
        previous.orderOut(nil)
        previous.close()
        if visible { panel.orderFrontRegardless() }
        return panel
    }
}

/// Read layout from actual library-hosted content, not the library's large,
/// transparent backing window. This bounds hover/click handling to the island.
struct IslandGeometryProbe: NSViewRepresentable {
    let changed: (IslandProbeView) -> Void
    func makeNSView(context: Context) -> IslandProbeView {
        let view = IslandProbeView()
        view.changed = changed
        return view
    }
    func updateNSView(_ view: IslandProbeView, context: Context) {
        view.changed = changed
        view.report()
    }
}
final class IslandProbeView: NSView {
    var changed: ((IslandProbeView) -> Void)?
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); report() }
    override func layout() { super.layout(); report() }
    override func setFrameSize(_ newSize: NSSize) { super.setFrameSize(newSize); report() }
    override func setFrameOrigin(_ newOrigin: NSPoint) { super.setFrameOrigin(newOrigin); report() }
    func report() {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.window != nil else { return }
            self.changed?(self)
        }
    }
    var screenRect: CGRect? {
        guard let window, bounds.width > 0, bounds.height > 0 else { return nil }
        return window.convertToScreen(convert(bounds, to: nil))
    }
}
final class WeakIslandProbe {
    weak var view: IslandProbeView?
    init(_ view: IslandProbeView) { self.view = view }
}
