import SwiftUI
import CoreGraphics

/// Main canvas for the pipeline graph editor.
///
/// Layout strategy:
/// - The canvas is a `ZStack` containing a background `Canvas` (which paints
///   the grid + bezier edges) plus per-node `NodeView` overlays. Nodes are
///   regular SwiftUI views (rather than `Canvas` symbols) so we can attach
///   gestures + accessibility cleanly.
/// - Pan: `DragGesture` on background, accumulated into `panOffset`.
/// - Zoom: `MagnificationGesture` on background, accumulated into `zoom`.
/// - Node move: `DragGesture` on each `NodeView`.
/// - Edge draw: tap-and-drag on a port handle. We track the `pendingEdge`
///   from the source node + the cursor location until the drag ends on
///   another node.
public struct PipelineEditorView: View {
    public let pipelineId: String?
    public var initialName: String = "Untitled pipeline"
    public var service: BunServiceProtocol

    @State private var graph: PipelineGraph
    @State private var info: PipelineSummary
    @State private var selectedNodeId: String?
    @State private var pendingEdge: PendingEdge?
    @State private var panOffset: CGSize = .zero
    @State private var dragPan: CGSize = .zero
    @State private var zoom: CGFloat = 1.0
    @State private var pinchZoom: CGFloat = 1.0
    @State private var validationMessage: String?
    @State private var lastSavedAt: Date?
    @State private var isBusy = false

    private struct PendingEdge: Equatable {
        var sourceId: String
        var cursor: CGPoint
    }

    public init(
        pipelineId: String?,
        initialName: String = "Untitled pipeline",
        service: BunServiceProtocol = StubBunService.shared,
        graph: PipelineGraph = .sample
    ) {
        self.pipelineId = pipelineId
        self.initialName = initialName
        self.service = service
        _graph = State(initialValue: graph)
        _info = State(initialValue: PipelineSummary(
            id: pipelineId ?? UUID().uuidString,
            name: initialName,
            isActive: false
        ))
    }

