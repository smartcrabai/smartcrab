// _BunServiceStub.swift
//
// Local stub of `BunServiceProtocol` and supporting RPC types so that the
// Cron / Skills / History views can compile in isolation when Unit 13's
// `Sources/Services/` and `Sources/Core/Generated/RPCTypes.swift` have not
// yet landed on the integration branch.
//
// Once Unit 13 lands, the real `BunServiceProtocol` (in `Sources/Services/`)
// and the generated RPC types take precedence. This file is guarded by a
// custom compilation flag so it can be deleted in a single sweep at merge
// time without re-touching the view files.
//
// Activation: pass `-D BUN_SERVICE_STUB` in OTHER_SWIFT_FLAGS for any target
// that does not yet ship `BunServiceProtocol`. The Unit 13 Xcode project
// must NOT define this flag.

#if BUN_SERVICE_STUB

    import Foundation

    // MARK: - RPC payload types

    public struct CronJob: Identifiable, Hashable, Codable, Sendable {
        public let id: String
        public let pipelineId: String
        public let schedule: String
        public let isActive: Bool
        public let lastRunAt: String?
        public let nextRunAt: String?
        public let createdAt: String
        public let updatedAt: String

        public init(
            id: String,
            pipelineId: String,
            schedule: String,
            isActive: Bool,
            lastRunAt: String?,
            nextRunAt: String?,
            createdAt: String,
            updatedAt: String
        ) {
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

    public struct PipelineSummary: Identifiable, Hashable, Codable, Sendable {
        public let id: String
        public let name: String
        public let description: String?

        public init(id: String, name: String, description: String?) {
            self.id = id
            self.name = name
            self.description = description
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

        public init(
            id: String,
            name: String,
            description: String?,
            filePath: String,
            skillType: String,
            pipelineId: String?,
            createdAt: String,
            updatedAt: String
        ) {
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

        public init(
            id: String,
            pipelineId: String,
            pipelineName: String,
            triggerType: String,
            status: String,
            startedAt: String,
            completedAt: String?
        ) {
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

        public init(
            id: String,
            nodeId: String,
            nodeName: String,
            iteration: Int,
            status: String,
            startedAt: String,
            completedAt: String?,
            errorMessage: String?
        ) {
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

        public init(
            id: Int64,
            nodeId: String?,
            level: String,
            message: String,
            timestamp: String
        ) {
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

        public init(
            id: String,
            pipelineId: String,
            triggerType: String,
            status: String,
            startedAt: String,
            completedAt: String?,
            errorMessage: String?,
            nodeExecutions: [NodeExecution],
            logs: [ExecutionLog]
        ) {
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

    // MARK: - Protocol

    public protocol BunServiceProtocol: AnyObject, Sendable {
        // Cron
        func cronList() async throws -> [CronJob]
        func cronCreate(pipelineId: String, schedule: String) async throws -> CronJob
        func cronUpdate(id: String, schedule: String?, isActive: Bool?) async throws -> CronJob
        func cronDelete(id: String) async throws

        /// Pipelines (read-only access used by views in this unit)
        func pipelineList() async throws -> [PipelineSummary]

        // Skills
        func skillList() async throws -> [SkillInfo]
        func skillAutoGenerate(pipelineId: String) async throws -> SkillInfo
        func skillInvoke(skillId: String, input: String) async throws -> SkillInvocationResult
        func skillDelete(id: String) async throws

        // Execution history
        func executionHistory(limit: Int, offset: Int, statusFilter: String?) async throws -> [ExecutionSummary]
        func executionDetail(id: String) async throws -> ExecutionDetail
    }

#endif
