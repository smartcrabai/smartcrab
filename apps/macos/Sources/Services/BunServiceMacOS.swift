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

        // MARK: - Settings (TODO: real wire-format wiring)

        public func settingsLoad() async throws -> SeherConfig {
            try await fallback.settingsLoad()
        }

        public func settingsSave(_ config: SeherConfig) async throws {
            try await fallback.settingsSave(config)
        }

        // MARK: - Adapters

        public func adapterLoad(adapterId: String) async throws -> DiscordAdapterConfig {
            try await fallback.adapterLoad(adapterId: adapterId)
        }

        public func adapterSave(adapterId: String, config: DiscordAdapterConfig) async throws {
            try await fallback.adapterSave(adapterId: adapterId, config: config)
        }

        // MARK: - Chat

        public func chatHistory() async throws -> [ChatBubble] {
            try await fallback.chatHistory()
        }

        public func chatSend(_ content: String) async throws -> ChatBubble {
            try await fallback.chatSend(content)
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
            try await fallback.pipelineGet(id: id)
        }

        public func pipelineSave(_ detail: PipelineDetail) async throws -> PipelineDetail {
            try await fallback.pipelineSave(detail)
        }

        public func pipelineValidate(yaml: String) async throws -> PipelineValidation {
            try await fallback.pipelineValidate(yaml: yaml)
        }

        public func pipelineExecute(id: String) async throws {
            try await fallback.pipelineExecute(id: id)
        }

        // MARK: - Cron

        public func cronList() async throws -> [CronJob] {
            try await fallback.cronList()
        }

        public func cronCreate(pipelineId: String, schedule: String) async throws -> CronJob {
            try await fallback.cronCreate(pipelineId: pipelineId, schedule: schedule)
        }

        public func cronUpdate(id: String, schedule: String?, isActive: Bool?) async throws -> CronJob {
            try await fallback.cronUpdate(id: id, schedule: schedule, isActive: isActive)
        }

        public func cronDelete(id: String) async throws {
            try await fallback.cronDelete(id: id)
        }

        // MARK: - Skills

        public func skillList() async throws -> [SkillInfo] {
            try await fallback.skillList()
        }

        public func skillAutoGenerate(pipelineId: String) async throws -> SkillInfo {
            try await fallback.skillAutoGenerate(pipelineId: pipelineId)
        }

        public func skillInvoke(skillId: String, input: String) async throws -> SkillInvocationResult {
            try await fallback.skillInvoke(skillId: skillId, input: input)
        }

        public func skillDelete(id: String) async throws {
            try await fallback.skillDelete(id: id)
        }

        // MARK: - Execution history

        public func executionHistory(limit: Int, offset: Int, statusFilter: String?) async throws -> [ExecutionSummary] {
            try await fallback.executionHistory(limit: limit, offset: offset, statusFilter: statusFilter)
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
            let id = nextId()
            let envelope = RPCRequestEnvelope(id: id, method: method, params: params)
            var data = try JSONEncoder().encode(envelope)
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
            guard let value = decoded.result else { throw BunServiceError.malformedResponse }
            return value
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
