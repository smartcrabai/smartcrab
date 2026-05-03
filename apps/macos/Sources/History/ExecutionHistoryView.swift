import SwiftUI

/// Paginated, filterable list of pipeline executions with status colour
/// coding. Selecting a row drills into `ExecutionLogView`.
public struct ExecutionHistoryView: View {
    private let service: any BunServiceProtocol
    private let pageSize: Int

    @State private var executions: [ExecutionSummary] = []
    @State private var loadError: String?
    @State private var isLoading = false
    @State private var hasMore = true
    @State private var page = 0
    @State private var statusFilter: StatusFilter = .all
    @State private var selection: ExecutionSummary.ID?

    public init(service: any BunServiceProtocol, pageSize: Int = 50) {
        self.service = service
        self.pageSize = pageSize
    }

    public var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                header
                Divider()
                content
            }
            .navigationDestination(for: ExecutionSummary.ID.self) { id in
                ExecutionLogView(service: service, executionId: id)
            }
        }
        .task { await reload() }
        .onChange(of: statusFilter) { _, _ in
            Task { await reload() }
        }
    }

    // MARK: - Subviews

    private var header: some View {
        HStack(spacing: 12) {
            Text("Execution History").font(.title2).bold()
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
        List(selection: $selection) {
            ForEach(executions) { execution in
                NavigationLink(value: execution.id) {
                    ExecutionRow(execution: execution)
                }
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
                statusFilter: statusFilter.rpcValue
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

    var id: String { rawValue }

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
