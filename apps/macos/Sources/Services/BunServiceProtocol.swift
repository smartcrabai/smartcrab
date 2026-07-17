// BunServiceProtocol.swift
// Unified contract for the Bun-backed JSON-RPC service. Used by every
// SwiftUI feature (Chat, Settings, Pipelines, Skills, History).

import Foundation

// MARK: - Shared filesystem locations

public enum SmartCrabPaths {
    /// `~/Library/Logs/SmartCrab/bun-service.log`. `BunServiceMacOS` tees the
    /// bun-service stderr to this file (GUI-launched apps otherwise lose
    /// stderr to /dev/null); `LogsView` tails it for in-app inspection.
    public static var bunServiceLog: URL {
        let library = FileManager.default
            .urls(for: .libraryDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library")
        return library.appendingPathComponent("Logs/SmartCrab/bun-service.log")
    }
}

// MARK: - View-side domain types (consumed by SwiftUI views directly)

public struct SeherConfig: Hashable, Codable {
    public var providers: [SeherProvider]
    public var priorities: [SeherPriorityRule]
    public var defaults: SeherDefaults

    public init(providers: [SeherProvider] = [], priorities: [SeherPriorityRule] = [], defaults: SeherDefaults = .init()) {
        self.providers = providers
        self.priorities = priorities
        self.defaults = defaults
    }
}

public struct SeherProvider: Identifiable, Hashable, Codable {
    public var id: String
    public var kind: String
    public var model: String
    public var envOverrides: [String: String]
    /// Stable SwiftUI row identity; not persisted. Lets the user edit `id`
    /// without ForEach tearing down the row (which would drop TextField focus).
    public let rowKey: UUID

    public init(id: String, kind: String, model: String, envOverrides: [String: String] = [:]) {
        self.id = id
        self.kind = kind
        self.model = model
        self.envOverrides = envOverrides
        rowKey = UUID()
    }

    private enum CodingKeys: String, CodingKey {
        case id, kind, model, envOverrides
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        kind = try container.decode(String.self, forKey: .kind)
        model = try container.decode(String.self, forKey: .model)
        envOverrides = try container.decodeIfPresent([String: String].self, forKey: .envOverrides) ?? [:]
        rowKey = UUID()
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(kind, forKey: .kind)
        try container.encode(model, forKey: .model)
        try container.encode(envOverrides, forKey: .envOverrides)
    }

    public static func == (lhs: SeherProvider, rhs: SeherProvider) -> Bool {
        lhs.id == rhs.id
            && lhs.kind == rhs.kind
            && lhs.model == rhs.model
            && lhs.envOverrides == rhs.envOverrides
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
        hasher.combine(kind)
        hasher.combine(model)
        hasher.combine(envOverrides)
    }
}

/// Model-id suggestions shown in the provider editor's model dropdown.
///
/// `fallback(for:)` is a hardcoded baseline shown immediately and used when a
/// live fetch is unavailable (not signed in, no API key, offline). For kinds
/// that `supportsFetch`, the editor augments these with `models.list` — pi does
/// a live API fetch (GitHub Copilot token exchange, OpenAI-compatible
/// `/v1/models`). `openai-codex` has no listing endpoint, so its curated set is
/// authoritative and never fetched.
public enum SeherModelCatalog {
    public static func fallback(for kind: String) -> [String] {
        switch kind {
        case "anthropic":
            // Anthropic API model ids (see the claude-api reference).
            return [
                "claude-opus-4-8",
                "claude-opus-4-7",
                "claude-opus-4-6",
                "claude-sonnet-4-6",
                "claude-haiku-4-5",
            ]
        case "openai":
            return [
                "gpt-5",
                "gpt-5-mini",
                "gpt-4.1",
                "gpt-4o",
                "gpt-4o-mini",
                "o3",
                "o4-mini",
            ]
        case "copilot":
            // GitHub Copilot model ids (vary by account plan; the live fetch
            // reflects the account's actual set). This is only the placeholder
            // shown before that fetch resolves. These dotted ids are Copilot's
            // own, not the Anthropic API's.
            return [
                "gpt-5.1",
                "gpt-5",
                "gpt-4.1",
                "claude-opus-4.5",
                "claude-sonnet-4.5",
                "gemini-3-pro-preview",
            ]
        case "openai-codex":
            // OpenAI Codex (ChatGPT sign-in) curated set — no listing endpoint.
            return [
                "gpt-5.5",
                "gpt-5.4",
                "gpt-5.4-mini",
                "gpt-5.3-codex-spark",
            ]
        default:
            return []
        }
    }

