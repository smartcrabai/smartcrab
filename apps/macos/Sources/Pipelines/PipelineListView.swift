import SwiftUI

/// Sidebar/list of pipelines. Tapping a row navigates to the editor; the
/// "New" button opens an empty editor that will save as a new pipeline.
public struct PipelineListView: View {
    public var service: BunServiceProtocol

    @State private var pipelines: [PipelineSummary] = []
    @State private var loadError: String?
    @State private var isLoading = false
    @State private var selection: PipelineSummary.ID?

    public init(service: BunServiceProtocol = StubBunService.shared) {
        self.service = service
    }

    public var body: some View {
        NavigationSplitView {
            sidebar
                .navigationTitle("Pipelines")
                .toolbar {
                    ToolbarItem {
                        NavigationLink {
                            PipelineEditorView(
                                pipelineId: nil,
                                initialName: "New pipeline",
                                service: service,
                                graph: .empty
                            )
                        } label: {
                            Label("New", systemImage: "plus")
                        }
                    }
                    ToolbarItem(placement: .automatic) {
                        Button {
                            Task { await load() }
                        } label: {
                            Label("Refresh", systemImage: "arrow.clockwise")
                        }
                    }
                }
        } detail: {
            if let selection, let detail = pipelines.first(where: { $0.id == selection }) {
                PipelineEditorView(
                    pipelineId: detail.id,
                    initialName: detail.name,
                    service: service
                )
            } else {
                ContentUnavailableView(
                    "No pipeline selected",
                    systemImage: "rectangle.stack.badge.plus",
                    description: Text("Pick a pipeline from the sidebar or create a new one.")
                )
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private var sidebar: some View {
        if isLoading && pipelines.isEmpty {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if pipelines.isEmpty {
            ContentUnavailableView(
                "No pipelines yet",
                systemImage: "tray",
                description: Text(loadError ?? "Tap the + button to create your first pipeline.")
            )
        } else {
            List(selection: $selection) {
                ForEach(pipelines) { pipeline in
                    row(for: pipeline)
                        .tag(pipeline.id)
                }
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

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            pipelines = try await service.pipelineList()
            loadError = nil
            if selection == nil { selection = pipelines.first?.id }
        } catch {
            loadError = error.localizedDescription
        }
    }
}

#Preview {
    PipelineListView()
        .frame(width: 900, height: 600)
}
