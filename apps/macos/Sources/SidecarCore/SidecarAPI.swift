import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum SidecarError: LocalizedError {
    case invalidPort, invalidResponse, server(Int, String), invalidHooks
    public var errorDescription: String? {
        switch self {
        case .invalidPort: return "Port must be between 1 and 65535."
        case .invalidResponse: return "This address did not return a valid Sidecar response."
        case let .server(code, message): return "HTTP \(code): \(message)"
        case .invalidHooks: return "Invalid Hook configuration. Existing file was not changed."
        }
    }
}
public struct Endpoint: Sendable {
    public let port: Int
    public let baseURL: URL
    public init(port: Int) throws {
        guard (1...65535).contains(port) else { throw SidecarError.invalidPort }
        self.port = port; baseURL = URL(string: "http://127.0.0.1:\(port)")!
    }
}
private final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
public final class SidecarAPI: @unchecked Sendable {
    public let endpoint: Endpoint
    public let session: URLSession
    public init(port: Int, session: URLSession? = nil) throws {
        endpoint = try Endpoint(port: port)
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 35
        config.timeoutIntervalForResource = 86400
        config.httpCookieStorage = nil
        self.session = session ?? URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
    }
    public func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) throws -> URLRequest {
        guard path.hasPrefix("/api/"), !path.contains(".."), let url = URL(string: endpoint.baseURL.absoluteString + path) else { throw SidecarError.invalidResponse }
        var req = URLRequest(url: url); req.httpMethod = method
        if let body { req.setValue("application/json", forHTTPHeaderField: "Content-Type"); req.httpBody = try JSONSerialization.data(withJSONObject: body) }
        return req
    }
    public func data(_ path: String, method: String = "GET", body: [String: Any]? = nil,
                     timeout: TimeInterval? = nil) async throws -> Data {
        var req = try request(path, method: method, body: body)
        if let timeout { req.timeoutInterval = timeout }
        let (data, response) = try await session.data(for: req)
        guard let response = response as? HTTPURLResponse else { throw SidecarError.invalidResponse }
        guard (200...299).contains(response.statusCode) else {
            let error = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw SidecarError.server(response.statusCode, String((error ?? "Request failed").prefix(240)))
        }
        return data
    }
    public func get<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        try JSONDecoder().decode(T.self, from: await data(path))
    }
    public func close() { session.invalidateAndCancel() }
}