    /// Whether the kind supports a live `models.list` fetch. `openai-codex` is
    /// a fixed curated set with no listing endpoint, so it is excluded.
    public static func supportsFetch(_ kind: String) -> Bool {
        switch kind {
        case "anthropic", "openai", "copilot":
            return true
        default:
            return false
        }
    }
}

public struct SeherPriorityRule: Identifiable, Hashable, Codable {
    public var id: UUID
    public var providerId: String
    public var weight: Int
    public var weekdayFilter: [Int]
    public var hourStart: Int
    public var hourEnd: Int
    public var condition: String

    public init(id: UUID = UUID(), providerId: String, weight: Int = 1, weekdayFilter: [Int] = [], hourStart: Int = 0, hourEnd: Int = 24, condition: String = "") {
        self.id = id
        self.providerId = providerId
        self.weight = weight
        self.weekdayFilter = weekdayFilter
        self.hourStart = hourStart
        self.hourEnd = hourEnd
        self.condition = condition
    }
}

public struct SeherDefaults: Hashable, Codable {
    public var fallbackProviderId: String
    public var rateLimitBackoffSeconds: Int

    public init(fallbackProviderId: String = "", rateLimitBackoffSeconds: Int = 30) {
        self.fallbackProviderId = fallbackProviderId
        self.rateLimitBackoffSeconds = rateLimitBackoffSeconds
    }
}

// MARK: - Provider authentication (seher-bridge device flow / OAuth)

/// Which interaction `auth.start` kicked off. `deviceCode` shows a user code
/// to enter on the verification page; `browser` just opens the authorize URL
/// (the bridge listens for the localhost callback).
public enum AuthFlowKind: String, Codable, Sendable {
    case deviceCode = "device-code"
    case browser
}

/// Result of `auth.start`. The wire shape is snake_case (`session_id`,
/// `user_code`, ...) and maps onto these camelCase properties via the
/// client's convertFromSnakeCase decoding.
public struct AuthStartResult: Codable, Sendable {
    public var sessionId: String
    public var flow: AuthFlowKind
    public var userCode: String?
    public var verificationUri: String?
    public var verificationUriComplete: String?
    public var expiresIn: Int?
    public var url: String?

    public init(sessionId: String, flow: AuthFlowKind, userCode: String? = nil,
                verificationUri: String? = nil, verificationUriComplete: String? = nil,
                expiresIn: Int? = nil, url: String? = nil)
    {
        self.sessionId = sessionId
        self.flow = flow
        self.userCode = userCode
        self.verificationUri = verificationUri
        self.verificationUriComplete = verificationUriComplete
        self.expiresIn = expiresIn
        self.url = url
    }
}

public enum AuthSessionState: String, Codable, Sendable {
    case pending, done, error
}

/// Result of `auth.status` polling.
public struct AuthSessionStatus: Codable, Sendable {
    public var state: AuthSessionState
    public var message: String?

    public init(state: AuthSessionState, message: String? = nil) {
        self.state = state
        self.message = message
    }
}

/// Credential state for one provider, mirrored from pi's auth.json via
/// `seher-bridge auth status`. `status` is one of: none | api_key |
/// oauth_valid | oauth_expired | bearer | aws | service_key (kept as a raw
/// string so newer bridge values degrade gracefully).
public struct ProviderCredentialStatus: Hashable, Codable, Sendable {
    public var status: String
    public var expiresInMs: Int?
    public var expiredByMs: Int?

