// BunServiceMacOS.swift
// macOS implementation: spawns the embedded `smartcrab-service` binary and
// communicates via line-delimited JSON-RPC over stdio.

#if os(macOS)
import Foundation

public final class BunServiceMacOS: BunServiceProtocol, @unchecked Sendable {
    private let process = Process()
    private let stdinPipe = Pipe()
    private let stdoutPipe = Pipe()
    private let stderrPipe = Pipe()

    private let queue = DispatchQueue(label: "ai.smartcrab.bun.io")
    private var pending: [String: (Result<Data, Error>) -> Void] = [:]
    private var buffer = Data()
    private var idCounter: UInt64 = 0
    private var started = false

    public init() {}

    // MARK: - Lifecycle

    public func start() async throws {
        try queue.sync {
            guard !started else { return }
            guard let url = Bundle.main.url(forResource: "smartcrab-service", withExtension: nil) else {
                throw BunServiceError.binaryMissing
            }
            process.executableURL = url
            process.standardInput = stdinPipe
            process.standardOutput = stdoutPipe
            process.standardError = stderrPipe

            stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let chunk = handle.availableData
                guard !chunk.isEmpty else { return }
                self?.queue.async { self?.ingest(chunk) }
            }

            try process.run()
            started = true
        }
    }

    public func stop() async {
        queue.sync {
            guard started else { return }
            stdoutPipe.fileHandleForReading.readabilityHandler = nil
            if process.isRunning { process.terminate() }
            started = false
        }
    }

    // MARK: - Public API

    public func ping(nonce: String) async throws -> PingResponse {
        try await call(method: "ping", params: PingRequest(nonce: nonce))
    }

    public func pipelineList() async throws -> [Pipeline] {
        try await call(method: "pipeline.list", params: EmptyParams())
    }

    public func chatSend(_ request: ChatSendRequest) async throws -> ChatSendResponse {
        try await call(method: "chat.send", params: request)
    }

    public func chatHistory(conversationId: String) async throws -> [ChatMessage] {
        struct P: Encodable { let conversationId: String }
        return try await call(method: "chat.history", params: P(conversationId: conversationId))
    }

    public func skillList() async throws -> [Skill] {
        try await call(method: "skill.list", params: EmptyParams())
    }

    // MARK: - Internals

    private struct EmptyParams: Encodable {}

    private func nextId() -> String {
        queue.sync {
            idCounter &+= 1
            return "rpc-\(idCounter)"
        }
    }

    private func call<P: Encodable, R: Decodable>(method: String, params: P) async throws -> R {
        let id = nextId()
        let envelope = RPCRequest(id: id, method: method, params: params)
        var data = try JSONEncoder().encode(envelope)
        data.append(0x0A) // newline

        let raw: Data = try await withCheckedThrowingContinuation { continuation in
            queue.async { [weak self] in
                guard let self = self else {
                    continuation.resume(throwing: BunServiceError.notRunning)
                    return
                }
                self.pending[id] = { result in
                    switch result {
                    case .success(let payload): continuation.resume(returning: payload)
                    case .failure(let err): continuation.resume(throwing: err)
                    }
                }
                do {
                    try self.stdinPipe.fileHandleForWriting.write(contentsOf: data)
                } catch {
                    self.pending.removeValue(forKey: id)
                    continuation.resume(throwing: error)
                }
            }
        }

        let decoded = try JSONDecoder().decode(RPCResponse<R>.self, from: raw)
        if let err = decoded.error { throw err }
        guard let value = decoded.result else { throw BunServiceError.malformedResponse }
        return value
    }

    private func ingest(_ chunk: Data) {
        buffer.append(chunk)
        while let nl = buffer.firstIndex(of: 0x0A) {
            let line = buffer.subdata(in: buffer.startIndex..<nl)
            buffer.removeSubrange(buffer.startIndex...nl)
            guard !line.isEmpty else { continue }
            handleLine(line)
        }
    }

    private func handleLine(_ data: Data) {
        struct IdOnly: Decodable { let id: String? }
        guard let probe = try? JSONDecoder().decode(IdOnly.self, from: data),
              let id = probe.id,
              let cont = pending.removeValue(forKey: id) else {
            return
        }
        cont(.success(data))
    }
}

public enum BunServiceError: Error, LocalizedError {
    case binaryMissing
    case notRunning
    case malformedResponse

    public var errorDescription: String? {
        switch self {
        case .binaryMissing: return "Embedded smartcrab-service binary not found in app bundle."
        case .notRunning: return "Bun service is not running."
        case .malformedResponse: return "Received malformed JSON-RPC response."
        }
    }
}
#endif
