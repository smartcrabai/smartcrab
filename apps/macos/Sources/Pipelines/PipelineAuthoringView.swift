import SwiftUI

/// Replaces the legacy drag-and-drop `PipelineEditorView`. Pipelines are
/// authored by chatting with an LLM that emits a structured pipeline via the
/// `pipeline.author` RPC; the right pane renders the result (read-only graph
/// or raw YAML for manual touch-ups) plus the pipeline's execution history.
///
/// Layout:
///
///     +-----------------------+-----------------------+
///     | NL composer + log     | [Graph|Yaml|History]  |
///     | (chat-style)          |                       |
///     +-----------------------+-----------------------+
///     | status bar (saved at / validation messages)   |
///     +-----------------------------------------------+
public struct PipelineAuthoringView: View {
    public let pipelineId: String?
    public var initialName: String
    public var service: BunServiceProtocol
    public var onSaved: ((PipelineSummary) -> Void)?

    @State private var yamlText: String = ""
    @State private var summary: PipelineSummary
    @State private var logEntries: [AuthoringLogEntry] = []
    @State private var promptText: String = ""
    @State private var rightTab: RightTab = .graph
    @State private var isBusy: Bool = false
    @State private var busyTask: Task<Void, Never>?
    @State private var statusMessage: String?
    @State private var statusKind: StatusKind = .info
    @State private var undoStack: [String] = []
    @FocusState private var promptFocused: Bool

    private enum RightTab: String, CaseIterable, Identifiable {
        case graph, yaml, schedule, history
        var id: String {
            rawValue
        }

        var label: String {
            rawValue.capitalized
        }
    }

    private enum StatusKind { case info, success, error }

    // AuthoringLogEntry is defined at file scope below so the row view can
    // see its stored properties without leaking them through `public`.

    private static let maxUndoDepth = 20