    public init(status: String, expiresInMs: Int? = nil, expiredByMs: Int? = nil) {
        self.status = status
        self.expiresInMs = expiresInMs
        self.expiredByMs = expiredByMs
    }
}

/// Result of `auth.credential-status`. Keyed by pi canonical provider id
/// (github-copilot / openai-codex / anthropic / openai).
public struct CredentialStatusResult: Codable, Sendable {
    public var bridgeAvailable: Bool
    public var providers: [String: ProviderCredentialStatus]

    public init(bridgeAvailable: Bool, providers: [String: ProviderCredentialStatus] = [:]) {
        self.bridgeAvailable = bridgeAvailable
        self.providers = providers
    }
}

public enum DiscordDmPolicy: String, CaseIterable, Hashable, Codable, Sendable {
    /// Issue a pairing code to unknown DM senders. Default.
    case pairing
    /// Drop DMs from anyone not in the allowlist. No reply.
    case allowlist
    /// Ignore DMs entirely.
    case disabled
}

public struct DiscordAdapterConfig: Hashable, Codable {
    public var enabled: Bool
    public var dmPolicy: DiscordDmPolicy

    public init(
        enabled: Bool = false,
        dmPolicy: DiscordDmPolicy = .pairing
    ) {
        self.enabled = enabled
        self.dmPolicy = dmPolicy
    }

    private enum CodingKeys: String, CodingKey {
        case enabled
        case dmPolicy
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabled = (try? c.decode(Bool.self, forKey: .enabled)) ?? false
        // Tolerate older config rows that predate dmPolicy.
        dmPolicy = (try? c.decode(DiscordDmPolicy.self, forKey: .dmPolicy)) ?? .pairing
    }
}

public struct DiscordPairingRequest: Identifiable, Hashable, Codable, Sendable {
    public let adapterId: String
    public let senderId: String
    public let code: String
    public let meta: [String: String]
    public let createdAt: Date
    public let lastSeenAt: Date

    public var id: String {
        "\(adapterId):\(senderId)"
    }

    public init(adapterId: String, senderId: String, code: String,
                meta: [String: String], createdAt: Date, lastSeenAt: Date)
    {
        self.adapterId = adapterId
        self.senderId = senderId
        self.code = code
        self.meta = meta
        self.createdAt = createdAt
        self.lastSeenAt = lastSeenAt
    }

    public var displayName: String {
        meta["tag"] ?? meta["name"] ?? senderId
    }
}

public struct DiscordAllowlistEntry: Identifiable, Hashable, Codable, Sendable {
    public let adapterId: String
    public let senderId: String
    public let meta: [String: String]
    public let approvedAt: Date

    public var id: String {
        "\(adapterId):\(senderId)"
    }

    public init(adapterId: String, senderId: String, meta: [String: String], approvedAt: Date) {
        self.adapterId = adapterId
        self.senderId = senderId
        self.meta = meta
        self.approvedAt = approvedAt
    }

    public var displayName: String {
        meta["tag"] ?? meta["name"] ?? senderId
    }
}

public struct ChatBubble: Identifiable, Hashable, Codable {
    public enum Role: String, Codable, Hashable, Sendable { case system, user, assistant }
    public let id: UUID
    public let role: Role
    public let content: String
    public let createdAt: Date

    public init(id: UUID = UUID(), role: Role, content: String, createdAt: Date = Date()) {
        self.id = id
        self.role = role
        self.content = content
        self.createdAt = createdAt
    }
}

public struct PipelineSummary: Identifiable, Hashable, Codable, Sendable {
    public var id: String
    public var name: String
    public var description: String?
    public var isActive: Bool
    /// Status of the most recent execution ("running" / "completed" /
    /// "failed" / "cancelled"), or nil if the pipeline has never run.
    public var lastExecutionStatus: String?

    public init(
        id: String,
        name: String,
        description: String? = nil,
        isActive: Bool = true,
        lastExecutionStatus: String? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.isActive = isActive
        self.lastExecutionStatus = lastExecutionStatus
    }
}

public struct PipelineDetail: Hashable, Codable, Sendable {
    public let info: PipelineSummary
    public let yamlContent: String
    public let maxLoopCount: Int

