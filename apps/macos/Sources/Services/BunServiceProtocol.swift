import Foundation

// MARK: - Stub
//
// Minimal stub of the BunService protocol used by Unit 15 (Pipelines) before
// Unit 13 lands the real implementation. When Unit 13 ships its
// `Sources/Services/BunServiceProtocol.swift`, this file should be deleted /
// merged. The shape mirrors the Bun-side `pipeline.*` JSON-RPC commands and is
// kept intentionally small (only what Pipelines consumes).

public struct PipelineSummary: Identifiable, Hashable, Codable, Sendable {
    public let id: String
    public var name: String
    public var description: String?
    public var isActive: Bool
    public var createdAt: String
    public var updatedAt: String

    public init(
        id: String,
        name: String,
        description: String? = nil,
        isActive: Bool = false,
        createdAt: String = "",
        updatedAt: String = ""
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.isActive = isActive
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct PipelineDetail: Codable, Sendable {
    public var info: PipelineSummary
    public var yamlContent: String
    public var maxLoopCount: Int

    public init(info: PipelineSummary, yamlContent: String, maxLoopCount: Int = 10) {
        self.info = info
        self.yamlContent = yamlContent
        self.maxLoopCount = maxLoopCount
    }
}

public struct PipelineValidation: Codable, Sendable {
    public var isValid: Bool
    public var errors: [String]
    public var warnings: [String]
    public var nodeTypes: [String: String]

    public init(
        isValid: Bool = true,
        errors: [String] = [],
        warnings: [String] = [],
        nodeTypes: [String: String] = [:]
    ) {
        self.isValid = isValid
        self.errors = errors
        self.warnings = warnings
        self.nodeTypes = nodeTypes
    }
}

public protocol BunServiceProtocol: AnyObject {
    func pipelineList() async throws -> [PipelineSummary]
    func pipelineGet(id: String) async throws -> PipelineDetail
    func pipelineSave(_ detail: PipelineDetail) async throws -> PipelineDetail
    func pipelineExecute(id: String) async throws
    func pipelineValidate(yaml: String) async throws -> PipelineValidation
}

// MARK: - Mock used by SwiftUI previews + iOS Simulator (Unit 15 ships its own
// minimal mock so the Pipelines views are runnable without Unit 13).

public final class StubBunService: BunServiceProtocol {
    public static let shared = StubBunService()

    private var store: [String: PipelineDetail]

    public init() {
        let sampleYaml = """
        name: example
        version: "1.0"
        trigger:
          type: discord
          triggers: ["!run"]
        nodes:
          - id: start
            name: Start
            next: think
          - id: think
            name: Think
            action:
              type: llm_call
              provider: claude
              prompt: "Hello"
              timeout_secs: 30
            next: done
          - id: done
            name: Done
        """
        let info = PipelineSummary(
            id: "sample",
            name: "Example pipeline",
            description: "Sample pipeline used in previews",
            isActive: true,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01"
        )
        self.store = ["sample": PipelineDetail(info: info, yamlContent: sampleYaml)]
    }

    public func pipelineList() async throws -> [PipelineSummary] {
        store.values.map { $0.info }.sorted { $0.name < $1.name }
    }

    public func pipelineGet(id: String) async throws -> PipelineDetail {
        if let d = store[id] { return d }
        throw NSError(
            domain: "StubBunService",
            code: 404,
            userInfo: [NSLocalizedDescriptionKey: "pipeline not found: \(id)"]
        )
    }

    public func pipelineSave(_ detail: PipelineDetail) async throws -> PipelineDetail {
        store[detail.info.id] = detail
        return detail
    }

    public func pipelineExecute(id: String) async throws {
        _ = try await pipelineGet(id: id)
    }

    public func pipelineValidate(yaml: String) async throws -> PipelineValidation {
        if yaml.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return PipelineValidation(isValid: false, errors: ["yaml is empty"])
        }
        return PipelineValidation(isValid: true)
    }
}