    public var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider()
            canvas
            if let validationMessage {
                Text(validationMessage)
                    .font(.caption)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.orange.opacity(0.15))
            }
        }
        .task { await loadIfNeeded() }
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack(spacing: 12) {
            TextField("Pipeline name", text: Binding(
                get: { info.name },
                set: { info.name = $0 }
            ))
            .textFieldStyle(.roundedBorder)
            .frame(maxWidth: 320)

            Spacer()

            Button {
                Task { await save() }
            } label: { Label("Save", systemImage: "tray.and.arrow.down") }

            Button {
                Task { await run() }
            } label: { Label("Run", systemImage: "play.fill") }

            Button {
                Task { await validate() }
            } label: { Label("Validate", systemImage: "checkmark.shield") }

            Menu {
                Button("Add input") { addNode(kind: .input) }
                Button("Add hidden") { addNode(kind: .hidden) }
                Button("Add output") { addNode(kind: .output) }
                Divider()
                Button("Export YAML", action: exportYAML)
            } label: { Label("More", systemImage: "ellipsis.circle") }
        }
        .padding(8)
        .disabled(isBusy)
    }

    // MARK: - Canvas

    private var canvas: some View {
        GeometryReader { proxy in
            ZStack {
                Color(white: 0.10)
                    .gesture(panGesture)
                    .gesture(zoomGesture)

                Canvas { ctx, _ in
                    drawGrid(in: &ctx, size: proxy.size)
                    drawEdges(in: &ctx)
                    drawPendingEdge(in: &ctx)
                }
                .allowsHitTesting(false)

                ForEach(graph.nodes) { node in
                    NodeView(
                        node: node,
                        selected: node.id == selectedNodeId,
                        onPortPress: { _ in selectedNodeId = node.id }
                    )
                    .position(transformed(node.position))
                    .scaleEffect(zoom * pinchZoom)
                    .onTapGesture { selectedNodeId = node.id }
                    .gesture(nodeDragGesture(node: node))
                    .gesture(edgeDragGesture(node: node))
                    .accessibilityLabel(Text("\(node.kind.rawValue) node \(node.name)"))
                }
            }
            .clipped()
        }
        .frame(minWidth: 480, minHeight: 360)
    }

    // MARK: - Drawing helpers

    private func drawGrid(in ctx: inout GraphicsContext, size: CGSize) {
        let step: CGFloat = 24 * (zoom * pinchZoom)
        var path = Path()
        var x: CGFloat = (panOffset.width + dragPan.width).truncatingRemainder(dividingBy: step)
        while x < size.width {
            path.move(to: CGPoint(x: x, y: 0))
            path.addLine(to: CGPoint(x: x, y: size.height))
            x += step
        }
        var y: CGFloat = (panOffset.height + dragPan.height).truncatingRemainder(dividingBy: step)
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
            // arrowhead
            let arrowSize: CGFloat = 6
            var arrow = Path()
            arrow.move(to: to)
            arrow.addLine(to: CGPoint(x: to.x - arrowSize, y: to.y - arrowSize))
            arrow.addLine(to: CGPoint(x: to.x + arrowSize, y: to.y - arrowSize))
            arrow.closeSubpath()
            ctx.fill(arrow, with: .color(color))
            if let label = edge.label {
                let mid = CGPoint(x: (from.x + to.x) / 2, y: (from.y + to.y) / 2)
                let text = Text(label).font(.caption2).foregroundColor(color)
                ctx.draw(text, at: mid)
            }
        }
    }

    private func drawPendingEdge(in ctx: inout GraphicsContext) {
        guard let pending = pendingEdge,
              let src = graph.node(id: pending.sourceId) else { return }
        let from = transformed(portPoint(node: src, port: .output))
        let shape = EdgeShape(from: from, to: pending.cursor)
        ctx.stroke(shape.path(in: .zero), with: .color(.cyan.opacity(0.8)),
                   style: StrokeStyle(lineWidth: 2, dash: [4, 4]))
    }

    // MARK: - Geometry

    private func transformed(_ p: CGPoint) -> CGPoint {
        let s = zoom * pinchZoom
        let dx = panOffset.width + dragPan.width
        let dy = panOffset.height + dragPan.height
        return CGPoint(x: p.x * s + dx, y: p.y * s + dy)
    }

    private func untransformed(_ p: CGPoint) -> CGPoint {
        let s = zoom * pinchZoom
        let dx = panOffset.width + dragPan.width
        let dy = panOffset.height + dragPan.height
        return CGPoint(x: (p.x - dx) / s, y: (p.y - dy) / s)
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
        MagnificationGesture()
            .onChanged { pinchZoom = $0 }
            .onEnded { value in
                zoom = max(0.25, min(3.0, zoom * value))
                pinchZoom = 1.0
            }
    }

    private func nodeDragGesture(node: PipelineGraphNode) -> some Gesture {
        DragGesture(minimumDistance: 4)
            .onChanged { value in
                let s = zoom * pinchZoom
                graph.updateNode(id: node.id) { n in
                    n.position = CGPoint(
                        x: node.position.x + value.translation.width / s,
                        y: node.position.y + value.translation.height / s
                    )
                }
            }
    }

    /// Edge-draw gesture: long-press initiates an edge from this node's output
    /// port; subsequent drag tracks the cursor; on release, if the cursor is
    /// over another node, an edge is added.
    private func edgeDragGesture(node: PipelineGraphNode) -> some Gesture {
        LongPressGesture(minimumDuration: 0.25)
            .sequenced(before: DragGesture(minimumDistance: 0))
            .onChanged { value in
                switch value {
                case .second(true, let drag?):
                    let cursor = drag.location
                    pendingEdge = PendingEdge(sourceId: node.id, cursor: cursor)
                default:
                    break
                }
            }
            .onEnded { _ in
                if let pending = pendingEdge {
                    finishEdge(from: pending.sourceId, at: pending.cursor)
                }
                pendingEdge = nil
            }
    }

    private func finishEdge(from sourceId: String, at cursor: CGPoint) {
        let logical = untransformed(cursor)
        let target = graph.nodes.first { node in
            let f = node.position
            let half = CGSize(width: NodeView.size.width / 2, height: NodeView.size.height / 2)
            let rect = CGRect(
                x: f.x - half.width, y: f.y - half.height,
                width: NodeView.size.width, height: NodeView.size.height
            )
            return rect.contains(logical) && node.id != sourceId
        }
        guard let target else { return }
        let id = "\(sourceId)->\(target.id)#\(graph.edges.count)"
        let kind: PipelineGraphEdge.Kind = sourceId == target.id ? .loop : .normal
        graph.edges.append(.init(id: id, from: sourceId, to: target.id, kind: kind))
    }

    // MARK: - Actions

    private func addNode(kind: PipelineNodeKind) {
        let id = "n\(graph.nodes.count + 1)"
        let action: PipelineNodeAction = kind == .hidden ? .llm(provider: "claude") : .none
        let pos = CGPoint(x: 200 + CGFloat(graph.nodes.count) * 40,
                          y: 100 + CGFloat(graph.nodes.count) * 40)
        graph.nodes.append(.init(
            id: id, name: id.capitalized, kind: kind,
            action: action, position: pos
        ))
        selectedNodeId = id
    }

    private func loadIfNeeded() async {
        guard let id = pipelineId else { return }
        do {
            let detail = try await service.pipelineGet(id: id)
            info = detail.info
            let parsed = PipelineGraph(yaml: detail.yamlContent)
            if !parsed.nodes.isEmpty { graph = parsed }
        } catch {
            validationMessage = "Failed to load pipeline: \(error.localizedDescription)"
        }
    }

    private func save() async {
        isBusy = true
        defer { isBusy = false }
        do {
            let detail = try await YAMLBridge.save(
                info: info,
                graph: graph,
                service: service
            )
            info = detail.info
            lastSavedAt = Date()
            validationMessage = "Saved at \(Self.timestamp.string(from: lastSavedAt!))"
        } catch {
            validationMessage = "Save failed: \(error.localizedDescription)"
        }
    }

    private func run() async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await service.pipelineExecute(id: info.id)
            validationMessage = "Started run for \(info.name)"
        } catch {
            validationMessage = "Run failed: \(error.localizedDescription)"
        }
    }

    private func validate() async {
        isBusy = true
        defer { isBusy = false }
        do {
            let result = try await YAMLBridge.validate(graph: graph, service: service)
            if result.isValid {
                validationMessage = "Pipeline is valid"
            } else {
                validationMessage = "Invalid: \(result.errors.joined(separator: ", "))"
            }
        } catch {
            validationMessage = "Validation failed: \(error.localizedDescription)"
        }
    }

    private func exportYAML() {
        let yaml = graph.toYAML(name: info.name, description: info.description)
        validationMessage = "YAML (\(yaml.count) chars) ready for export"
        #if os(macOS)
        // best-effort: copy to clipboard
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(yaml, forType: .string)
        #endif
    }

    private static let timestamp: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .none
        f.timeStyle = .medium
        return f
    }()
}

#if canImport(AppKit)
import AppKit
#endif

#Preview {
    PipelineEditorView(pipelineId: "sample")
        .frame(width: 900, height: 640)
}