    public init(info: PipelineSummary, yamlContent: String, maxLoopCount: Int = 10) {
        self.info = info
        self.yamlContent = yamlContent
        self.maxLoopCount = maxLoopCount
    }
}

public struct PipelineValidation: Hashable, Codable, Sendable {
    public let isValid: Bool
    public let errors: [String]

    public init(isValid: Bool, errors: [String]) {
        self.isValid = isValid
        self.errors = errors
    }
}

/// Result returned by `pipeline.author` (natural-language pipeline generation).
public struct PipelineAuthorResult: Hashable, Codable, Sendable {
    public let yaml: String
    public let explanation: String
    /// The seher agent kind that produced the result (claude / copilot / pi /
    /// registry-fallback) — not a model id.
    public let kind: String

    public init(yaml: String, explanation: String, kind: String) {
        self.yaml = yaml
        self.explanation = explanation
        self.kind = kind
    }
}

public struct CronJob: Identifiable, Hashable, Codable, Sendable {
    public let id: String
    public let pipelineId: String
    public let schedule: String
    public let isActive: Bool
    public let lastRunAt: String?
    public let nextRunAt: String?
    public let createdAt: String
    public let updatedAt: String

    public init(id: String, pipelineId: String, schedule: String, isActive: Bool, lastRunAt: String?, nextRunAt: String?, createdAt: String, updatedAt: String) {
        self.id = id
        self.pipelineId = pipelineId
        self.schedule = schedule
        self.isActive = isActive
        self.lastRunAt = lastRunAt
        self.nextRunAt = nextRunAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct SkillInfo: Identifiable, Hashable, Codable, Sendable {
    public let id: String
    public let name: String
    public let description: String?
    public let filePath: String
    public let skillType: String
    public let pipelineId: String?
    public let createdAt: String
    public let updatedAt: String

    public init(id: String, name: String, description: String?, filePath: String, skillType: String, pipelineId: String?, createdAt: String, updatedAt: String) {
        self.id = id
        self.name = name
        self.description = description
        self.filePath = filePath
        self.skillType = skillType
        self.pipelineId = pipelineId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct SkillInvocationResult: Hashable, Codable, Sendable {
    public let skillId: String
    public let skillName: String
    public let output: String

    public init(skillId: String, skillName: String, output: String) {
        self.skillId = skillId
        self.skillName = skillName
        self.output = output
    }
}

public struct ExecutionSummary: Identifiable, Hashable, Codable, Sendable {
    public let id: String
    public let pipelineId: String
    public let pipelineName: String
    public let triggerType: String
    public let status: String
    public let startedAt: String
    public let completedAt: String?

    public init(id: String, pipelineId: String, pipelineName: String, triggerType: String, status: String, startedAt: String, completedAt: String?) {
        self.id = id
        self.pipelineId = pipelineId
        self.pipelineName = pipelineName
        self.triggerType = triggerType
        self.status = status
        self.startedAt = startedAt
        self.completedAt = completedAt
    }
}

public struct NodeExecution: Identifiable, Hashable, Codable, Sendable {
    public let id: String
    public let nodeId: String
    public let nodeName: String
    public let iteration: Int
    public let status: String
    public let startedAt: String
    public let completedAt: String?
    public let errorMessage: String?

    public init(id: String, nodeId: String, nodeName: String, iteration: Int, status: String, startedAt: String, completedAt: String?, errorMessage: String?) {
        self.id = id
        self.nodeId = nodeId
        self.nodeName = nodeName
        self.iteration = iteration
        self.status = status
        self.startedAt = startedAt
        self.completedAt = completedAt
        self.errorMessage = errorMessage
    }
}

public struct ExecutionLog: Identifiable, Hashable, Codable, Sendable {
    public let id: Int64
    public let nodeId: String?
    public let level: String
    public let message: String
    public let timestamp: String

    public init(id: Int64, nodeId: String?, level: String, message: String, timestamp: String) {
        self.id = id
        self.nodeId = nodeId
        self.level = level
        self.message = message
        self.timestamp = timestamp
    }
}

public struct ExecutionDetail: Hashable, Codable, Sendable {
    public let id: String
    public let pipelineId: String
    public let triggerType: String
    public let status: String
    public let startedAt: String
    public let completedAt: String?
    public let errorMessage: String?
    public let nodeExecutions: [NodeExecution]
    public let logs: [ExecutionLog]

    public init(id: String, pipelineId: String, triggerType: String, status: String, startedAt: String, completedAt: String?, errorMessage: String?, nodeExecutions: [NodeExecution], logs: [ExecutionLog]) {
        self.id = id
        self.pipelineId = pipelineId
        self.triggerType = triggerType
        self.status = status
        self.startedAt = startedAt
        self.completedAt = completedAt
        self.errorMessage = errorMessage
        self.nodeExecutions = nodeExecutions
        self.logs = logs
    }
}

// MARK: - JSON-RPC envelope (used by BunServiceMacOS)

public struct PingRequestEnvelope: Codable, Sendable, Equatable {
    public let nonce: String
    public init(nonce: String) {
        self.nonce = nonce
    }
}

public struct RPCRequestEnvelope<P: Encodable & Sendable>: Encodable, Sendable {
    public let jsonrpc: String
    public let id: String
    public let method: String
    public let params: P

    public init(id: String, method: String, params: P) {
        jsonrpc = JSONRPC_VERSION
        self.id = id
        self.method = method
        self.params = params
    }
}

public struct RPCResponseEnvelope<R: Decodable & Sendable>: Decodable, Sendable {
    public let jsonrpc: String
    public let id: String?
    public let result: R?
    public let error: JSONRPCError?
}

// MARK: - Errors

public enum BunServiceError: Error, Sendable {
    case binaryMissing
    case notRunning
    case malformedResponse
    case notImplemented(String)
}

extension JSONRPCError: LocalizedError {
    /// Surface the RPC message instead of Swift's "(error N.)" fallback.
    public var errorDescription: String? {
        message
    }
}

extension BunServiceError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .binaryMissing:
            return "Embedded smartcrab-service binary is missing from the app bundle."
        case .notRunning:
            return "Bun service is not running."
        case .malformedResponse:
            return "Bun service returned a malformed response."
        case let .notImplemented(name):
            return "Operation '\(name)' is not implemented."
        }
    }
}

// MARK: - Protocol

@MainActor
public protocol BunServiceProtocol: AnyObject {
    func start() async throws
    func stop() async
    func ping(nonce: String) async throws -> PingResponse

