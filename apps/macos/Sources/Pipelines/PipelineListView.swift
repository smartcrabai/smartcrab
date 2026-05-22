import SwiftUI

/// List of pipelines plus an embedded editor pane.
///
/// `AppRoot` already wraps this view in a `NavigationSplitView`. We avoid
/// nesting another one (which made the inner column's `+` / refresh toolbar
/// overlap the outer split's divider) and instead use an `HSplitView` on
/// macOS and a `NavigationStack` with push navigation on iOS.
public struct PipelineListView: View {
    public var service: BunServiceProtocol

    @State private var pipelines: [PipelineSummary] = []
    @State private var loadError: String?
    @State private var isLoading = false
    @State private var selection: PipelineSummary.ID?
    @State private var isCreating = false
    #if !os(macOS)
        @State private var path: [PipelineTarget] = []
    #endif

    private enum PipelineTarget: Hashable {
        case new
        case existing(String)
    }

    public init(service: BunServiceProtocol = StubBunService.shared) {
        self.service = service
    }

    public var body: some View {
        #if os(macOS)
            HSplitView {
                sidebarColumn
                    .frame(minWidth: 220, idealWidth: 280)
                detailColumn
                    .frame(minWidth: 420)
            }
            .navigationTitle("Pipelines")
            .onChange(of: selection) { _, newValue in
                if newValue != nil { isCreating = false }
            }
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button {
                        selection = nil
                        isCreating = true
                    } label: {
                        Label("New", systemImage: "plus")
                    }
                    .disabled(isLoading)

                    Button {
                        Task { await load() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .disabled(isLoading)
                }
            }
            .task { await load() }
        #else
            NavigationStack(path: $path) {
                sidebarColumn
                    .navigationTitle("Pipelines")
                    .toolbar {
                        ToolbarItemGroup(placement: .primaryAction) {
                            NavigationLink(value: PipelineTarget.new) {
                                Label("New", systemImage: "plus")
                            }
                            Button {
                                Task { await load() }
                            } label: {
                                Label("Refresh", systemImage: "arrow.clockwise")
                            }
                            .disabled(isLoading)
                        }
                    }
                    .navigationDestination(for: PipelineTarget.self) { target in
                        editor(for: target)
                    }
            }
            .task { await load() }
        #endif
    }

    // MARK: - Sidebar

    private var sidebarColumn: some View {
        sidebarContent
    }

    @ViewBuilder
    private var sidebarContent: some View {
        if isLoading && pipelines.isEmpty {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if pipelines.isEmpty {
            ContentUnavailableView(
                "No pipelines yet",
                systemImage: "tray",
                description: Text(loadError ?? "Tap the + button to create your first pipeline.")
            )
        } else {
            #if os(macOS)
                List(selection: $selection) {
                    ForEach(pipelines) { pipeline in
                        row(for: pipeline)
                            .tag(pipeline.id)
                    }
                }
            #else
                List {
                    ForEach(pipelines) { pipeline in
                        NavigationLink(value: PipelineTarget.existing(pipeline.id)) {
                            row(for: pipeline)
                        }
                    }
                }
            #endif
        }
    }

    // MARK: - Detail / editor

    #if os(macOS)
        @ViewBuilder
        private var detailColumn: some View {
            if isCreating {
                editor(for: .new)
            } else if let selection, let detail = pipelines.first(where: { $0.id == selection }) {
                editor(for: .existing(detail.id))
                    .id(detail.id)
            } else {
                ContentUnavailableView(
                    "No pipeline selected",
                    systemImage: "rectangle.stack.badge.plus",
                    description: Text("Pick a pipeline from the sidebar or create a new one.")
                )
            }
        }
    #endif

    @ViewBuilder
    private func editor(for target: PipelineTarget) -> some View {
        switch target {
        case .new:
            PipelineEditorView(
                pipelineId: nil,
                initialName: "New pipeline",
                service: service,
                graph: .empty,
                onSaved: handleSaved
            )
        case let .existing(id):
            if let detail = pipelines.first(where: { $0.id == id }) {
                PipelineEditorView(
                    pipelineId: detail.id,
                    initialName: detail.name,
                    service: service,
                    onSaved: handleSaved
                )
            } else {
                ContentUnavailableView(
                    "Pipeline not found",
                    systemImage: "questionmark.folder",
                    description: Text("The pipeline may have been deleted.")
                )
            }
        }
    }

    private func row(for pipeline: PipelineSummary) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(pipeline.name).font(.headline)
                Spacer()
                if pipeline.isActive {
                    Image(systemName: "circle.fill")
                        .foregroundStyle(.green)
                        .font(.caption2)
                }
            }
            if let description = pipeline.description, !description.isEmpty {
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
    }

    // MARK: - Actions

    private func handleSaved(_ saved: PipelineSummary) {
        Task {
            await load()
            await MainActor.run {
                isCreating = false
                selection = saved.id
            }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            pipelines = try await service.pipelineList()
            loadError = nil
            if selection == nil && !isCreating {
                selection = pipelines.first?.id
            }
        } catch {
            loadError = error.localizedDescription
        }
    }
}

#Preview {
    PipelineListView()
        .frame(width: 900, height: 600)
}
