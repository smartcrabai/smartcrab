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
        private nonisolated(unsafe) var stderrLogHandle: FileHandle?

        private let fallback = StubBunService()

        public init() {}

        private nonisolated(unsafe) static let iso8601WithMs: ISO8601DateFormatter = {
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return f
        }()

        private nonisolated(unsafe) static let iso8601Plain: ISO8601DateFormatter = ISO8601DateFormatter()

        static func parseISO8601(_ s: String) -> Date? {
            iso8601WithMs.date(from: s) ?? iso8601Plain.date(from: s)
        }

        private static let maxLogSizeBytes: UInt64 = 5 * 1024 * 1024
        /// Skip the offset() syscall on most writes; rotate-check runs at most
        /// every Nth chunk to keep the stderr hot-path syscall-free.
        private static let rotateCheckEvery: Int = 256
        private nonisolated(unsafe) var writesSinceRotateCheck: Int = 0

        private static func openStderrLogFile() -> FileHandle? {
            let url = SmartCrabPaths.bunServiceLog
            let fm = FileManager.default
            do {
                try fm.createDirectory(at: url.deletingLastPathComponent(),
                                       withIntermediateDirectories: true)
                fm.createFile(atPath: url.path, contents: nil)
                let handle = try FileHandle(forWritingTo: url)
                try handle.seekToEnd()
                return handle
            } catch {
                return nil
            }
        }

        /// Drop the oldest half of the log file when it crosses the size cap.
        private func rotateIfTooLarge() {
            guard let handle = stderrLogHandle else { return }
            do {
                let size = try handle.offset()
                guard size > Self.maxLogSizeBytes else { return }
                try handle.synchronize()
                try handle.close()
                let url = SmartCrabPaths.bunServiceLog
                if let data = try? Data(contentsOf: url) {
                    let keep = data.suffix(Int(Self.maxLogSizeBytes / 2))
                    try? keep.write(to: url)
                }
                let reopened = try FileHandle(forWritingTo: url)
                try reopened.seekToEnd()
                stderrLogHandle = reopened
            } catch {
                stderrLogHandle = nil
            }
        }

        /// Spawn the user's login shell once and capture `$PATH` so the
        /// bun-service subprocess sees the same paths the user gets in a
        /// terminal (mise, Homebrew, ~/.local/bin, etc.). Memoised because
        /// shell startup costs are non-trivial.
        private static let loginPathCache: String? = computeLoginShellPath()

        private static func loginShellPath() -> String? {
            loginPathCache
        }

        private static func computeLoginShellPath() -> String? {
            let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
            let p = Process()
            p.executableURL = URL(fileURLWithPath: shell)
            p.arguments = ["-lc", "printf %s \"$PATH\""]
            let out = Pipe()
            p.standardOutput = out
            p.standardError = Pipe()
            do {
                try p.run()
                p.waitUntilExit()
                guard p.terminationStatus == 0 else { return nil }
                let data = out.fileHandleForReading.readDataToEndOfFile()
                let path = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
                return (path?.isEmpty == false) ? path : nil
            } catch {
                return nil
            }
        }

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

                // GUI-launched apps (Finder, Launchpad) inherit a minimal
                // PATH that doesn't contain Homebrew, npm-global, mise, etc.,
                // so the embedded bun-service can't `Bun.which("claude")`
                // when seher-ts dispatches to the Claude Code CLI.
                // Capture the user's login-shell PATH and forward it.
                var env = ProcessInfo.processInfo.environment
                if let loginPath = Self.loginShellPath() {
                    env["PATH"] = loginPath
                }
                process.environment = env

                stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                    let chunk = handle.availableData
                    guard !chunk.isEmpty else { return }
                    self?.queue.async { self?.ingest(chunk) }
                }
                // Surface bun-service stderr in the host console AND tee to
                // ~/Library/Logs/SmartCrab/bun-service.log so the LogsView (and
                // `tail -f`) can inspect failures even when the GUI app's
                // stderr is bound to /dev/null.
                stderrLogHandle = Self.openStderrLogFile()
                writesSinceRotateCheck = 0
                stderrPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                    let chunk = handle.availableData
                    guard !chunk.isEmpty else { return }
                    FileHandle.standardError.write(chunk)
                    guard let self else { return }
                    self.queue.async {
                        if let log = self.stderrLogHandle {
                            try? log.write(contentsOf: chunk)
                        }
                        self.writesSinceRotateCheck += 1
                        if self.writesSinceRotateCheck >= Self.rotateCheckEvery {
                            self.writesSinceRotateCheck = 0
                            self.rotateIfTooLarge()
                        }
                    }
                }

                try process.run()
                started = true
            }
        }

        public func stop() async {
            queue.sync {
                guard started else { return }
                stdoutPipe.fileHandleForReading.readabilityHandler = nil
                stderrPipe.fileHandleForReading.readabilityHandler = nil
                try? stderrLogHandle?.synchronize()
                try? stderrLogHandle?.close()
                stderrLogHandle = nil
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
                      let date = Self.parseISO8601(wire.createdAt) else { return nil }
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
            guard let date = Self.parseISO8601(wire.createdAt) else {
                throw BunServiceError.malformedResponse
            }
            return ChatBubble(id: uuid, role: role, content: wire.content, createdAt: date)
        }

        public func chatStart(adapterId: String, token: String? = nil) async throws -> Bool {
            struct Params: Encodable, Sendable {
                let adapter: String
                let token: String?
            }
            struct Result: Decodable, Sendable { let running: Bool }
            let r: Result = try await call(
                method: "chat.start",
                params: Params(adapter: adapterId, token: token)
            )
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

        // MARK: - Chat DM pairing

        private struct WirePairingRequest: Decodable {
            let adapterId: String
            let senderId: String
            let code: String
            let meta: [String: String]?
            let createdAt: Int64
            let lastSeenAt: Int64
        }

        private struct WireAllowlistEntry: Decodable {
            let adapterId: String
            let senderId: String
            let meta: [String: String]?
            let approvedAt: Int64
        }

        private static func msToDate(_ ms: Int64) -> Date {
            Date(timeIntervalSince1970: TimeInterval(ms) / 1000.0)
        }

        public func chatPairingList(adapterId: String) async throws -> [DiscordPairingRequest] {
            struct Params: Encodable, Sendable { let adapter: String }
            struct Result: Decodable, Sendable { let requests: [WirePairingRequest] }
            let r: Result = try await call(method: "chat.pairing.list", params: Params(adapter: adapterId))
            return r.requests.map { wire in
                DiscordPairingRequest(
                    adapterId: wire.adapterId, senderId: wire.senderId,
                    code: wire.code, meta: wire.meta ?? [:],
                    createdAt: Self.msToDate(wire.createdAt),
                    lastSeenAt: Self.msToDate(wire.lastSeenAt)
                )
            }
        }

        public func chatPairingApprove(adapterId: String, code: String) async throws -> DiscordAllowlistEntry? {
            struct Params: Encodable, Sendable { let adapter: String; let code: String }
            struct Result: Decodable, Sendable {
                let approved: Bool
                let entry: WireAllowlistEntry?
            }
            let r: Result = try await call(method: "chat.pairing.approve", params: Params(adapter: adapterId, code: code))
            guard r.approved, let wire = r.entry else { return nil }
            return DiscordAllowlistEntry(
                adapterId: wire.adapterId, senderId: wire.senderId,
                meta: wire.meta ?? [:],
                approvedAt: Self.msToDate(wire.approvedAt)
            )
        }

        public func chatPairingReject(adapterId: String, code: String) async throws -> Bool {
            struct Params: Encodable, Sendable { let adapter: String; let code: String }
            struct Result: Decodable, Sendable { let removed: Bool }
            let r: Result = try await call(method: "chat.pairing.reject", params: Params(adapter: adapterId, code: code))
            return r.removed
        }

        public func chatPairingAllowlist(adapterId: String) async throws -> [DiscordAllowlistEntry] {
            struct Params: Encodable, Sendable { let adapter: String }
            struct Result: Decodable, Sendable { let entries: [WireAllowlistEntry] }
            let r: Result = try await call(method: "chat.pairing.allowlist", params: Params(adapter: adapterId))
            return r.entries.map { wire in
                DiscordAllowlistEntry(
                    adapterId: wire.adapterId, senderId: wire.senderId,
                    meta: wire.meta ?? [:],
                    approvedAt: Self.msToDate(wire.approvedAt)
                )
            }
        }

        public func chatPairingAllowlistRemove(adapterId: String, senderId: String) async throws -> Bool {
            struct Params: Encodable, Sendable { let adapter: String; let senderId: String }
            struct Result: Decodable, Sendable { let removed: Bool }
            let r: Result = try await call(method: "chat.pairing.allowlist.remove",
                                           params: Params(adapter: adapterId, senderId: senderId))
            return r.removed
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