    // Settings
    func settingsLoad() async throws -> SeherConfig
    func settingsSave(_ config: SeherConfig) async throws

    // Provider authentication (seher-bridge device flow / OAuth)
    func authStart(kind: String) async throws -> AuthStartResult
    func authStatus(sessionId: String) async throws -> AuthSessionStatus
    func authCancel(sessionId: String) async throws
    func authCredentialStatus() async throws -> CredentialStatusResult

    /// Available model ids for a provider `kind`. `apiKey` / `baseUrl` carry the
    /// editor-entered credential for key-based kinds (anthropic / openai) since
    /// it may not be persisted to auth.json yet; OAuth kinds (copilot) ignore
    /// them and read auth.json. `refresh` bypasses pi's model cache (the manual
    /// "Refresh" action). Not supported for `openai-codex`.
    func modelsList(kind: String, apiKey: String?, baseUrl: String?, refresh: Bool) async throws -> [String]

    // Adapters (Discord, etc.)
    func adapterLoad(adapterId: String) async throws -> DiscordAdapterConfig
    func adapterSave(adapterId: String, config: DiscordAdapterConfig) async throws

    // Chat (bubble UI)
    func chatHistory() async throws -> [ChatBubble]
    func chatSend(_ content: String) async throws -> ChatBubble

    // Chat adapter lifecycle
    func chatStart(adapterId: String, token: String?) async throws -> Bool
    func chatStop(adapterId: String) async throws -> Bool
    func chatStatus(adapterId: String) async throws -> Bool

    // Chat DM pairing
    func chatPairingList(adapterId: String) async throws -> [DiscordPairingRequest]
    func chatPairingApprove(adapterId: String, code: String) async throws -> DiscordAllowlistEntry?
    func chatPairingReject(adapterId: String, code: String) async throws -> Bool
    func chatPairingAllowlist(adapterId: String) async throws -> [DiscordAllowlistEntry]
    func chatPairingAllowlistRemove(adapterId: String, senderId: String) async throws -> Bool

