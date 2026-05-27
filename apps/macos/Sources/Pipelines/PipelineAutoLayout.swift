import CoreGraphics
import Foundation

/// Topological layered auto-layout for a read-only `PipelineGraph` visualisation.
///
/// YAML pipelines don't carry node coordinates, so positions must be derived
/// every time we render. The algorithm is a simple Sugiyama-lite pass:
///
/// 1. Detect "back-edges" (edges from a node to one of its already-laid-out
///    ancestors). These are typically `kind == .loop` edges. Back-edges are
///    excluded from layer assignment so cycles don't break the BFS, but they
///    remain in the rendered graph and curl back as loop arrows.
/// 2. Assign every node a `layer = 1 + max(parent layers)` via BFS from input
///    nodes (in-degree 0 after removing back-edges).
/// 3. Within each layer, order nodes by insertion / parent order to keep the
///    layout deterministic.
/// 4. Convert `(layer, column)` to `(x, y)` using fixed spacing.
public enum PipelineAutoLayout {
    /// Vertical spacing between layers (top→down flow).
    public static let layerSpacing: CGFloat = 140
    /// Horizontal spacing between siblings within a layer.
    public static let columnSpacing: CGFloat = 220
    /// Origin of the first node so the graph isn't flush against the canvas edge.
    public static let origin: CGPoint = .init(x: 200, y: 100)

    /// Returns a copy of `graph` with every node's `position` set by the
    /// layout. Edges are returned unchanged.
    public static func apply(to graph: PipelineGraph) -> PipelineGraph {
        guard !graph.nodes.isEmpty else { return graph }

        // Build adjacency excluding back-edges so the BFS sees only the DAG part.
        let order = graph.nodes.map(\.id)
        let orderIndex: [String: Int] = Dictionary(uniqueKeysWithValues: order.enumerated().map { ($1, $0) })

        var forward: [String: [String]] = [:]
        for edge in graph.edges {
            // Treat `loop` edges and any edge that runs "backwards" in node
            // declaration order as a back-edge. This is a crude heuristic, but
            // YAML pipelines normally declare nodes in execution order so it
            // works well in practice and keeps the layout deterministic.
            let srcIdx = orderIndex[edge.from] ?? Int.max
            let dstIdx = orderIndex[edge.to] ?? -1
            let isBack = edge.kind == .loop || dstIdx <= srcIdx
            if !isBack {
                forward[edge.from, default: []].append(edge.to)
            }
        }

        // Layer assignment: nodes with no forward-incoming edges start at 0.
        var incomingCount: [String: Int] = [:]
        for node in graph.nodes {
            incomingCount[node.id] = 0
        }
        for (_, targets) in forward {
            for t in targets {
                incomingCount[t, default: 0] += 1
            }
        }

        var layer: [String: Int] = [:]
        var queue: [String] = graph.nodes
            .filter { (incomingCount[$0.id] ?? 0) == 0 }
            .map(\.id)
        if queue.isEmpty {
            // Pathological case: every node has an incoming back-edge or the
            // graph is fully cyclic. Fall back to declaration order.
            queue = order
        }
        for id in queue {
            layer[id] = 0
        }

        var head = 0
        while head < queue.count {
            let id = queue[head]; head += 1
            let here = layer[id] ?? 0
            for next in forward[id] ?? [] {
                let proposed = here + 1
                if (layer[next] ?? -1) < proposed {
                    layer[next] = proposed
                }
                incomingCount[next, default: 1] -= 1
                if (incomingCount[next] ?? 0) <= 0, !queue.contains(next) {
                    queue.append(next)
                }
            }
        }

        // Any node missed by BFS (e.g. orphaned by an all-back-edge cluster)
        // gets pinned to layer 0 so it still renders somewhere visible.
        for node in graph.nodes where layer[node.id] == nil {
            layer[node.id] = 0
        }

        // Group by layer, keep stable order = declaration order.
        let maxLayer = layer.values.max() ?? 0
        var byLayer: [[String]] = Array(repeating: [], count: maxLayer + 1)
        for node in graph.nodes {
            byLayer[layer[node.id] ?? 0].append(node.id)
        }

        var positions: [String: CGPoint] = [:]
        for (layerIdx, ids) in byLayer.enumerated() {
            let count = ids.count
            // Center the row horizontally around `origin.x`.
            let totalWidth = CGFloat(max(count - 1, 0)) * columnSpacing
            let startX = origin.x - totalWidth / 2
            for (col, id) in ids.enumerated() {
                positions[id] = CGPoint(
                    x: startX + CGFloat(col) * columnSpacing,
                    y: origin.y + CGFloat(layerIdx) * layerSpacing
                )
            }
        }

        var laidOut = graph
        for idx in laidOut.nodes.indices {
            if let p = positions[laidOut.nodes[idx].id] {
                laidOut.nodes[idx].position = p
            }
        }
        return laidOut
    }
}
