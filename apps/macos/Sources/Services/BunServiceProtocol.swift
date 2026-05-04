// BunServiceProtocol.swift
// Unified contract for the Bun-backed JSON-RPC service. Used by every
// SwiftUI feature (Chat, Settings, Pipelines, Cron, Skills, History).

import Foundation

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

    public init(id: String, kind: String, model: String, envOverrides: [String: String] = [:]) {
        self.id = id
        self.kind = kind
        self.model = model
        self.envOverrides = envOverrides
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

public struct DiscordAdapterConfig: Hashable, Codable {
    public var botTokenEnv: String
    public var notificationChannelId: String
    public var enabled: Bool

    public init(botTokenEnv: String = "", notificationChannelId: String = "", enabled: Bool = false) {
        self.botTokenEnv = botTokenEnv
        self.notificationChannelId = notificationChannelId
        self.enabled = enabled
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

    public init(id: String, name: String, description: String? = nil, isActive: Bool = true) {
        self.id = id
        self.name = name
        self.description = description
        self.isActive = isActive
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

// MARK: - Protocol

@MainActor
public protocol BunServiceProtocol: AnyObject {
    func start() async throws
    func stop() async
    func ping(nonce: String) async throws -> PingResponse

    // Settings
    func settingsLoad() async throws -> SeherConfig
    func settingsSave(_ config: SeherConfig) async throws

    // Adapters (Discord, etc.)
    func adapterLoad(adapterId: String) async throws -> DiscordAdapterConfig
    func adapterSave(adapterId: String, config: DiscordAdapterConfig) async throws

    // Chat (bubble UI)
    func chatHistory() async throws -> [ChatBubble]
    func chatSend(_ content: String) async throws -> ChatBubble

    // Chat adapter lifecycle
    func chatStart(adapterId: String) async throws -> Bool
    func chatStop(adapterId: String) async throws -> Bool
    func chatStatus(adapterId: String) async throws -> Bool

    // Pipelines
    func pipelineList() async throws -> [PipelineSummary]
    func pipelineGet(id: String) async throws -> PipelineDetail
    func pipelineSave(_ detail: PipelineDetail) async throws -> PipelineDetail
    func pipelineValidate(yaml: String) async throws -> PipelineValidation
    func pipelineExecute(id: String) async throws

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
    func executionHistory(limit: Int, offset: Int, statusFilter: String?) async throws -> [ExecutionSummary]
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
    public func chatStart(adapterId: String) async throws -> Bool {
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

    public func pipelineList() async throws -> [PipelineSummary] {
        [
            PipelineSummary(id: "pl-1", name: "Daily Standup Summary", description: "Aggregates Slack messages."),
            PipelineSummary(id: "pl-2", name: "Issue Triage", description: "Classifies new GitHub issues."),
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

    public func executionHistory(limit _: Int, offset _: Int, statusFilter _: String?) async throws -> [ExecutionSummary] {
        [ExecutionSummary(id: "ex-1", pipelineId: "pl-1", pipelineName: "Daily Standup Summary",
                          triggerType: "manual", status: "succeeded",
                          startedAt: Self.isoNow, completedAt: Self.isoNow)]
    }

    public func executionDetail(id: String) async throws -> ExecutionDetail {
        ExecutionDetail(id: id, pipelineId: "pl-1", triggerType: "manual", status: "succeeded",
                        startedAt: Self.isoNow, completedAt: Self.isoNow, errorMessage: nil,
                        nodeExecutions: [], logs: [])
    }
}
