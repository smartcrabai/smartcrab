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

public extension PipelineGraph {
    /// Loose YAML parser sufficient for the round-trip tests below. Production
    /// code should favour the Bun engine's parser.
    init(yaml: String) {
        struct Parsed {
            var id: String
            var name: String
            var action: PipelineNodeAction
            var next: [String]
        }

        var collected: [Parsed] = []
        var inNodes = false

        for raw in yaml.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("nodes:") { inNodes = true; continue }
            guard inNodes else { continue }

            if line.hasPrefix("- id:") {
                let id = line.dropFirst("- id:".count).trimmingCharacters(in: .whitespaces)
                collected.append(Parsed(id: id, name: id, action: .none, next: []))
            } else if !collected.isEmpty {
                let idx = collected.count - 1
                if line.hasPrefix("name:") {
                    collected[idx].name = line.dropFirst("name:".count).trimmingCharacters(in: .whitespaces)
                } else if line.hasPrefix("next:") {
                    let v = line.dropFirst("next:".count).trimmingCharacters(in: .whitespaces)
                    if !v.isEmpty { collected[idx].next = [v] }
                } else if line.hasPrefix("type: llm_call") {
                    collected[idx].action = .llm(provider: "claude")
                } else if line.hasPrefix("type: http_request") {
                    collected[idx].action = .http(method: "GET")
                } else if line.hasPrefix("type: shell_command") {
                    collected[idx].action = .shell
                }
            }
        }

        guard !collected.isEmpty else {
            self = .empty
            return
        }

        // Determine kind: nodes with no incoming = input, no outgoing = output, else hidden.
        let incoming: Set<String> = Set(collected.flatMap { $0.next })
        let originX: CGFloat = 200
        let originY: CGFloat = 100

        let nodes = collected.enumerated().map { idx, item -> PipelineGraphNode in
            let hasOutgoing = !item.next.isEmpty
            let hasIncoming = incoming.contains(item.id)
            let kind: PipelineNodeKind
            switch (hasIncoming, hasOutgoing) {
            case (false, true): kind = .input
            case (true, false): kind = .output
            default: kind = .hidden
            }
            return PipelineGraphNode(
                id: item.id,
                name: item.name,
                kind: kind,
                action: item.action,
                position: CGPoint(x: originX, y: originY + CGFloat(idx) * 140)
            )
        }

        let edges = collected.flatMap { item in
            item.next.enumerated().compactMap { i, target -> PipelineGraphEdge? in
                guard !target.isEmpty else { return nil }
                return PipelineGraphEdge(
                    id: "\(item.id)->\(target)#\(i)",
                    from: item.id,
                    to: target
                )
            }
        }

        self = PipelineGraph(nodes: nodes, edges: edges)
    }

    /// Best-effort YAML serializer (sufficient for the Bun engine round-trip
    /// in tests and previews).
    func toYAML(name: String = "pipeline", description: String? = nil) -> String {
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
                for e in outgoing {
                    lines.append("      - \(e.to)")
                }
            }
        }
        return lines.joined(separator: "\n") + "\n"
    }
}
