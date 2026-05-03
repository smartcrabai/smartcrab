import SwiftUI

/// Detail view for a single execution: shows the metadata, per-node
/// executions, and the chronological log lines.
public struct ExecutionLogView: View {
    private let service: any BunServiceProtocol
    private let executionId: String

    @State private var detail: ExecutionDetail?
    @State private var loadError: String?
    @State private var isLoading = false
    @State private var logLevelFilter: LogLevelFilter = .all
    @State private var nodeFilter: String?

    public init(service: any BunServiceProtocol, executionId: String) {
        self.service = service
        self.executionId = executionId
    }

    public var body: some View {
        Group {
            if let detail {
                content(detail: detail)
            } else if let loadError {
                errorState(loadError)
            } else {
                loadingState
            }
        }
        .navigationTitle("Execution")
        .task { await reload() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await reload() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(isLoading)
            }
        }
    }

    // MARK: - Subviews

    private func content(detail: ExecutionDetail) -> some View {
        #if os(macOS)
            VSplitView {
                metadataAndNodes(detail: detail)
                logsSection(detail: detail)
            }
        #else
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    metadataAndNodes(detail: detail)
                    Divider()
                    logsSection(detail: detail)
                }
            }
        #endif
    }

    private func metadataAndNodes(detail: ExecutionDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                ExecutionStatusBadge(status: detail.status)
                VStack(alignment: .leading) {
                    Text("Execution \(detail.id)").font(.headline)
                    HStack(spacing: 12) {
                        InfoChip(label: "trigger", value: detail.triggerType)
                        InfoChip(label: "started", value: detail.startedAt)
                        if let completed = detail.completedAt {
                            InfoChip(label: "ended", value: completed)
                        }
                    }
                }
                Spacer()
            }

            if let err = detail.errorMessage, !err.isEmpty {
                Text(err)
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(.red)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.red.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            Text("Nodes").font(.headline)
            if detail.nodeExecutions.isEmpty {
                Text("No node executions recorded.").foregroundStyle(.secondary)
            } else {
                Table(detail.nodeExecutions, selection: $nodeFilter) {
                    TableColumn("Node") { Text($0.nodeName) }
                    TableColumn("Iter") { Text("\($0.iteration)") }
                    TableColumn("Status") { ExecutionStatusBadge(status: $0.status) }
                    TableColumn("Started") { Text($0.startedAt).foregroundStyle(.secondary) }
                    TableColumn("Ended") { node in
                        Text(node.completedAt ?? "-").foregroundStyle(.secondary)
                    }
                }
                .frame(minHeight: 160)
            }
        }
        .padding(12)
    }

    private func logsSection(detail: ExecutionDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Logs").font(.headline)
                Spacer()
                Picker("Level", selection: $logLevelFilter) {
                    ForEach(LogLevelFilter.allCases) { level in
                        Text(level.label).tag(level)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 320)

                if nodeFilter != nil {
                    Button {
                        nodeFilter = nil
                    } label: {
                        Label("Clear node filter", systemImage: "xmark.circle")
                    }
                }
            }

            let visibleLogs = filteredLogs(detail.logs)
            if visibleLogs.isEmpty {
                Text("No log entries match the current filters.")
                    .foregroundStyle(.secondary)
                    .padding()
                    .frame(maxWidth: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(visibleLogs) { log in
                            LogLineRow(log: log)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .background(Color.black.opacity(0.04))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
        .padding(12)
        .frame(minHeight: 220)
    }

    private var loadingState: some View {
        ProgressView("Loading execution...")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 32))
                .foregroundStyle(.orange)
            Text("Failed to load execution").font(.headline)
            Text(message).font(.caption).foregroundStyle(.secondary)
            Button("Retry") { Task { await reload() } }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    // MARK: - Filtering & loading

    private func filteredLogs(_ logs: [ExecutionLog]) -> [ExecutionLog] {
        logs.filter { log in
            if let nodeFilter, log.nodeId != nodeFilter { return false }
            if let required = logLevelFilter.rpcValue,
               log.level.lowercased() != required
            {
                return false
            }
            return true
        }
    }

    private func reload() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            detail = try await service.executionDetail(id: executionId)
        } catch {
            loadError = String(describing: error)
        }
    }
}

// MARK: - Log filter

enum LogLevelFilter: String, CaseIterable, Identifiable {
    case all
    case info
    case warn
    case error

    var id: String {
        rawValue
    }

    var label: String {
        switch self {
        case .all: return "All"
        case .info: return "Info"
        case .warn: return "Warn"
        case .error: return "Error"
        }
    }

    var rpcValue: String? {
        self == .all ? nil : rawValue
    }
}

// MARK: - Rows

private struct LogLineRow: View {
    let log: ExecutionLog

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(log.timestamp)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 160, alignment: .leading)
            Text(log.level.uppercased())
                .font(.system(.caption, design: .monospaced).bold())
                .foregroundStyle(levelColour)
                .frame(width: 60, alignment: .leading)
            if let nodeId = log.nodeId {
                Text(nodeId)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .frame(width: 120, alignment: .leading)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Text(log.message)
                .font(.system(.body, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
        .padding(.horizontal, 8)
    }

    private var levelColour: Color {
        switch log.level.lowercased() {
        case "error": return .red
        case "warn", "warning": return .orange
        case "debug", "trace": return .secondary
        default: return .primary
        }
    }
}

private struct InfoChip: View {
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: 4) {
            Text(label).foregroundStyle(.secondary)
            Text(value)
        }
        .font(.caption)
    }
}
