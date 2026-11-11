import Foundation
import SidecarCore

enum HookInstaller {
    static func install(agent: String, directory: URL, port: Int) throws -> URL {
        guard let relative = HookConfiguration.paths[agent], let app = Bundle.main.executableURL else { throw SidecarError.invalidHooks }
        let helper = app.deletingLastPathComponent().appendingPathComponent("SidecarHook")
        guard FileManager.default.isExecutableFile(atPath: helper.path) else { throw SidecarError.server(404, "请先构建完整 .app；当前缺少原生 Hook helper。") }
        let destination = directory.appendingPathComponent(relative)
        let fm = FileManager.default
        if (try? destination.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true { throw SidecarError.invalidHooks }
        let existing = fm.fileExists(atPath: destination.path) ? try Data(contentsOf: destination) : nil
        let merged = try HookConfiguration.merge(existing: existing, agent: agent, executable: helper.path, port: port)
        try fm.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        if let existing {
            let backup = URL(fileURLWithPath: destination.path + ".backup-native-" + UUID().uuidString)
            try existing.write(to: backup, options: [.atomic])
            try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: backup.path)
        }
        try merged.write(to: destination, options: [.atomic])
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
        return destination
    }
}
