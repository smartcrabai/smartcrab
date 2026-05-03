import SwiftUI

/// List of scheduled cron jobs with create/delete actions.
///
/// Backed by `BunServiceProtocol`. When running under `SmartCrabPreview`
/// (iOS Simulator), the injected service is the mock implementation that
/// returns deterministic stub data.
public struct CronListView: View {
    private let service: any BunServiceProtocol

    @State private var jobs: [CronJob] = []
    @State private var pipelines: [PipelineSummary] = []
    @State private var loadError: String?
    @State private var isLoading = false
    @State private var selection: CronJob.ID?
    @State private var editing: CronEditTarget?
    @State private var pendingDelete: CronJob?

    public init(service: any BunServiceProtocol) {
        self.service = service
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
        }
        .task { await reload() }
        .sheet(item: $editing) { target in
            CronEditView(
                service: service,
                pipelines: pipelines,
                existing: target.job,
                onSaved: { _ in
                    editing = nil
                    Task { await reload() }
                },
                onCancel: { editing = nil }
            )
        }
        .alert(
            "Delete cron job?",
            isPresented: deleteAlertBinding,
            presenting: pendingDelete
        ) { job in
            Button("Cancel", role: .cancel) { pendingDelete = nil }
            Button("Delete", role: .destructive) {
                Task { await delete(job) }
            }
        } message: { job in
            Text("Schedule \"\(job.schedule)\" will be removed.")
        }
    }

    // MARK: - Subviews

    private var header: some View {
        HStack(spacing: 12) {
            Text("Cron Jobs").font(.title2).bold()
            Spacer()
            if isLoading { ProgressView().controlSize(.small) }
            Button {
                Task { await reload() }
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
            }
            .disabled(isLoading)

            Button {
                editing = .new
            } label: {
                Label("Add", systemImage: "plus")
            }
            .disabled(pipelines.isEmpty)
        }
        .padding(12)
    }

    @ViewBuilder
    private var content: some View {
        if let loadError {
            errorState(loadError)
        } else if jobs.isEmpty && !isLoading {
            emptyState
        } else {
            table
        }
    }

    private var table: some View {
        Table(jobs, selection: $selection) {
            TableColumn("Pipeline") { job in
                Text(pipelineName(for: job.pipelineId))
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            TableColumn("Expression") { job in
                Text(job.schedule).font(.system(.body, design: .monospaced))
            }
            TableColumn("Next Run") { job in
                Text(job.nextRunAt ?? "-").foregroundStyle(.secondary)
            }
            TableColumn("Status") { job in
                StatusBadge(active: job.isActive)
            }
            TableColumn("Actions") { job in
                HStack(spacing: 8) {
                    Button("Edit") { editing = .existing(job) }
                        .buttonStyle(.borderless)
                    Button("Delete", role: .destructive) { pendingDelete = job }
                        .buttonStyle(.borderless)
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "clock.badge.questionmark")
                .font(.system(size: 36))
                .foregroundStyle(.secondary)
            Text("No cron jobs yet").font(.headline)
            Text(pipelines.isEmpty
                 ? "Create a pipeline first, then schedule it here."
                 : "Click Add to schedule a pipeline.")
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
            Text("Failed to load cron jobs").font(.headline)
            Text(message).font(.caption).foregroundStyle(.secondary)
            Button("Retry") { Task { await reload() } }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    // MARK: - Bindings & helpers

    private var deleteAlertBinding: Binding<Bool> {
        Binding(
            get: { pendingDelete != nil },
            set: { if !$0 { pendingDelete = nil } }
        )
    }

    private func pipelineName(for id: String) -> String {
        pipelines.first(where: { $0.id == id })?.name ?? id
    }

    private func reload() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            async let jobsTask = service.cronList()
            async let pipelinesTask = service.pipelineList()
            let (loadedJobs, loadedPipelines) = try await (jobsTask, pipelinesTask)
            jobs = loadedJobs
            pipelines = loadedPipelines
        } catch {
            loadError = String(describing: error)
        }
    }

    private func delete(_ job: CronJob) async {
        pendingDelete = nil
        do {
            try await service.cronDelete(id: job.id)
            await reload()
        } catch {
            loadError = String(describing: error)
        }
    }
}

// MARK: - Edit target

enum CronEditTarget: Identifiable {
    case new
    case existing(CronJob)

    var id: String {
        switch self {
        case .new: return "__new__"
        case .existing(let job): return job.id
        }
    }

    var job: CronJob? {
        if case .existing(let job) = self { return job }
        return nil
    }
}

// MARK: - Status badge

private struct StatusBadge: View {
    let active: Bool
    var body: some View {
        Text(active ? "Active" : "Paused")
            .font(.caption).bold()
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(active ? Color.green.opacity(0.2) : Color.gray.opacity(0.2))
            .foregroundStyle(active ? .green : .secondary)
            .clipShape(Capsule())
    }
}