    // Pipelines
    func pipelineList() async throws -> [PipelineSummary]
    func pipelineGet(id: String) async throws -> PipelineDetail
    func pipelineSave(_ detail: PipelineDetail) async throws -> PipelineDetail
    func pipelineValidate(yaml: String) async throws -> PipelineValidation
    func pipelineExecute(id: String) async throws
    /// Natural-language pipeline authoring. `currentYaml` is `nil` for fresh
    /// creation, or the existing YAML for refinement.
    func pipelineAuthor(instruction: String, currentYaml: String?) async throws -> PipelineAuthorResult

    // Cron
    func cronList() async throws -> [CronJob]
    func cronCreate(pipelineId: String, schedule: String) async throws -> CronJob
    func cronUpdate(id: String, schedule: String?, isActive: Bool?) async throws -> CronJob
    func cronDelete(id: String) async throws

    // Skills
    func skillList() async throws -> [SkillInfo]
    func skillAutoGenerate(pipelineId: String) async throws -> SkillInfo
    func skillInvoke(skillId: String, input: String) async throws -> SkillInvocationResult
    func skillDelete(id: String) async throws

    // Execution history
    /// `pipelineId` narrows the history to a single pipeline; `nil` returns
    /// executions across all pipelines.
    func executionHistory(limit: Int, offset: Int, statusFilter: String?, pipelineId: String?) async throws -> [ExecutionSummary]
    func executionDetail(id: String) async throws -> ExecutionDetail
}

// MARK: - StubBunService (in-memory for SwiftUI previews / iOS Simulator)

@MainActor
public final class StubBunService: BunServiceProtocol {
    public static let shared = StubBunService()

    private var seherConfig = SeherConfig()
    private var discordConfig = DiscordAdapterConfig()
    private var chatBubbles: [ChatBubble] = [
        ChatBubble(role: .assistant, content: "Welcome to SmartCrab. How can I help today?"),
    ]

    private static let isoNow: String = ISO8601DateFormatter().string(from: Date())

    public init() {}

    public func start() async throws {}
    public func stop() async {}
    public func ping(nonce: String) async throws -> PingResponse {
        PingResponse(nonce: nonce, serverTime: ISO8601DateFormatter().string(from: Date()))
    }

    public func settingsLoad() async throws -> SeherConfig {
        seherConfig
    }

    public func settingsSave(_ config: SeherConfig) async throws {
        seherConfig = config
    }

    /// Per-session poll counter so the auth sheet renders one "pending" pass
    /// before flipping to done in previews / the iOS Simulator.
    private var authPollCounts: [String: Int] = [:]

    public func authStart(kind: String) async throws -> AuthStartResult {
        let sessionId = "stub-\(UUID().uuidString.prefix(8))"
        if kind == "openai-codex" {
            return AuthStartResult(
                sessionId: sessionId, flow: .browser,
                url: "https://auth.openai.com/oauth/authorize?stub=1"
            )
        }
        return AuthStartResult(
            sessionId: sessionId, flow: .deviceCode,
            userCode: "WDJB-MJHT",
            verificationUri: "https://github.com/login/device",
            verificationUriComplete: "https://github.com/login/device?user_code=WDJB-MJHT",
            expiresIn: 899
        )
    }

    public func authStatus(sessionId: String) async throws -> AuthSessionStatus {
        let polls = (authPollCounts[sessionId] ?? 0) + 1
        authPollCounts[sessionId] = polls
        return polls < 2 ? AuthSessionStatus(state: .pending) : AuthSessionStatus(state: .done)
    }

    public func authCancel(sessionId: String) async throws {
        authPollCounts.removeValue(forKey: sessionId)
    }

    public func authCredentialStatus() async throws -> CredentialStatusResult {
        CredentialStatusResult(bridgeAvailable: true, providers: [
            "github-copilot": ProviderCredentialStatus(status: "oauth_valid", expiresInMs: 3_500_000),
            "openai-codex": ProviderCredentialStatus(status: "none"),
            "anthropic": ProviderCredentialStatus(status: "api_key"),
            "openai": ProviderCredentialStatus(status: "none"),
        ])
    }

