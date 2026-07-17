import CoreGraphics
import Foundation

/// Best-effort YAML → `PipelineGraph` parser used to seed the read-only
/// visualisation in `PipelineGraphView`. The Bun engine owns the canonical
/// parser; this loose scanner only needs to recover enough structure
/// (node ids, names, action kinds, `next` edges) to lay out a graph.
///
/// Node coordinates are NOT read from YAML — pipelines are coordinate-free,
/// so `PipelineAutoLayout` assigns positions after parsing.
public extension PipelineGraph {
    init(yaml: String) {
        struct Parsed {
            var id: String
            var name: String
            var action: PipelineNodeAction
            var next: [String]
            var conditionalNext: [String]
        }

        var collected: [Parsed] = []
        var trigger: PipelineTriggerInfo?
        var inTrigger = false
        // True only while scanning items of the trigger's `triggers:` list,
        // so list items under other keys aren't misattributed.
        var inTriggersList = false
        var inNodes = false
        var inNextBlock = false
        // Indent of the current `conditions:` key, or nil when not inside a
        // conditions block. Used to attribute deeper `next:` lines to
        // conditional branches rather than the node's default `next`.
        var conditionsIndent: Int?

        func unquote(_ s: Substring) -> String {
            var v = s.trimmingCharacters(in: .whitespaces)
            if v.count >= 2, (v.hasPrefix("\"") && v.hasSuffix("\"")) || (v.hasPrefix("'") && v.hasSuffix("'")) {
                v = String(v.dropFirst().dropLast())
            }
            return v
        }

        func stripInlineList(_ s: String) -> [String] {
            // Handle `next: [a, b]` inline flow sequences.
            var v = s
            if v.hasPrefix("["), v.hasSuffix("]") {
                v = String(v.dropFirst().dropLast())
                return v.split(separator: ",")
                    .map { $0.trimmingCharacters(in: .whitespaces) }
                    .filter { !$0.isEmpty }
            }
            return v.isEmpty ? [] : [v]
        }

        for raw in yaml.split(separator: "\n", omittingEmptySubsequences: false) {
            let indent = raw.prefix { $0 == " " }.count
            let line = raw.trimmingCharacters(in: .whitespaces)
            // Top-level `trigger:` block — capture the type and its settings
            // (cron schedule / discord trigger ids) so the canvas can surface
            // them on input nodes. YAML keys are order-free, so the block may
            // appear before or after `nodes:`.
            if indent == 0, line.hasPrefix("trigger:") {
                let v = line.dropFirst("trigger:".count).trimmingCharacters(in: .whitespaces)
                // Flow-style mappings (`trigger: {...}`) aren't parsed; leave
                // the trigger nil rather than recording an empty one.
                if v.isEmpty {
                    trigger = PipelineTriggerInfo()
                    inTrigger = true
                    inTriggersList = false
                }
                inNodes = false
                continue
            }
            if inTrigger {
                if indent == 0, !line.isEmpty, !line.hasPrefix("#") {
                    // Dedent to the next top-level key ends the block; fall
                    // through so that key (e.g. `nodes:`) is still processed.
                    inTrigger = false
                } else {
                    if line.hasPrefix("type:") {
                        trigger?.type = unquote(line.dropFirst("type:".count))
                        inTriggersList = false
                    } else if line.hasPrefix("schedule:") {
                        trigger?.schedule = unquote(line.dropFirst("schedule:".count))
                        inTriggersList = false
                    } else if line.hasPrefix("triggers:") {
                        let v = line.dropFirst("triggers:".count).trimmingCharacters(in: .whitespaces)
                        if v.isEmpty {
                            inTriggersList = true
                        } else {
                            trigger?.triggers = stripInlineList(v).map { unquote(Substring($0)) }
                            inTriggersList = false
                        }
                    } else if inTriggersList, line.hasPrefix("- ") {
                        trigger?.triggers.append(unquote(line.dropFirst(2)))
                    } else if line.contains(":") {
                        // Any other key ends the `triggers:` list.
                        inTriggersList = false
                    }
                    continue
                }
            }
            if line.hasPrefix("nodes:") {
                inNodes = true
                continue
            }
            guard inNodes else { continue }
            if line.isEmpty {
                continue
            }

            if line.hasPrefix("- id:") {
                let id = line.dropFirst("- id:".count).trimmingCharacters(in: .whitespaces)
                collected.append(Parsed(id: id, name: id, action: .none, next: [], conditionalNext: []))
                inNextBlock = false
                conditionsIndent = nil
            } else if !collected.isEmpty {
                let idx = collected.count - 1

                // Dedenting back to (or past) the `conditions:` key ends the block.
                if let ci = conditionsIndent, indent <= ci {
                    conditionsIndent = nil
                }

                // Inside a conditions block: each condition's `next:` is a
                // conditional branch target.
                if conditionsIndent != nil {
                    if line.hasPrefix("next:") {
                        let v = line.dropFirst("next:".count).trimmingCharacters(in: .whitespaces)
                        if !v.isEmpty {
                            collected[idx].conditionalNext.append(contentsOf: stripInlineList(v))
                        }
                    }
                    continue
                }

                if inNextBlock, line.hasPrefix("- ") {
                    let v = line.dropFirst(2).trimmingCharacters(in: .whitespaces)
                    if !v.isEmpty, !v.contains(":") {
                        collected[idx].next.append(v)
                    }
                    continue
                }
                inNextBlock = false
                if line.hasPrefix("name:") {
                    collected[idx].name = line.dropFirst("name:".count).trimmingCharacters(in: .whitespaces)
                } else if line.hasPrefix("conditions:") {
                    conditionsIndent = indent
                } else if line.hasPrefix("next:") {
                    let v = line.dropFirst("next:".count).trimmingCharacters(in: .whitespaces)
                    if v.isEmpty {
                        inNextBlock = true
                    } else {
                        collected[idx].next.append(contentsOf: stripInlineList(v))
                    }
                } else if line.hasPrefix("type: llm_call") {
                    collected[idx].action = .llm(provider: PipelineNodeAction.defaultLLMProvider)
                } else if line.hasPrefix("type: http_request") {
                    collected[idx].action = .http(method: "GET")
                } else if line.hasPrefix("type: shell_command") {
                    collected[idx].action = .shell
                } else if line.hasPrefix("type: chat_send") {
                    collected[idx].action = .chatSend(adapter: "")
                } else if line.hasPrefix("provider:"), case .llm = collected[idx].action {
                    // Replace the placeholder provider with the real one.
                    let v = unquote(line.dropFirst("provider:".count))
                    if !v.isEmpty {
                        collected[idx].action = .llm(provider: v)
                    }
                } else if line.hasPrefix("method:"), case .http = collected[idx].action {
                    let v = unquote(line.dropFirst("method:".count))
                    if !v.isEmpty {
                        collected[idx].action = .http(method: v)
                    }
                } else if line.hasPrefix("adapter:"), case .chatSend = collected[idx].action {
                    let v = unquote(line.dropFirst("adapter:".count))
                    collected[idx].action = .chatSend(adapter: v)
                }
            }
        }

        guard !collected.isEmpty else {
            self = .empty
            return
        }

        // Determine kind: nodes with no incoming = input, no outgoing = output, else hidden.
        let incoming: Set<String> = Set(collected.flatMap { $0.next + $0.conditionalNext })

        let nodes = collected.map { item -> PipelineGraphNode in
            let hasOutgoing = !item.next.isEmpty || !item.conditionalNext.isEmpty
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
                position: .zero
            )
        }

        let edges = collected.flatMap { item -> [PipelineGraphEdge] in
            let normal = item.next.enumerated().compactMap { i, target -> PipelineGraphEdge? in
                guard !target.isEmpty else { return nil }
                return PipelineGraphEdge(
                    id: "\(item.id)->\(target)#\(i)",
                    from: item.id,
                    to: target
                )
            }
            let conditional = item.conditionalNext.enumerated().compactMap { i, target -> PipelineGraphEdge? in
                guard !target.isEmpty else { return nil }
                return PipelineGraphEdge(
                    id: "\(item.id)?>\(target)#\(i)",
                    from: item.id,
                    to: target,
                    kind: .conditional
                )
            }
            return normal + conditional
        }

        self = PipelineGraph(nodes: nodes, edges: edges, trigger: trigger)
    }
}
