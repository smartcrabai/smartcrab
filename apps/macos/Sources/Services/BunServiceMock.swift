// BunServiceMock.swift
// In-memory mock used by SmartCrabPreview (iOS Simulator). Delegates to the
// StubBunService defined in BunServiceProtocol.swift.

#if os(iOS)
    import Foundation

    @MainActor
    public final class BunServiceMock: BunServiceProtocol {
        private let stub = StubBunService()

        public init() {}

        public func start() async throws {}
        public func stop() async {}
        public func ping(nonce: String) async throws -> PingResponse {
            try await stub.ping(nonce: nonce)
        }

        public func settingsLoad() async throws -> SeherConfig {
            try await stub.settingsLoad()
        }

        public func settingsSave(_ config: SeherConfig) async throws {
            try await stub.settingsSave(config)
        }

        public func authStart(kind: String) async throws -> AuthStartResult {
            try await stub.authStart(kind: kind)
        }

        public func authStatus(sessionId: String) async throws -> AuthSessionStatus {
            try await stub.authStatus(sessionId: sessionId)
        }

        public func authCancel(sessionId: String) async throws {
            try await stub.authCancel(sessionId: sessionId)
        }

        public func authCredentialStatus() async throws -> CredentialStatusResult {
            try await stub.authCredentialStatus()
        }

        public func modelsList(kind: String, apiKey: String?, baseUrl: String?, refresh: Bool) async throws -> [String] {
            try await stub.modelsList(kind: kind, apiKey: apiKey, baseUrl: baseUrl, refresh: refresh)
        }

        public func adapterLoad(adapterId: String) async throws -> DiscordAdapterConfig {
            try await stub.adapterLoad(adapterId: adapterId)
        }

        public func adapterSave(adapterId: String, config: DiscordAdapterConfig) async throws {
            try await stub.adapterSave(adapterId: adapterId, config: config)
        }

        public func chatHistory() async throws -> [ChatBubble] {
            try await stub.chatHistory()
        }

        public func chatSend(_ content: String) async throws -> ChatBubble {
            try await stub.chatSend(content)
        }

        public func chatStart(adapterId: String, token: String? = nil) async throws -> Bool {
            try await stub.chatStart(adapterId: adapterId, token: token)
        }

        public func chatStop(adapterId: String) async throws -> Bool {
            try await stub.chatStop(adapterId: adapterId)
        }

        public func chatStatus(adapterId: String) async throws -> Bool {
            try await stub.chatStatus(adapterId: adapterId)
        }

        public func chatPairingList(adapterId: String) async throws -> [DiscordPairingRequest] {
            try await stub.chatPairingList(adapterId: adapterId)
        }

        public func chatPairingApprove(adapterId: String, code: String) async throws -> DiscordAllowlistEntry? {
            try await stub.chatPairingApprove(adapterId: adapterId, code: code)
        }

        public func chatPairingReject(adapterId: String, code: String) async throws -> Bool {
            try await stub.chatPairingReject(adapterId: adapterId, code: code)
        }

        public func chatPairingAllowlist(adapterId: String) async throws -> [DiscordAllowlistEntry] {
            try await stub.chatPairingAllowlist(adapterId: adapterId)
        }

        public func chatPairingAllowlistRemove(adapterId: String, senderId: String) async throws -> Bool {
            try await stub.chatPairingAllowlistRemove(adapterId: adapterId, senderId: senderId)
        }

        public func pipelineList() async throws -> [PipelineSummary] {
            try await stub.pipelineList()
        }

        public func pipelineGet(id: String) async throws -> PipelineDetail {
            try await stub.pipelineGet(id: id)
        }

        public func pipelineSave(_ detail: PipelineDetail) async throws -> PipelineDetail {
            try await stub.pipelineSave(detail)
        }

        public func pipelineValidate(yaml: String) async throws -> PipelineValidation {
            try await stub.pipelineValidate(yaml: yaml)
        }

        public func pipelineExecute(id: String) async throws {
            try await stub.pipelineExecute(id: id)
        }

        public func pipelineAuthor(instruction: String, currentYaml: String?) async throws -> PipelineAuthorResult {
            try await stub.pipelineAuthor(instruction: instruction, currentYaml: currentYaml)
        }

        public func cronList() async throws -> [CronJob] {
            try await stub.cronList()
        }

        public func cronCreate(pipelineId: String, schedule: String) async throws -> CronJob {
            try await stub.cronCreate(pipelineId: pipelineId, schedule: schedule)
        }

        public func cronUpdate(id: String, schedule: String?, isActive: Bool?) async throws -> CronJob {
            try await stub.cronUpdate(id: id, schedule: schedule, isActive: isActive)
        }

        public func cronDelete(id: String) async throws {
            try await stub.cronDelete(id: id)
        }

        public func skillList() async throws -> [SkillInfo] {
            try await stub.skillList()
        }

        public func skillAutoGenerate(pipelineId: String) async throws -> SkillInfo {
            try await stub.skillAutoGenerate(pipelineId: pipelineId)
        }

        public func skillInvoke(skillId: String, input: String) async throws -> SkillInvocationResult {
            try await stub.skillInvoke(skillId: skillId, input: input)
        }

        public func skillDelete(id: String) async throws {
            try await stub.skillDelete(id: id)
        }

        public func executionHistory(limit: Int, offset: Int, statusFilter: String?, pipelineId: String?) async throws -> [ExecutionSummary] {
            try await stub.executionHistory(limit: limit, offset: offset, statusFilter: statusFilter, pipelineId: pipelineId)
        }

        public func executionDetail(id: String) async throws -> ExecutionDetail {
            try await stub.executionDetail(id: id)
        }
    }
#endif
