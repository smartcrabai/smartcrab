import SwiftUI

/// Paginated, filterable list of pipeline executions with status colour
/// coding. Selecting a row drills into `ExecutionLogView`.
///
/// Pass `pipelineId` to scope the list to a single pipeline (used when the
/// view is embedded in the pipeline authoring screen); `showsTitle: false`
/// drops the large heading for embedded contexts.
public struct ExecutionHistoryView: View {
    private let service: any BunServiceProtocol
    private let pageSize: Int
    private let pipelineId: String?
    private let showsTitle: Bool

    @State private var executions: [ExecutionSummary] = []
    @State private var loadError: String?
    @State private var isLoading = false
    @State private var hasMore = true
    @State private var page = 0
    @State private var statusFilter: StatusFilter = .all
    @State private var openedExecution: ExecutionSummary.ID?

    public init(
        service: any BunServiceProtocol,
        pageSize: Int = 50,
        pipelineId: String? = nil,
        showsTitle: Bool = true
    ) {
        self.service = service
        self.pageSize = pageSize
        self.pipelineId = pipelineId
        self.showsTitle = showsTitle
    }

    /// Drill-in is a plain state-driven view swap, not a `NavigationStack`
    /// push: a pushed `navigationDestination` inside the `NavigationSplitView`
    /// detail column leaves the window's sidebar unable to switch tabs on
    /// macOS while the destination is shown.
    public var body: some View {
        Group {
            if let openedExecution {
                ExecutionLogView(
                    service: service,
                    executionId: openedExecution,
                    onBack: { self.openedExecution = nil }
                )
            } else {
                VStack(spacing: 0) {
                    header
                    Divider()
                    content
                }
            }
        }
        .task { await reload() }
        .onChange(of: statusFilter) {
            Task { await reload() }
        }
    }

    // MARK: - Subviews

    private var header: some View {
        HStack(spacing: 12) {
            if showsTitle {
                Text("Execution History").font(.title2).bold()
            }
            Spacer()

            Picker("Status", selection: $statusFilter) {
                ForEach(StatusFilter.allCases) { filter in
                    Text(filter.label).tag(filter)
                }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 360)

            if isLoading { ProgressView().controlSize(.small) }

            Button {
                Task { await reload() }
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
            }
            .disabled(isLoading)
        }
        .padding(12)
    }

    @ViewBuilder
    private var content: some View {
        if let loadError {
            errorState(loadError)
        } else if executions.isEmpty && !isLoading {
            emptyState
        } else {
            list
        }
    }

    private var list: some View {
        List {
            ForEach(executions) { execution in
                Button {
                    openedExecution = execution.id
                } label: {
                    ExecutionRow(execution: execution)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            if hasMore && !executions.isEmpty {
                HStack {
                    Spacer()
                    if isLoading {
                        ProgressView().controlSize(.small)
                    } else {
                        Button("Load more") {
                            Task { await loadNextPage() }
                        }
                    }
                    Spacer()
                }
                .padding(.vertical, 8)
            }
        }
        .listStyle(.inset)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "tray")
                .font(.system(size: 36))
                .foregroundStyle(.secondary)
            Text("No executions yet").font(.headline)
            Text("Run a pipeline to see history here.")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 32))
                .foregroundStyle(.orange)
            Text("Failed to load history").font(.headline)
            Text(message).font(.caption).foregroundStyle(.secondary)
            Button("Retry") { Task { await reload() } }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    // MARK: - Loading

    private func reload() async {
        page = 0
        hasMore = true
        executions = []
        await loadPage(page: 0, replacing: true)
    }

    private func loadNextPage() async {
        await loadPage(page: page + 1, replacing: false)
    }

    private func loadPage(page targetPage: Int, replacing: Bool) async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            let batch = try await service.executionHistory(
                limit: pageSize,
                offset: targetPage * pageSize,
                statusFilter: statusFilter.rpcValue,
                pipelineId: pipelineId
            )
            if replacing {
                executions = batch
            } else {
                executions.append(contentsOf: batch)
            }
            page = targetPage
            hasMore = batch.count == pageSize
        } catch {
            loadError = String(describing: error)
        }
    }
}

// MARK: - Status filter

enum StatusFilter: String, CaseIterable, Identifiable {
    case all
    case running
    case completed
    case failed
    case cancelled

    var id: String {
        rawValue
    }

    var label: String {
        switch self {
        case .all: return "All"
        case .running: return "Running"
        case .completed: return "Completed"
        case .failed: return "Failed"
        case .cancelled: return "Cancelled"
        }
    }

    var rpcValue: String? {
        self == .all ? nil : rawValue
    }
}

// MARK: - Row

private struct ExecutionRow: View {
    let execution: ExecutionSummary

    var body: some View {
        HStack(spacing: 12) {
            ExecutionStatusBadge(status: execution.status)
            VStack(alignment: .leading, spacing: 2) {
                Text(execution.pipelineName).font(.headline)
                HStack(spacing: 8) {
                    Text(execution.triggerType)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("started \(execution.startedAt)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let completed = execution.completedAt {
                        Text("ended \(completed)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
    }
}

/// Colour-coded badge for an execution status string.
///
/// Centralised so list rows and the detail view stay visually consistent.
struct ExecutionStatusBadge: View {
    let status: String

    var body: some View {
        Text(status.capitalized)
            .font(.caption).bold()
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(colour.opacity(0.2))
            .foregroundStyle(colour)
            .clipShape(Capsule())
    }

    private var colour: Color {
        switch status.lowercased() {
        case "completed": return .green
        case "failed": return .red
        case "cancelled": return .orange
        case "running": return .blue
        default: return .secondary
        }
    }
}
