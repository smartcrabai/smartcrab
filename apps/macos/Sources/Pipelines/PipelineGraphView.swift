import SwiftUI

/// Read-only canvas that visualises a `PipelineGraph`. No gestures mutate
/// the graph — node positions come from `PipelineAutoLayout` and only the
/// camera (pan/zoom) reacts to input.
///
/// Extracted from the legacy `PipelineEditorView`. The drawing code (grid,
/// bezier edges, arrowheads, optional edge labels) is preserved; the edit
/// affordances (drag-to-move, long-press-to-draw-edge, addNode menu) are
/// gone.
public struct PipelineGraphView: View {
    public let graph: PipelineGraph

    @State private var panOffset: CGSize = .zero
    @State private var dragPan: CGSize = .zero
    @State private var zoom: CGFloat = 1.0
    @State private var pinchZoom: CGFloat = 1.0

    public init(graph: PipelineGraph) {
        self.graph = graph
    }

    public var body: some View {
        GeometryReader { proxy in
            ZStack {
                Color(white: 0.10)
                    .gesture(panGesture)
                    .gesture(zoomGesture)

                Canvas { ctx, _ in
                    drawGrid(in: &ctx, size: proxy.size)
                    drawEdges(in: &ctx)
                }
                .allowsHitTesting(false)

                ForEach(graph.nodes) { node in
                    NodeView(
                        node: node,
                        triggerLabel: node.kind == .input ? graph.trigger?.label : nil
                    )
                    .position(transformed(node.position))
                    .scaleEffect(currentScale)
                    .accessibilityLabel(Text("\(node.kind.rawValue) node \(node.name)"))
                }

                if graph.nodes.isEmpty {
                    ContentUnavailableView(
                        "Empty pipeline",
                        systemImage: "rectangle.dashed",
                        description: Text("No nodes yet — describe what you want on the left.")
                    )
                }
            }
            .clipped()
        }
        .frame(minWidth: 320, minHeight: 240)
    }

    // MARK: - Drawing

    private func drawGrid(in ctx: inout GraphicsContext, size: CGSize) {
        let step: CGFloat = 24 * currentScale
        let pan = currentPan
        var path = Path()
        var x = pan.width.truncatingRemainder(dividingBy: step)
        while x < size.width {
            path.move(to: CGPoint(x: x, y: 0))
            path.addLine(to: CGPoint(x: x, y: size.height))
            x += step
        }
        var y = pan.height.truncatingRemainder(dividingBy: step)
        while y < size.height {
            path.move(to: CGPoint(x: 0, y: y))
            path.addLine(to: CGPoint(x: size.width, y: y))
            y += step
        }
        ctx.stroke(path, with: .color(.white.opacity(0.05)), lineWidth: 1)
    }

    private func drawEdges(in ctx: inout GraphicsContext) {
        for edge in graph.edges {
            guard let src = graph.node(id: edge.from),
                  let dst = graph.node(id: edge.to) else { continue }
            let from = transformed(portPoint(node: src, port: .output))
            let to = transformed(portPoint(node: dst, port: .input))
            let shape = EdgeShape(from: from, to: to)
            let color: Color = {
                switch edge.kind {
                case .normal: return .white.opacity(0.55)
                case .conditional: return .orange
                case .loop: return .purple
                }
            }()
            ctx.stroke(shape.path(in: .zero), with: .color(color), lineWidth: 2)
            // Arrowhead oriented along the edge direction. With auto-layout most
            // edges flow top→down, but conditional/loop edges can run sideways or
            // upward, so derive the angle from the (from → to) vector rather than
            // assuming a downward arrow.
            let arrowSize: CGFloat = 7
            let angle = atan2(to.y - from.y, to.x - from.x)
            let wingSpread = CGFloat.pi / 7 // half-angle of the arrowhead
            var arrow = Path()
            arrow.move(to: to)
            arrow.addLine(to: CGPoint(
                x: to.x - arrowSize * cos(angle - wingSpread),
                y: to.y - arrowSize * sin(angle - wingSpread)
            ))
            arrow.addLine(to: CGPoint(
                x: to.x - arrowSize * cos(angle + wingSpread),
                y: to.y - arrowSize * sin(angle + wingSpread)
            ))
            arrow.closeSubpath()
            ctx.fill(arrow, with: .color(color))
            if let label = edge.label {
                let mid = CGPoint(x: (from.x + to.x) / 2, y: (from.y + to.y) / 2)
                let text = Text(label).font(.caption2).foregroundStyle(color)
                ctx.draw(text, at: mid)
            }
        }
    }

    // MARK: - Geometry

    private var currentScale: CGFloat {
        zoom * pinchZoom
    }

    private var currentPan: CGSize {
        CGSize(
            width: panOffset.width + dragPan.width,
            height: panOffset.height + dragPan.height
        )
    }

    private func transformed(_ p: CGPoint) -> CGPoint {
        let s = currentScale
        let pan = currentPan
        return CGPoint(x: p.x * s + pan.width, y: p.y * s + pan.height)
    }

    private func portPoint(node: PipelineGraphNode, port: NodeView.Port) -> CGPoint {
        let half = NodeView.size.height / 2
        let dy: CGFloat = port == .output ? half : -half
        return CGPoint(x: node.position.x, y: node.position.y + dy)
    }

    // MARK: - Gestures

    private var panGesture: some Gesture {
        DragGesture()
            .onChanged { dragPan = $0.translation }
            .onEnded { value in
                panOffset.width += value.translation.width
                panOffset.height += value.translation.height
                dragPan = .zero
            }
    }

    private var zoomGesture: some Gesture {
        MagnifyGesture()
            .onChanged { pinchZoom = $0.magnification }
            .onEnded { value in
                zoom = max(0.25, min(3.0, zoom * value.magnification))
                pinchZoom = 1.0
            }
    }
}

#Preview {
    PipelineGraphView(graph: PipelineAutoLayout.apply(to: .sample))
        .frame(width: 720, height: 480)
}