    public init(
        pipelineId: String?,
        initialName: String = "Untitled pipeline",
        service: BunServiceProtocol = StubBunService.shared,
        onSaved: ((PipelineSummary) -> Void)? = nil
    ) {
        self.pipelineId = pipelineId
        self.initialName = initialName
        self.service = service
        self.onSaved = onSaved
        _summary = State(initialValue: PipelineSummary(
            id: pipelineId ?? "",
            name: initialName,
            isActive: false
        ))
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                composerColumn
                    .frame(minWidth: 280, idealWidth: 360)
                Divider()
                rightColumn
                    .frame(minWidth: 360)
            }
            Divider()
            statusBar
        }
        .task { await loadIfNeeded() }
    }

    // MARK: - Left column

    private var composerColumn: some View {
        VStack(spacing: 0) {
            HStack {
                Text(summary.name.isEmpty ? "Untitled pipeline" : summary.name)
                    .font(.headline)
                    .lineLimit(1)
                Spacer()
                Button {
                    Task { await runPipeline() }
                } label: { Label("Run", systemImage: "play.fill") }
                    .disabled(isBusy || pipelineId == nil)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            Divider()

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(logEntries) { entry in
                        AuthoringLogRow(entry: entry)
                    }
                    if isBusy {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text("Generating pipeline…").foregroundStyle(.secondary)
                            Spacer()
                            Button("Cancel") { busyTask?.cancel() }
                                .buttonStyle(.borderless)
                        }
                        .padding(.horizontal, 12)
                    }
                }
                .padding(12)
            }
            .defaultScrollAnchor(.bottom)

            Divider()
            composer
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextEditor(text: $promptText)
                .frame(minHeight: 60, maxHeight: 120)
                .font(.system(.body, design: .default))
                .focused($promptFocused)
                .disabled(isBusy)
            HStack {
                if !undoStack.isEmpty {
                    Button {
                        undo()
                    } label: { Label("Undo", systemImage: "arrow.uturn.backward") }
                        .buttonStyle(.borderless)
                        .keyboardShortcut("z", modifiers: [.command])
                        .disabled(isBusy)
                }
                Spacer()
                Button {
                    submitPrompt()
                } label: {
                    Label(yamlText.isEmpty ? "Generate" : "Refine", systemImage: "paperplane")
                }
                .keyboardShortcut(.return, modifiers: [.command])
                .disabled(isBusy || promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(12)
    }

    // MARK: - Right column

    private var rightColumn: some View {
        VStack(spacing: 0) {
            Picker("", selection: $rightTab) {
                ForEach(RightTab.allCases) { tab in
                    Text(tab.label).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(8)
            Divider()
            switch rightTab {
            case .graph:
                PipelineGraphView(graph: visualGraph)
            case .yaml:
                PipelineYamlView(
                    text: $yamlText,
                    isDisabled: isBusy,
                    onSave: { Task { await saveManualYamlEdit() } }
                )
            case .schedule:
                if summary.id.isEmpty {
                    schedulePlaceholder
                } else {
                    PipelineScheduleView(service: service, pipeline: summary)
                }
            case .history:
                if summary.id.isEmpty {
                    historyPlaceholder
                } else {
                    ExecutionHistoryView(
                        service: service,
                        pipelineId: summary.id,
                        showsTitle: false
                    )
                }
            }
        }
    }

    private var historyPlaceholder: some View {
        VStack(spacing: 8) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 36))
                .foregroundStyle(.secondary)
            Text("Pipeline not saved yet").font(.headline)
            Text("Save and run the pipeline to see its history here.")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private var schedulePlaceholder: some View {
        VStack(spacing: 8) {
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 36))
                .foregroundStyle(.secondary)
            Text("Pipeline not saved yet").font(.headline)
            Text("Save this pipeline before scheduling it.")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    // MARK: - Status bar

    @ViewBuilder
    private var statusBar: some View {
        if let statusMessage {
            HStack(spacing: 8) {
                Image(systemName: statusKind == .error ? "exclamationmark.triangle"
                    : statusKind == .success ? "checkmark.circle" : "info.circle")
                Text(statusMessage)
                    .font(.caption)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(statusBackground)
        }
    }

    private var statusBackground: some View {
        switch statusKind {
        case .info: return Color.blue.opacity(0.10)
        case .success: return Color.green.opacity(0.12)
        case .error: return Color.orange.opacity(0.18)
        }
    }

    // MARK: - Derived state

    private var visualGraph: PipelineGraph {
        guard !yamlText.isEmpty else { return .empty }
        let parsed = PipelineGraph(yaml: yamlText)
        return PipelineAutoLayout.apply(to: parsed)
    }

    // MARK: - Actions

    private func loadIfNeeded() async {
        guard let id = pipelineId, !id.isEmpty else {
            promptFocused = true
            return
        }
        do {
            let detail = try await service.pipelineGet(id: id)
            summary = detail.info
            yamlText = detail.yamlContent
            statusMessage = nil
        } catch {
            setStatus("Failed to load pipeline: \(error.localizedDescription)", kind: .error)
        }
        promptFocused = true
    }

    private func submitPrompt() {
        let trimmed = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isBusy else { return }
        logEntries.append(.init(role: .user, text: trimmed))
        promptText = ""

        let currentYaml = yamlText.isEmpty ? nil : yamlText
        isBusy = true
        busyTask = Task { @MainActor in
            defer { isBusy = false; busyTask = nil }
            do {
                let result = try await service.pipelineAuthor(
                    instruction: trimmed,
                    currentYaml: currentYaml
                )
                // The RPC isn't cancellation-aware, so the LLM call still runs
                // to completion server-side; Cancel just means "discard the
                // result". Surface that explicitly rather than silently dropping
                // it, otherwise the user sees nothing happen.
                if Task.isCancelled {
                    // Restore the instruction so the user doesn't have to retype it
                    // (the composer was disabled while busy, so promptText is empty).
                    promptText = trimmed
                    logEntries.append(.init(role: .system, text: "Cancelled — discarded the generated result."))
                    return
                }
                pushUndo()
                yamlText = result.yaml
                let explanation = result.explanation.isEmpty
                    ? "Generated pipeline (via \(result.kind))."
                    : result.explanation
                logEntries.append(.init(role: .assistant, text: explanation))
                await persistAutomatically(reason: "Saved after refine")
            } catch {
                logEntries.append(.init(role: .error, text: "Authoring failed: \(error.localizedDescription)"))
                setStatus("Authoring failed: \(error.localizedDescription)", kind: .error)
            }
        }
    }

    private func saveManualYamlEdit() async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        pushUndo()
        await persistAutomatically(reason: "Saved YAML edit")
    }

    /// Persists `yamlText` and refreshes derived state. The caller owns the
    /// `isBusy` guard (so the busy window spans the whole operation and the
    /// composer/save button can't be re-triggered mid-save).
    private func persistAutomatically(reason: String) async {
        do {
            let id = summary.id.isEmpty ? UUID().uuidString : summary.id
            let info = PipelineSummary(
                id: id,
                name: parseName(from: yamlText) ?? summary.name,
                description: parseDescription(from: yamlText) ?? summary.description,
                isActive: summary.isActive
            )
            let detail = PipelineDetail(info: info, yamlContent: yamlText)
            let saved = try await service.pipelineSave(detail)
            summary = saved.info
            yamlText = saved.yamlContent
            onSaved?(saved.info)
            await runValidation(silenceSuccess: true)
            setStatus(reason, kind: .success)
        } catch {
            setStatus("Save failed: \(error.localizedDescription)", kind: .error)
        }
    }

    private func runValidation(silenceSuccess: Bool) async {
        do {
            let result = try await service.pipelineValidate(yaml: yamlText)
            if result.isValid {
                if !silenceSuccess {
                    setStatus("Pipeline is valid", kind: .success)
                }
            } else {
                setStatus("Validation: \(result.errors.joined(separator: ", "))", kind: .error)
            }
        } catch {
            setStatus("Validation failed: \(error.localizedDescription)", kind: .error)
        }
    }

    private func runPipeline() async {
        guard !summary.id.isEmpty else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            try await service.pipelineExecute(id: summary.id)
            setStatus("Started run for \(summary.name)", kind: .success)
        } catch {
            setStatus("Run failed: \(error.localizedDescription)", kind: .error)
        }
    }

    private func pushUndo() {
        guard !yamlText.isEmpty else { return }
        undoStack.append(yamlText)
        if undoStack.count > Self.maxUndoDepth {
            undoStack.removeFirst(undoStack.count - Self.maxUndoDepth)
        }
    }

    private func undo() {
        guard !isBusy, let previous = undoStack.popLast() else { return }
        yamlText = previous
        Task { @MainActor in
            isBusy = true
            defer { isBusy = false }
            await persistAutomatically(reason: "Reverted to previous version")
        }
    }

    private func setStatus(_ text: String, kind: StatusKind) {
        statusMessage = text
        statusKind = kind
    }

    // MARK: - YAML helpers

    /// Tiny line scanner: pulls the top-level `name:` value out of a YAML
    /// document. The Bun service is the canonical parser, but we mirror the
    /// value into `PipelineSummary` so the sidebar updates without a refetch.
    private func parseName(from yaml: String) -> String? {
        parseTopLevelString(key: "name", from: yaml)
    }

    private func parseDescription(from yaml: String) -> String? {
        parseTopLevelString(key: "description", from: yaml)
    }

    private func parseTopLevelString(key: String, from yaml: String) -> String? {
        for raw in yaml.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw)
            // Only top-level keys: must not start with whitespace.
            if line.first?.isWhitespace == true { continue }
            let prefix = "\(key):"
            guard line.hasPrefix(prefix) else { continue }
            var value = String(line.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
            if value.hasPrefix("\"") && value.hasSuffix("\"") && value.count >= 2 {
                value = String(value.dropFirst().dropLast())
            }
            return value.isEmpty ? nil : value
        }
        return nil
    }
}

private struct AuthoringLogEntry: Identifiable {
    let id = UUID()
    let role: Role
    let text: String
    let timestamp = Date()
    enum Role { case user, assistant, system, error }
}

private struct AuthoringLogRow: View {
    let entry: AuthoringLogEntry
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon)
                .foregroundStyle(colour)
                .font(.callout)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.text).font(.callout)
                Text(entry.timestamp.formatted(date: .omitted, time: .standard))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    private var icon: String {
        switch entry.role {
        case .user: return "person.fill"
        case .assistant: return "sparkles"
        case .system: return "info.circle"
        case .error: return "exclamationmark.triangle"
        }
    }

    private var colour: Color {
        switch entry.role {
        case .user: return .blue
        case .assistant: return .purple
        case .system: return .secondary
        case .error: return .orange
        }
    }
}

#Preview {
    PipelineAuthoringView(pipelineId: nil, service: StubBunService())
        .frame(width: 900, height: 600)
}
