import CoreGraphics
import Foundation

// In-memory graph model for the read-only SwiftUI Canvas visualisation. The
// graph is derived from YAML by `PipelineGraph(yaml:)` (see YAMLBridge.swift);
// it is never serialised back. Fields mirror the `NodeAction` union in
// `apps/bun-service/src/engine/yaml-schema.ts`, stripped to what the canvas
// needs to render node kind + a short action label.

public enum PipelineNodeKind: String, Codable, CaseIterable, Sendable {
    case input
    case hidden
    case output
}

public enum PipelineNodeAction: Equatable, Sendable {
    case llm(provider: String)
    case http(method: String)
    case shell
    case chatSend(adapter: String)
    case none

    /// Default LLM provider kind for `llm_call` nodes when the YAML omits one.
    /// Must stay in sync with the `ProviderKind` union in
    /// `packages/seher-config-schema/src/smartcrab-config.ts`.
    public static let defaultLLMProvider: String = "anthropic"

    public var label: String {
        switch self {
        case let .llm(provider): return "LLM (\(provider))"
        case let .http(method): return "HTTP \(method)"
        case .shell: return "Shell"
        case let .chatSend(adapter): return adapter.isEmpty ? "Chat send" : "Chat → \(adapter)"
        case .none: return ""
        }
    }
}

/// Pipeline-level trigger configuration (`trigger:` block in YAML), surfaced
/// on input nodes in the canvas. Mirrors `TriggerConfig` in
/// `apps/bun-service/src/engine/yaml-schema.ts`.
public struct PipelineTriggerInfo: Equatable, Sendable {
    public var type: String
    public var schedule: String?
    public var triggers: [String]

    public init(type: String = "", schedule: String? = nil, triggers: [String] = []) {
        self.type = type
        self.schedule = schedule
        self.triggers = triggers
    }

    /// Short one-line summary rendered inside the input node.
    public var label: String {
        switch type {
        case "cron":
            guard let schedule, !schedule.isEmpty else { return "Cron" }
            return "Cron: \(schedule)"
        case "discord":
            return triggers.isEmpty ? "Discord" : "Discord (\(triggers.count))"
        default:
            return type.isEmpty ? "" : type.capitalized
        }
    }
}

public struct PipelineGraphNode: Identifiable, Equatable, Sendable {
    public let id: String
    public var name: String
    public var kind: PipelineNodeKind
    public var action: PipelineNodeAction
    public var position: CGPoint
    public var status: NodeStatus

    public enum NodeStatus: Equatable, Sendable {
        case idle
        case running
        case success
        case failure
    }

    public init(
        id: String,
        name: String,
        kind: PipelineNodeKind,
        action: PipelineNodeAction = .none,
        position: CGPoint,
        status: NodeStatus = .idle
    ) {
        self.id = id
        self.name = name
        self.kind = kind
        self.action = action
        self.position = position
        self.status = status
    }
}

public struct PipelineGraphEdge: Identifiable, Equatable, Sendable {
    public let id: String
    public var from: String
    public var to: String
    public var label: String?
    public var kind: Kind

    public enum Kind: String, Sendable {
        case normal
        case conditional
        case loop
    }

    public init(id: String, from: String, to: String, label: String? = nil, kind: Kind = .normal) {
        self.id = id
        self.from = from
        self.to = to
        self.label = label
        self.kind = kind
    }
}

public struct PipelineGraph: Equatable, Sendable {
    public var nodes: [PipelineGraphNode]
    public var edges: [PipelineGraphEdge]
    public var trigger: PipelineTriggerInfo?

    public init(
        nodes: [PipelineGraphNode] = [],
        edges: [PipelineGraphEdge] = [],
        trigger: PipelineTriggerInfo? = nil
    ) {
        self.nodes = nodes
        self.edges = edges
        self.trigger = trigger
    }

    public func node(id: String) -> PipelineGraphNode? {
        nodes.first(where: { $0.id == id })
    }

    public mutating func updateNode(id: String, transform: (inout PipelineGraphNode) -> Void) {
        guard let idx = nodes.firstIndex(where: { $0.id == id }) else { return }
        transform(&nodes[idx])
    }

    public static let empty = PipelineGraph()

    /// Sample graph used by previews / iOS Simulator mode.
    public static let sample: PipelineGraph = {
        let nodes: [PipelineGraphNode] = [
            .init(id: "start", name: "Start", kind: .input,
                  position: CGPoint(x: 200, y: 100)),
            .init(id: "think", name: "Think", kind: .hidden,
                  action: .llm(provider: PipelineNodeAction.defaultLLMProvider),
                  position: CGPoint(x: 200, y: 260)),
            .init(id: "fetch", name: "Fetch", kind: .hidden,
                  action: .http(method: "GET"),
                  position: CGPoint(x: 420, y: 260)),
            .init(id: "done", name: "Done", kind: .output,
                  position: CGPoint(x: 320, y: 420)),
        ]
        let edges: [PipelineGraphEdge] = [
            .init(id: "e1", from: "start", to: "think"),
            .init(id: "e2", from: "think", to: "fetch", label: "ok", kind: .conditional),
            .init(id: "e3", from: "fetch", to: "done"),
            .init(id: "e4", from: "think", to: "done", label: "skip", kind: .conditional),
        ]
        return PipelineGraph(nodes: nodes, edges: edges)
    }()
}