    public func modelsList(kind: String, apiKey _: String?, baseUrl _: String?, refresh _: Bool) async throws -> [String] {
        // In-memory previews / Simulator: no bridge, so return the hardcoded baseline.
        SeherModelCatalog.fallback(for: kind)
    }

    public func adapterLoad(adapterId _: String) async throws -> DiscordAdapterConfig {
        discordConfig
    }

    public func adapterSave(adapterId _: String, config: DiscordAdapterConfig) async throws {
        discordConfig = config
    }

    public func chatHistory() async throws -> [ChatBubble] {
        chatBubbles
    }

    public func chatSend(_ content: String) async throws -> ChatBubble {
        let user = ChatBubble(role: .user, content: content)
        chatBubbles.append(user)
        let reply = ChatBubble(role: .assistant, content: "Mock response to: \(content)")
        chatBubbles.append(reply)
        return reply
    }

    private var adapterRunning: [String: Bool] = [:]
    public func chatStart(adapterId: String, token _: String? = nil) async throws -> Bool {
        adapterRunning[adapterId] = true
        return true
    }

    public func chatStop(adapterId: String) async throws -> Bool {
        adapterRunning[adapterId] = false
        return false
    }

    public func chatStatus(adapterId: String) async throws -> Bool {
        adapterRunning[adapterId] ?? false
    }

    private var pairingRequests: [String: [DiscordPairingRequest]] = [:]
    private var pairingAllowlist: [String: [DiscordAllowlistEntry]] = [:]

    public func chatPairingList(adapterId: String) async throws -> [DiscordPairingRequest] {
        pairingRequests[adapterId] ?? []
    }

    public func chatPairingApprove(adapterId: String, code: String) async throws -> DiscordAllowlistEntry? {
        let normalized = code.uppercased()
        let pending = pairingRequests[adapterId] ?? []
        guard let request = pending.first(where: { $0.code == normalized }) else { return nil }
        pairingRequests[adapterId] = pending.filter { $0.senderId != request.senderId }
        let entry = DiscordAllowlistEntry(
            adapterId: adapterId, senderId: request.senderId,
            meta: request.meta, approvedAt: Date()
        )
        var list = pairingAllowlist[adapterId] ?? []
        list.removeAll(where: { $0.senderId == entry.senderId })
        list.append(entry)
        pairingAllowlist[adapterId] = list
        return entry
    }

    public func chatPairingReject(adapterId: String, code: String) async throws -> Bool {
        let normalized = code.uppercased()
        let pending = pairingRequests[adapterId] ?? []
        let next = pending.filter { $0.code != normalized }
        if next.count == pending.count {
            return false
        }
        pairingRequests[adapterId] = next
        return true
    }

    public func chatPairingAllowlist(adapterId: String) async throws -> [DiscordAllowlistEntry] {
        pairingAllowlist[adapterId] ?? []
    }

    public func chatPairingAllowlistRemove(adapterId: String, senderId: String) async throws -> Bool {
        let list = pairingAllowlist[adapterId] ?? []
        let next = list.filter { $0.senderId != senderId }
        if next.count == list.count {
            return false
        }
        pairingAllowlist[adapterId] = next
        return true
    }

    public func pipelineList() async throws -> [PipelineSummary] {
        [
            PipelineSummary(id: "pl-1", name: "Daily Standup Summary", description: "Aggregates Slack messages.", lastExecutionStatus: "completed"),
            PipelineSummary(id: "pl-2", name: "Issue Triage", description: "Classifies new GitHub issues.", lastExecutionStatus: "failed"),
            PipelineSummary(id: "pl-3", name: "Release Notes", description: "Drafts release notes from PRs."),
        ]
    }

    public func pipelineGet(id: String) async throws -> PipelineDetail {
        PipelineDetail(info: PipelineSummary(id: id, name: "Stub", description: nil), yamlContent: "nodes: []\n", maxLoopCount: 10)
    }

