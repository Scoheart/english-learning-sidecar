import Foundation
import Combine
import SidecarCore
import Darwin

@MainActor final class EngineManager: ObservableObject {
    @Published private(set) var owned = false
    @Published private(set) var message = "连接已有服务，或启动 App 内置引擎。"
    private var process: Process?
    private var logHandle: FileHandle?
    private var starting = false
    var available: Bool { Bundle.main.url(forResource: "engine-entry", withExtension: "mjs", subdirectory: "engine") != nil }

    func start(port: Int) async throws {
        guard !starting, process?.isRunning != true else { return }
        starting = true; defer { starting = false }
        let probe = try SidecarAPI(port: port); defer { probe.close() }
        do {
            _ = try await probe.get("/api/status", as: Status.self)
            message = "已连接现有服务；本 App 不拥有、也不会停止它。"; return
        } catch let error as URLError where error.code == .cannotConnectToHost {
            // Only a refused connection permits starting a new process.
        } catch {
            throw SidecarError.server(409, "端口不可用或不是 Sidecar。不会覆盖或停止已有进程。")
        }
        guard let resources = Bundle.main.resourceURL,
              let entry = Bundle.main.url(forResource: "engine-entry", withExtension: "mjs", subdirectory: "engine") else {
            throw SidecarError.server(404, "此构建未包含引擎。请运行打包脚本，或在项目根目录运行 npm start。")
        }
        let node = resources.appendingPathComponent("engine/runtime/node")
        guard FileManager.default.isExecutableFile(atPath: node.path) else { throw SidecarError.invalidResponse }
        let home = FileManager.default.homeDirectoryForCurrentUser
        let data = home.appendingPathComponent(".english-sidecar")
        try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let logs = home.appendingPathComponent("Library/Logs/EnglishSidecar")
        try FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let log = logs.appendingPathComponent("engine.log")
        if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil, attributes: [.posixPermissions: 0o600]) }
        let handle = try FileHandle(forWritingTo: log); try handle.seekToEnd(); logHandle = handle
        let child = Process(); child.executableURL = node; child.arguments = [entry.path]; child.currentDirectoryURL = data
        // Do not inherit unrelated model credentials or a source checkout's .env.
        var env = ["HOME": home.path, "PATH": "/usr/bin:/bin", "SIDECAR_PORT": String(port), "SIDECAR_DATA_DIR": data.path]
        if let cert = ProcessInfo.processInfo.environment["NODE_EXTRA_CA_CERTS"] { env["NODE_EXTRA_CA_CERTS"] = cert }
        child.environment = env; child.standardOutput = handle; child.standardError = handle
        child.terminationHandler = { [weak self] exited in
            Task { @MainActor in
                guard let self, self.process === exited else { return }
                self.owned = false; self.message = "内置引擎已停止。"; self.process = nil
                try? self.logHandle?.close(); self.logHandle = nil
            }
        }
        try child.run(); process = child; owned = true; message = "内置引擎正在启动…"
        for _ in 0..<40 {
            try await Task.sleep(nanoseconds: 150_000_000)
            if !child.isRunning { break }
            if let _ = try? await probe.get("/api/status", as: Status.self) { message = "内置引擎运行中。关闭窗口不会停止它。"; return }
        }
        await stop()
        throw SidecarError.server(503, "内置引擎启动失败。请检查 ~/Library/Logs/EnglishSidecar/engine.log。")
    }
    func stop() async {
        guard let child = process, child.isRunning else { return }
        child.terminate()
        for _ in 0..<30 {
            if !child.isRunning { return }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        if child.isRunning { Darwin.kill(child.processIdentifier, SIGKILL) }
    }
}
