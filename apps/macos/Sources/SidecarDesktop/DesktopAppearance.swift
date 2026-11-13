import AppKit
import SwiftUI

/// Own the native window appearance in one place. Clearing a SwiftUI
/// preferredColorScheme preference can leave the previous override installed
/// on macOS; assigning nil here explicitly restores inherited system appearance.
struct DesktopAppearance: NSViewRepresentable {
    let colorScheme: ColorScheme?

    func makeNSView(context: Context) -> AppearanceView {
        let view = AppearanceView()
        view.colorScheme = colorScheme
        return view
    }

    func updateNSView(_ view: AppearanceView, context: Context) {
        view.colorScheme = colorScheme
        view.applyAppearance()
    }

    final class AppearanceView: NSView {
        var colorScheme: ColorScheme?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            applyAppearance()
        }

        func applyAppearance() {
            let appearance = colorScheme.map { NSAppearance(named: $0 == .dark ? .darkAqua : .aqua)! }
            if window?.appearance != appearance {
                window?.appearance = appearance
            }
        }
    }
}
