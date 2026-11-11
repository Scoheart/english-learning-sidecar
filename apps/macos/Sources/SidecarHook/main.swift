import Foundation
import SidecarCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if os(Linux)
import Glibc
#else
import Darwin
#endif

let source = CommandLine.arguments.dropFirst().first ?? "unknown"
let outputLock = NSLock()
func finish() -> Never {
    outputLock.lock()
    if source == "cursor" { FileHandle.standardOutput.write(Data("{\"continue\":true}\n".utf8)) }
    exit(0)
}
// Also bounds stdin reads. Agent errors must never become a non-zero exit.
DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(450)) { finish() }
do {
    let port = Int(CommandLine.arguments.dropFirst(2).first ?? ProcessInfo.processInfo.environment["SIDECAR_PORT"] ?? "4317") ?? 4317
    let api = try SidecarAPI(port: port)
    var input = Data()
    while let chunk = try FileHandle.standardInput.read(upToCount: 16384), !chunk.isEmpty {
        input.append(chunk); if input.count > 131072 { finish() }
    }
    guard let object = try JSONSerialization.jsonObject(with: input) as? [String: Any] else { finish() }
    let prompt = object["prompt"] as? String ?? object["text"] as? String ?? ""
    guard !prompt.isEmpty, prompt.count <= 12000 else { finish() }
    let directory = ProcessInfo.processInfo.environment["SIDECAR_DATA_DIR"] ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".english-sidecar").path
    let token = try String(contentsOfFile: directory + "/ingest-token", encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    guard token.count >= 32 else { finish() }
    var request = try api.request("/api/events", method: "POST", body: [
        "source": source, "eventType": "user.prompt.submitted", "content": prompt,
        "sessionId": object["sessionId"] as? String ?? object["session_id"] as? String ?? object["conversation_id"] as? String ?? "",
        "turnId": object["promptId"] as? String ?? object["turnId"] as? String ?? object["turn_id"] as? String ?? ""
    ])
    request.setValue(token, forHTTPHeaderField: "x-sidecar-token")
    let done = DispatchSemaphore(value: 0)
    let task = api.session.dataTask(with: request) { _, _, _ in done.signal() }
    task.resume(); _ = done.wait(timeout: .now() + .milliseconds(220)); task.cancel()
} catch { /* Fail open; never expose prompts, tokens or errors on stdout. */ }
finish()
