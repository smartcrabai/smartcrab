import Foundation

/// Bridges between the in-memory `PipelineGraph` and YAML representation owned
/// by the Bun engine. The actual YAML parse/serialise lives on the Bun side
/// (`pipeline.save` / `pipeline.get` round-trip), so this file only exposes
/// the helpers Pipelines views need:
///
/// 1. `PipelineGraph(yaml:)` — best-effort parse used to seed the canvas
///    when the editor first loads a pipeline. Falls back to an empty graph on
///    error.
/// 2. `PipelineGraph.toYAML()` — fallback serialiser used when no Bun service
///    is reachable (iOS preview / unit tests). Production callers should
///    prefer `YAMLBridge.save(...)` which round-trips through Bun.
public enum YAMLBridge {
    /// Send the current graph to the Bun engine for canonical serialisation
    /// and persistence. Returns the canonical detail returned by Bun.
    public static func save(
        info: PipelineSummary,
        graph: PipelineGraph,
        maxLoopCount: Int = 10,
        service: BunServiceProtocol
    ) async throws -> PipelineDetail {
        let yaml = graph.toYAML(name: info.name, description: info.description)
        let detail = PipelineDetail(info: info, yamlContent: yaml, maxLoopCount: maxLoopCount)
        return try await service.pipelineSave(detail)
    }

    /// Validate via Bun. Falls back to a local "non-empty" check if no service.
    public static func validate(
        graph: PipelineGraph,
        service: BunServiceProtocol?
    ) async throws -> PipelineValidation {
        let yaml = graph.toYAML()
        if let service {
            return try await service.pipelineValidate(yaml: yaml)
        }
        return PipelineValidation(isValid: !graph.nodes.isEmpty,
                                  errors: graph.nodes.isEmpty ? ["graph is empty"] : [])
    }
}

extension PipelineGraph {
    /// Loose YAML parser sufficient for the round-trip tests below. Production
    /// code should favour the Bun engine's parser.
    public init(yaml: String) {
        var nodes: [PipelineGraphNode] = []
        var edges: [PipelineGraphEdge] = []

        let lines = yaml.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var inNodes = false
        var current: (id: String, name: String, kind: PipelineNodeKind, action: PipelineNodeAction, next: [String])?
        let flush: (inout [(id: String, name: String, kind: PipelineNodeKind, action: PipelineNodeAction, next: [String])], _: (id: String, name: String, kind: PipelineNodeKind, action: PipelineNodeAction, next: [String])?) -> Void = { acc, n in
            if let n { acc.append(n) }
        }

        var collected: [(id: String, name: String, kind: PipelineNodeKind, action: PipelineNodeAction, next: [String])] = []

        for raw in lines {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("nodes:") { inNodes = true; continue }
            if !inNodes { continue }
            if line.hasPrefix("- id:") {
                flush(&collected, current)
                let id = line.replacingOccurrences(of: "- id:", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
                current = (id: id, name: id, kind: .hidden, action: .none, next: [])
            } else if line.hasPrefix("name:"), current != nil {
                current?.name = line.replacingOccurrences(of: "name:", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
            } else if line.hasPrefix("next:"), current != nil {
                let v = line.replacingOccurrences(of: "next:", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
                current?.next = [v]
            } else if line.hasPrefix("type: llm_call"), current != nil {
                current?.action = .llm(provider: "claude")
            } else if line.hasPrefix("type: http_request"), current != nil {
                current?.action = .http(method: "GET")
            } else if line.hasPrefix("type: shell_command"), current != nil {
                current?.action = .shell
            }
        }
        flush(&collected, current)

        guard !collected.isEmpty else {
            self = .empty
            return
        }

        // Determine kind: first = input, last = output (no `next`), middle = hidden.
        let outgoing: [String: [String]] = Dictionary(uniqueKeysWithValues: collected.map { ($0.id, $0.next) })
        let incoming: Set<String> = Set(collected.flatMap { $0.next })

        let x: CGFloat = 200
        let y: CGFloat = 100
        for (idx, item) in collected.enumerated() {
            let hasOutgoing = !(outgoing[item.id]?.isEmpty ?? true)
            let hasIncoming = incoming.contains(item.id)
            let kind: PipelineNodeKind
            if !hasIncoming && hasOutgoing { kind = .input }
            else if hasIncoming && !hasOutgoing { kind = .output }
            else { kind = .hidden }
            nodes.append(.init(
                id: item.id,
                name: item.name,
                kind: kind,
                action: item.action,
                position: CGPoint(x: x, y: y + CGFloat(idx) * 140)
            ))
        }
        for item in collected {
            for (i, target) in item.next.enumerated() where !target.isEmpty {
                edges.append(.init(
                    id: "\(item.id)->\(target)#\(i)",
                    from: item.id,
                    to: target
                ))
            }
        }
        _ = (x, y)
        self = PipelineGraph(nodes: nodes, edges: edges)
    }

    /// Best-effort YAML serializer (sufficient for the Bun engine round-trip
    /// in tests and previews).
    public func toYAML(name: String = "pipeline", description: String? = nil) -> String {
        var lines: [String] = []
        lines.append("name: \(name)")
        if let description, !description.isEmpty {
            lines.append("description: \(description)")
        }
        lines.append("version: \"1.0\"")
        lines.append("trigger:")
        lines.append("  type: discord")
        lines.append("nodes:")
        for node in nodes {
            lines.append("  - id: \(node.id)")
            lines.append("    name: \(node.name)")
            switch node.action {
            case let .llm(provider):
                lines.append("    action:")
                lines.append("      type: llm_call")
                lines.append("      provider: \(provider)")
                lines.append("      prompt: \"\"")
                lines.append("      timeout_secs: 30")
            case let .http(method):
                lines.append("    action:")
                lines.append("      type: http_request")
                lines.append("      method: \(method)")
                lines.append("      url_template: \"\"")
            case .shell:
                lines.append("    action:")
                lines.append("      type: shell_command")
                lines.append("      command_template: \"\"")
                lines.append("      timeout_secs: 30")
            case .none:
                break
            }
            let outgoing = edges.filter { $0.from == node.id }
            if outgoing.count == 1, let only = outgoing.first {
                lines.append("    next: \(only.to)")
            } else if outgoing.count > 1 {
                lines.append("    next:")
                for e in outgoing { lines.append("      - \(e.to)") }
            }
        }
        return lines.joined(separator: "\n") + "\n"
    }
}
