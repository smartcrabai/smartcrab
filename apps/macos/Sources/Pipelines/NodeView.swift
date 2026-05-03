import SwiftUI

/// Visual representation of a single graph node. Mirrors the colour-coded
/// React layer nodes (input = green, hidden = blue, output = red).
public struct NodeView: View {
    public let node: PipelineGraphNode
    public var selected: Bool = false
    public var onPortPress: ((Port) -> Void)?

    public enum Port { case input, output }

    public static let size = CGSize(width: 168, height: 72)

    public init(
        node: PipelineGraphNode,
        selected: Bool = false,
        onPortPress: ((Port) -> Void)? = nil
    ) {
        self.node = node
        self.selected = selected
        self.onPortPress = onPortPress
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: kindIcon)
                    .font(.caption)
                Text(kindLabel)
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                Spacer(minLength: 0)
                statusDot
            }
            .foregroundStyle(accent)

            Text(node.name)
                .font(.headline)
                .foregroundStyle(.primary)
                .lineLimit(1)

            if !node.action.label.isEmpty {
                Text(node.action.label)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(10)
        .frame(width: Self.size.width, height: Self.size.height, alignment: .topLeading)
        .background(background)
        .overlay(border)
        .overlay(alignment: .top) { portHandle(.input) }
        .overlay(alignment: .bottom) { portHandle(.output) }
    }

    // MARK: - Styling

    private var accent: Color {
        switch node.kind {
        case .input: return .green
        case .hidden: return .blue
        case .output: return .red
        }
    }

    private var background: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(accent.opacity(0.18))
    }

    private var border: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .stroke(accent, lineWidth: selected ? 3 : 2)
    }

    private var kindIcon: String {
        switch node.kind {
        case .input: return "arrow.right.circle"
        case .hidden:
            switch node.action {
            case .llm: return "brain"
            case .http: return "globe"
            case .shell: return "terminal"
            case .none: return "circle.grid.2x2"
            }
        case .output: return "checkmark.circle"
        }
    }

    private var kindLabel: String {
        switch node.kind {
        case .input: return "Input"
        case .hidden: return "Hidden"
        case .output: return "Output"
        }
    }

    private var statusDot: some View {
        Circle()
            .fill(statusColor)
            .frame(width: 8, height: 8)
            .opacity(node.status == .idle ? 0 : 1)
    }

    private var statusColor: Color {
        switch node.status {
        case .idle: return .clear
        case .running: return .yellow
        case .success: return .green
        case .failure: return .red
        }
    }

    @ViewBuilder
    private func portHandle(_ port: Port) -> some View {
        // Don't render an input port for `.input` nodes or an output port for
        // `.output` nodes (matches the React node defs).
        if shouldRenderPort(port) {
            Circle()
                .fill(accent)
                .frame(width: 12, height: 12)
                .offset(y: port == .input ? -6 : 6)
                .contentShape(Circle())
                .onTapGesture { onPortPress?(port) }
        }
    }

    private func shouldRenderPort(_ port: Port) -> Bool {
        switch (port, node.kind) {
        case (.input, .input), (.output, .output): return false
        default: return true
        }
    }
}

#Preview {
    HStack(spacing: 24) {
        NodeView(node: .init(id: "a", name: "Trigger", kind: .input,
                             position: .zero))
        NodeView(node: .init(id: "b", name: "Think", kind: .hidden,
                             action: .llm(provider: "claude"),
                             position: .zero, status: .running))
        NodeView(node: .init(id: "c", name: "Done", kind: .output,
                             position: .zero, status: .success))
    }
    .padding()
}
