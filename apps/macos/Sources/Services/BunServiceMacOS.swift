// BunServiceMacOS.swift
// macOS implementation: spawns the embedded `smartcrab-service` binary and
// communicates via line-delimited JSON-RPC over stdio.

#if os(macOS)
    import Foundation

    @MainActor
    public final class BunServiceMacOS: BunServiceProtocol {
        private let process = Process()
        private let stdinPipe = Pipe()
        private let stdoutPipe = Pipe()
        private let stderrPipe = Pipe()

        private let queue = DispatchQueue(label: "ai.smartcrab.bun.io")
        private nonisolated(unsafe) var pending: [String: (Result<Data, Error>) -> Void] = [:]
        private nonisolated(unsafe) var buffer = Data()
        private nonisolated(unsafe) var idCounter: UInt64 = 0
        private nonisolated(unsafe) var started = false

        private let fallback = StubBunService()

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

        public func ping(nonce: String) async throws -> PingResponse {
            try await call(method: "system.ping", params: PingRequestEnvelope(nonce: nonce))
        }

        // MARK: - Settings

        public func settingsLoad() async throws -> SeherConfig {
            let loaded: SeherConfig? = try await callOptional(method: "settings.app-load", params: EmptyParams())
            return loaded ?? SeherConfig()
        }

        public func settingsSave(_ config: SeherConfig) async throws {
            struct Params: Encodable, Sendable { let config: SeherConfig }
            struct Result: Decodable, Sendable { let saved: Bool }
            let _: Result = try await call(method: "settings.app-save", params: Params(config: config))
        }

        // MARK: - Adapters

        public func adapterLoad(adapterId: String) async throws -> DiscordAdapterConfig {
            struct Params: Encodable, Sendable { let adapterId: String }
            let loaded: DiscordAdapterConfig? = try await callOptional(method: "settings.adapter-load", params: Params(adapterId: adapterId))
            return loaded ?? DiscordAdapterConfig()
        }

        public func adapterSave(adapterId: String, config: DiscordAdapterConfig) async throws {
            struct Params: Encodable, Sendable {
                let adapterId: String
                let adapterType: String
                let config: DiscordAdapterConfig
            }
            struct Result: Decodable, Sendable { let saved: Bool }
            let _: Result = try await call(
                method: "settings.adapter-save",
                params: Params(adapterId: adapterId, adapterType: adapterId, config: config)
            )
        }

        // MARK: - Chat

        public func chatHistory() async throws -> [ChatBubble] {
            struct WireBubble: Decodable {
                let id: String
                let role: String
                let content: String
                let createdAt: String
            }
            let rows: [WireBubble] = try await call(method: "chat.bubble-history", params: EmptyParams())
            return rows.compactMap { wire in
                guard let role = ChatBubble.Role(rawValue: wire.role),
                      let uuid = UUID(uuidString: wire.id),
                      let date = ISO8601DateFormatter().date(from: wire.createdAt)
                else { return nil }
                return ChatBubble(id: uuid, role: role, content: wire.content, createdAt: date)
            }
        }

        public func chatSend(_ content: String) async throws -> ChatBubble {
            struct Params: Encodable, Sendable { let content: String }
            struct WireBubble: Decodable {
                let id: String
                let role: String
                let content: String
                let createdAt: String
            }
            let wire: WireBubble = try await call(method: "chat.bubble-send", params: Params(content: content))
            let role = ChatBubble.Role(rawValue: wire.role) ?? .assistant
            let uuid = UUID(uuidString: wire.id) ?? UUID()
            let date = ISO8601DateFormatter().date(from: wire.createdAt) ?? Date()
            return ChatBubble(id: uuid, role: role, content: wire.content, createdAt: date)
        }

        public func chatStart(adapterId: String) async throws -> Bool {
            struct Params: Encodable, Sendable { let adapter: String }
            struct Result: Decodable, Sendable { let running: Bool }
            let r: Result = try await call(method: "chat.start", params: Params(adapter: adapterId))
            return r.running
        }

        public func chatStop(adapterId: String) async throws -> Bool {
            struct Params: Encodable, Sendable { let adapter: String }
            struct Result: Decodable, Sendable { let running: Bool }
            let r: Result = try await call(method: "chat.stop", params: Params(adapter: adapterId))
            return r.running
        }

        public func chatStatus(adapterId: String) async throws -> Bool {
            struct Params: Encodable, Sendable { let adapter: String }
            struct Adapter: Decodable, Sendable { let running: Bool }
            struct Result: Decodable, Sendable { let adapters: [Adapter] }
            let r: Result = try await call(method: "chat.status", params: Params(adapter: adapterId))
            return r.adapters.first?.running ?? false
        }

        // MARK: - Pipelines

        public func pipelineList() async throws -> [PipelineSummary] {
            struct WirePipeline: Decodable {
                let id: String
                let name: String
                let description: String?
                let isActive: Bool
            }
            let rows: [WirePipeline] = try await call(method: "pipeline.list", params: EmptyParams())
            return rows.map { PipelineSummary(id: $0.id, name: $0.name, description: $0.description, isActive: $0.isActive) }
        }

        private struct EmptyParams: Encodable {}

        public func pipelineGet(id: String) async throws -> PipelineDetail {
            struct Params: Encodable, Sendable { let id: String }
            struct WireRow: Decodable {
                let id: String
                let name: String
                let description: String?
                let yamlContent: String
                let maxLoopCount: Int
                let isActive: Bool
            }
            let row: WireRow = try await call(method: "pipeline.get", params: Params(id: id))
            return PipelineDetail(
                info: PipelineSummary(id: row.id, name: row.name, description: row.description, isActive: row.isActive),
                yamlContent: row.yamlContent,
                maxLoopCount: row.maxLoopCount
            )
        }

        public func pipelineSave(_ detail: PipelineDetail) async throws -> PipelineDetail {
            struct Params: Encodable, Sendable {
                let id: String?
                let name: String
                let description: String?
                let yamlContent: String
                let maxLoopCount: Int
                let isActive: Bool
            }
            struct WireRow: Decodable {
                let id: String
                let name: String
                let description: String?
                let yamlContent: String
                let maxLoopCount: Int
                let isActive: Bool
            }
            let params = Params(
                id: detail.info.id.isEmpty ? nil : detail.info.id,
                name: detail.info.name,
                description: detail.info.description,
                yamlContent: detail.yamlContent,
                maxLoopCount: detail.maxLoopCount,
                isActive: detail.info.isActive
            )
            let row: WireRow = try await call(method: "pipeline.save", params: params)
            return PipelineDetail(
                info: PipelineSummary(id: row.id, name: row.name, description: row.description, isActive: row.isActive),
                yamlContent: row.yamlContent,
                maxLoopCount: row.maxLoopCount
            )
        }

        public func pipelineValidate(yaml: String) async throws -> PipelineValidation {
            // pipeline.save validates YAML on the Bun side; no dedicated validate RPC yet.
            try await fallback.pipelineValidate(yaml: yaml)
        }

        public func pipelineExecute(id: String) async throws {
            struct Params: Encodable, Sendable { let id: String }
            struct WireResp: Decodable { let executionId: String }
            let _: WireResp = try await call(method: "pipeline.execute", params: Params(id: id))
        }

        // MARK: - Cron

        public func cronList() async throws -> [CronJob] {
            try await call(method: "cron.list", params: EmptyParams())
        }

        public func cronCreate(pipelineId: String, schedule: String) async throws -> CronJob {
            struct Params: Encodable, Sendable {
                let pipelineId: String
                let schedule: String
            }
            return try await call(method: "cron.create", params: Params(pipelineId: pipelineId, schedule: schedule))
        }

        public func cronUpdate(id: String, schedule: String?, isActive: Bool?) async throws -> CronJob {
            struct Params: Encodable, Sendable {
                let id: String
                let schedule: String?
                let isActive: Bool?
            }
            return try await call(method: "cron.update", params: Params(id: id, schedule: schedule, isActive: isActive))
        }

        public func cronDelete(id: String) async throws {
            struct Params: Encodable, Sendable { let id: String }
            struct WireResp: Decodable { let ok: Bool? }
            let _: WireResp = try await call(method: "cron.delete", params: Params(id: id))
        }

        // MARK: - Skills

        public func skillList() async throws -> [SkillInfo] {
            try await call(method: "skill.list", params: EmptyParams())
        }

        public func skillAutoGenerate(pipelineId: String) async throws -> SkillInfo {
            struct Params: Encodable, Sendable { let pipelineId: String }
            return try await call(method: "skill.auto-generate", params: Params(pipelineId: pipelineId))
        }

        public func skillInvoke(skillId: String, input: String) async throws -> SkillInvocationResult {
            struct Params: Encodable, Sendable {
                let id: String
                let input: String
            }
            return try await call(method: "skill.invoke", params: Params(id: skillId, input: input))
        }

        public func skillDelete(id: String) async throws {
            struct Params: Encodable, Sendable { let id: String }
            struct WireResp: Decodable { let ok: Bool? }
            let _: WireResp = try await call(method: "skill.delete", params: Params(id: id))
        }

        // MARK: - Execution history

        public func executionHistory(limit: Int, offset _: Int, statusFilter _: String?) async throws -> [ExecutionSummary] {
            struct Params: Encodable, Sendable { let limit: Int }
            struct WireExecution: Decodable {
                let id: String
                let pipelineId: String
                let pipelineName: String
                let triggerType: String
                let status: String
                let startedAt: String
                let completedAt: String?
            }
            let rows: [WireExecution] = try await call(method: "execution.history", params: Params(limit: limit))
            return rows.map {
                ExecutionSummary(id: $0.id, pipelineId: $0.pipelineId, pipelineName: $0.pipelineName,
                                 triggerType: $0.triggerType, status: $0.status,
                                 startedAt: $0.startedAt, completedAt: $0.completedAt)
            }
        }

        public func executionDetail(id: String) async throws -> ExecutionDetail {
            try await fallback.executionDetail(id: id)
        }

        // MARK: - Internals

        private func nextId() -> String {
            queue.sync {
                idCounter &+= 1
                return "rpc-\(idCounter)"
            }
        }

        private func call<P: Encodable & Sendable, R: Decodable & Sendable>(method: String, params: P) async throws -> R {
            guard let value: R = try await callOptional(method: method, params: params) else {
                throw BunServiceError.malformedResponse
            }
            return value
        }

        private func callOptional<P: Encodable & Sendable, R: Decodable & Sendable>(method: String, params: P) async throws -> R? {
            let id = nextId()
            let envelope = RPCRequestEnvelope(id: id, method: method, params: params)
            let encoder = JSONEncoder()
            encoder.keyEncodingStrategy = .convertToSnakeCase
            var data = try encoder.encode(envelope)
            data.append(0x0A)

            let raw: Data = try await withCheckedThrowingContinuation { continuation in
                queue.async { [weak self] in
                    guard let self = self else {
                        continuation.resume(throwing: BunServiceError.notRunning)
                        return
                    }
                    self.pending[id] = { result in
                        switch result {
                        case let .success(payload): continuation.resume(returning: payload)
                        case let .failure(err): continuation.resume(throwing: err)
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

            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let decoded = try decoder.decode(RPCResponseEnvelope<R>.self, from: raw)
            if let err = decoded.error { throw err }
            return decoded.result
        }

        private func ingest(_ chunk: Data) {
            buffer.append(chunk)
            while let nl = buffer.firstIndex(of: 0x0A) {
                let line = buffer.subdata(in: buffer.startIndex ..< nl)
                buffer.removeSubrange(buffer.startIndex ... nl)
                guard !line.isEmpty else { continue }
                handleLine(line)
            }
        }

        private func handleLine(_ data: Data) {
            struct IdOnly: Decodable { let id: String? }
            guard let probe = try? JSONDecoder().decode(IdOnly.self, from: data),
                  let id = probe.id,
                  let cont = pending.removeValue(forKey: id)
            else { return }
            cont(.success(data))
        }
    }
#endif