    public func pipelineSave(_ detail: PipelineDetail) async throws -> PipelineDetail {
        detail
    }

    public func pipelineValidate(yaml _: String) async throws -> PipelineValidation {
        PipelineValidation(isValid: true, errors: [])
    }

    public func pipelineExecute(id _: String) async throws {}

    public func pipelineAuthor(instruction: String, currentYaml: String?) async throws -> PipelineAuthorResult {
        let yaml = currentYaml ?? """
        name: generated-from-stub
        version: "1.0"
        trigger:
          type: cron
          schedule: "0 9 * * *"
        nodes:
          - id: start
            name: Start
            action:
              type: llm_call
              provider: anthropic
              prompt: "\(instruction.replacingOccurrences(of: "\"", with: "\\\""))"
              timeout_secs: 30
        """
        return PipelineAuthorResult(
            yaml: yaml,
            explanation: "(stub) Built a one-node pipeline that runs the instruction through Anthropic.",
            kind: "stub"
        )
    }

    public func cronList() async throws -> [CronJob] {
        [
            CronJob(id: "c-1", pipelineId: "pl-1", schedule: "0 9 * * 1-5", isActive: true,
                    lastRunAt: nil, nextRunAt: nil, createdAt: Self.isoNow, updatedAt: Self.isoNow),
        ]
    }

    public func cronCreate(pipelineId: String, schedule: String) async throws -> CronJob {
        CronJob(id: "c-\(UUID().uuidString.prefix(6))", pipelineId: pipelineId, schedule: schedule, isActive: true,
                lastRunAt: nil, nextRunAt: nil, createdAt: Self.isoNow, updatedAt: Self.isoNow)
    }

    public func cronUpdate(id: String, schedule: String?, isActive: Bool?) async throws -> CronJob {
        CronJob(id: id, pipelineId: "pl-1", schedule: schedule ?? "* * * * *", isActive: isActive ?? true,
                lastRunAt: nil, nextRunAt: nil, createdAt: Self.isoNow, updatedAt: Self.isoNow)
    }

    public func cronDelete(id _: String) async throws {}

    public func skillList() async throws -> [SkillInfo] {
        [
            SkillInfo(id: "sk-1", name: "Web Search", description: "Query the public web.",
                      filePath: "skills/web_search.md", skillType: "builtin", pipelineId: nil,
                      createdAt: Self.isoNow, updatedAt: Self.isoNow),
            SkillInfo(id: "sk-2", name: "Code Review", description: "Inspect a diff and suggest fixes.",
                      filePath: "skills/code_review.md", skillType: "pipeline", pipelineId: "pl-2",
                      createdAt: Self.isoNow, updatedAt: Self.isoNow),
        ]
    }

    public func skillAutoGenerate(pipelineId: String) async throws -> SkillInfo {
        SkillInfo(id: "sk-gen", name: "Auto Skill", description: nil,
                  filePath: "skills/auto.md", skillType: "pipeline", pipelineId: pipelineId,
                  createdAt: Self.isoNow, updatedAt: Self.isoNow)
    }

    public func skillInvoke(skillId: String, input: String) async throws -> SkillInvocationResult {
        SkillInvocationResult(skillId: skillId, skillName: "Stub", output: "echo: \(input)")
    }

    public func skillDelete(id _: String) async throws {}

    public func executionHistory(limit _: Int, offset _: Int, statusFilter _: String?, pipelineId: String?) async throws -> [ExecutionSummary] {
        let all = [ExecutionSummary(id: "ex-1", pipelineId: "pl-1", pipelineName: "Daily Standup Summary",
                                    triggerType: "manual", status: "completed",
                                    startedAt: Self.isoNow, completedAt: Self.isoNow)]
        guard let pipelineId else { return all }
        return all.filter { $0.pipelineId == pipelineId }
    }

    public func executionDetail(id: String) async throws -> ExecutionDetail {
        ExecutionDetail(id: id, pipelineId: "pl-1", triggerType: "manual", status: "completed",
                        startedAt: Self.isoNow, completedAt: Self.isoNow, errorMessage: nil,
                        nodeExecutions: [], logs: [])
    }
}
