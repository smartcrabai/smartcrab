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
                ContentUnavailableViewCompat(
                    title: "No pipeline selected",
                    message: "Pick a pipeline from the sidebar or create a new one.",
                    systemImage: "rectangle.stack.badge.plus"
                )
            }
        }
        .task { await load() }
    }

    private var sidebar: some View {
        Group {
            if isLoading && pipelines.isEmpty {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if pipelines.isEmpty {
                ContentUnavailableViewCompat(
                    title: "No pipelines yet",
                    message: loadError ?? "Tap the + button to create your first pipeline.",
                    systemImage: "tray"
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

/// Cross-version stand-in for `ContentUnavailableView` (introduced in macOS
/// 14 / iOS 17). Falls back to a simple label on older SDKs.
struct ContentUnavailableViewCompat: View {
    var title: String
    var message: String
    var systemImage: String

    var body: some View {
        if #available(macOS 14, iOS 17, *) {
            ContentUnavailableView {
                Label(title, systemImage: systemImage)
            } description: {
                Text(message)
            }
        } else {
            VStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 36))
                    .foregroundStyle(.secondary)
                Text(title).font(.headline)
                Text(message).font(.caption).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

#Preview {
    PipelineListView()
        .frame(width: 900, height: 600)
}
