import SwiftUI

/// Per-pipeline schedule management for the pipeline authoring detail pane.
///
/// Cron jobs remain persisted and executed by the Bun service. This view scopes
/// the existing cron CRUD operations to the selected pipeline by filtering
/// `cron.list` client-side and passing a one-item pipeline list to the editor.
public struct PipelineScheduleView: View {
    private let service: any BunServiceProtocol
    private let pipeline: PipelineSummary

    @State private var jobs: [CronJob] = []
    @State private var loadError: String?
    @State private var isLoading = false
    @State private var selection: CronJob.ID?
    @State private var editing: CronEditTarget?
    @State private var pendingDelete: CronJob?

    public init(service: any BunServiceProtocol, pipeline: PipelineSummary) {
        self.service = service
        self.pipeline = pipeline
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
        }
        .task(id: pipeline.id) { await reload() }
        .sheet(item: $editing) { target in
            CronEditView(
                service: service,
                pipelines: [pipeline],
                existing: target.job,
                onSaved: { _ in
                    editing = nil
                    Task { await reload() }
                },
                onCancel: { editing = nil }
            )
        }
        .alert(
            "Delete schedule?",
            isPresented: .isPresenting($pendingDelete),
            presenting: pendingDelete
        ) { job in
            Button("Cancel", role: .cancel) { pendingDelete = nil }
            Button("Delete", role: .destructive) {
                Task { await delete(job) }
            }
        } message: { job in
            Text("Schedule \"\(job.schedule)\" will be removed from \(pipeline.name).")
        }
    }

    // MARK: - Subviews

    private var header: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Schedules").font(.title3).bold()
                Text(pipeline.name.isEmpty ? pipeline.id : pipeline.name)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if isLoading {
                ProgressView().controlSize(.small)
            }
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
            .disabled(pipeline.id.isEmpty)
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
            TableColumn("Expression") { job in
                Text(job.schedule).font(.system(.body, design: .monospaced))
            }
            TableColumn("Status") { job in
                StatusBadge(active: job.isActive)
            }
            TableColumn("Next Run") { job in
                Text(displayDate(job.nextRunAt)).foregroundStyle(.secondary)
            }
            TableColumn("Last Run") { job in
                Text(displayDate(job.lastRunAt)).foregroundStyle(.secondary)
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
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 36))
                .foregroundStyle(.secondary)
            Text("No schedules yet").font(.headline)
            Text("Click Add to run this pipeline on a cron schedule.")
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
            Text("Failed to load schedules").font(.headline)
            Text(message).font(.caption).foregroundStyle(.secondary)
            Button("Retry") { Task { await reload() } }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    // MARK: - Actions

    private func reload() async {
        guard !pipeline.id.isEmpty else { return }
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            let loadedJobs = try await service.cronList()
            jobs = Self.jobs(for: pipeline.id, in: loadedJobs)
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

    // MARK: - Helpers

    static func jobs(for pipelineId: String, in jobs: [CronJob]) -> [CronJob] {
        jobs.filter { $0.pipelineId == pipelineId }
    }

    private func displayDate(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "-" }
        return value
    }
}

// MARK: - Edit target

enum CronEditTarget: Identifiable {
    case new
    case existing(CronJob)

    var id: String {
        switch self {
        case .new: return "__new__"
        case let .existing(job): return job.id
        }
    }

    var job: CronJob? {
        if case let .existing(job) = self {
            return job
        }
        return nil
    }
}

// MARK: - Status badge

struct StatusBadge: View {
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
