import SwiftUI

/// Skill catalog: lists registered skills with name/description and exposes
/// "Auto-generate from history" (delegates to `skill.auto-generate`) and
/// per-row Invoke / Delete actions.
public struct SkillsView: View {
    private let service: any BunServiceProtocol

    @State private var skills: [SkillInfo] = []
    @State private var pipelines: [PipelineSummary] = []
    @State private var loadError: String?
    @State private var isLoading = false
    @State private var isAutoGenerating = false

    @State private var autoGenPickerVisible = false
    @State private var autoGenPipelineId = ""

    @State private var invocation: SkillInvocationRun?
    @State private var pendingDelete: SkillInfo?

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
        .sheet(isPresented: $autoGenPickerVisible) {
            autoGenSheet
        }
        .sheet(item: $invocation) { run in
            SkillInvocationSheet(
                service: service,
                run: run,
                onClose: { invocation = nil }
            )
        }
        .alert(
            "Delete skill?",
            isPresented: deleteAlertBinding,
            presenting: pendingDelete
        ) { skill in
            Button("Cancel", role: .cancel) { pendingDelete = nil }
            Button("Delete", role: .destructive) {
                Task { await delete(skill) }
            }
        } message: { skill in
            Text("\"\(skill.name)\" will be removed from the catalog.")
        }
    }

    // MARK: - Subviews

    private var header: some View {
        HStack(spacing: 12) {
            Text("Skills").font(.title2).bold()
            Spacer()
            if isLoading || isAutoGenerating {
                ProgressView().controlSize(.small)
            }
            Button {
                Task { await reload() }
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
            }
            .disabled(isLoading)
            Button {
                autoGenPipelineId = pipelines.first?.id ?? ""
                autoGenPickerVisible = true
            } label: {
                Label("Auto-generate from history", systemImage: "wand.and.stars")
            }
            .disabled(pipelines.isEmpty || isAutoGenerating)
        }
        .padding(12)
    }

    @ViewBuilder
    private var content: some View {
        if let loadError {
            errorState(loadError)
        } else if skills.isEmpty && !isLoading {
            emptyState
        } else {
            List {
                ForEach(skills) { skill in
                    SkillRow(
                        skill: skill,
                        onInvoke: {
                            invocation = SkillInvocationRun(skill: skill)
                        },
                        onDelete: { pendingDelete = skill }
                    )
                }
            }
            .listStyle(.inset)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "sparkles")
                .font(.system(size: 36))
                .foregroundStyle(.secondary)
            Text("No skills yet").font(.headline)
            Text("Auto-generate one from a successful pipeline run.")
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
            Text("Failed to load skills").font(.headline)
            Text(message).font(.caption).foregroundStyle(.secondary)
            Button("Retry") { Task { await reload() } }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private var autoGenSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Auto-generate skill").font(.title2).bold()
            Text("Pick a pipeline; the service will derive a reusable skill from its history.")
                .foregroundStyle(.secondary)

            Picker("Pipeline", selection: $autoGenPipelineId) {
                ForEach(pipelines) { p in
                    Text(p.name).tag(p.id)
                }
            }

            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { autoGenPickerVisible = false }
                Button("Generate") {
                    Task { await autoGenerate() }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(autoGenPipelineId.isEmpty || isAutoGenerating)
            }
        }
        .padding(20)
        .frame(minWidth: 420)
    }

    // MARK: - Bindings & actions

    private var deleteAlertBinding: Binding<Bool> {
        Binding(
            get: { pendingDelete != nil },
            set: { if !$0 { pendingDelete = nil } }
        )
    }

    private func reload() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            async let skillsTask = service.skillList()
            async let pipelinesTask = service.pipelineList()
            let (loadedSkills, loadedPipelines) = try await (skillsTask, pipelinesTask)
            skills = loadedSkills
            pipelines = loadedPipelines
        } catch {
            loadError = String(describing: error)
        }
    }

    private func autoGenerate() async {
        let pipelineId = autoGenPipelineId
        autoGenPickerVisible = false
        isAutoGenerating = true
        defer { isAutoGenerating = false }
        do {
            _ = try await service.skillAutoGenerate(pipelineId: pipelineId)
            await reload()
        } catch {
            loadError = String(describing: error)
        }
    }

    private func delete(_ skill: SkillInfo) async {
        pendingDelete = nil
        do {
            try await service.skillDelete(id: skill.id)
            await reload()
        } catch {
            loadError = String(describing: error)
        }
    }
}

// MARK: - Row

private struct SkillRow: View {
    let skill: SkillInfo
    let onInvoke: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "sparkles")
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                Text(skill.name).font(.headline)
                if let desc = skill.description, !desc.isEmpty {
                    Text(desc)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                HStack(spacing: 8) {
                    TagPill(text: skill.skillType)
                    if let pipelineId = skill.pipelineId {
                        TagPill(text: "pipeline: \(pipelineId)")
                    }
                }
            }
            Spacer()
            HStack(spacing: 8) {
                Button("Invoke", action: onInvoke).buttonStyle(.bordered)
                Button("Delete", role: .destructive, action: onDelete)
                    .buttonStyle(.borderless)
            }
        }
        .padding(.vertical, 6)
    }
}

private struct TagPill: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Color.secondary.opacity(0.15))
            .clipShape(Capsule())
    }
}

// MARK: - Invocation sheet

struct SkillInvocationRun: Identifiable {
    let skill: SkillInfo
    var id: String {
        skill.id
    }
}

private struct SkillInvocationSheet: View {
    let service: any BunServiceProtocol
    let run: SkillInvocationRun
    let onClose: () -> Void

    @State private var input: String = ""
    @State private var isRunning = false
    @State private var result: SkillInvocationResult?
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Invoke: \(run.skill.name)").font(.title2).bold()

            Text("Input").font(.headline)
            TextEditor(text: $input)
                .font(.system(.body, design: .monospaced))
                .frame(minHeight: 100)
                .border(Color.secondary.opacity(0.3))

            if let result {
                Text("Output").font(.headline)
                ScrollView {
                    Text(result.output)
                        .font(.system(.body, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                .frame(minHeight: 120, maxHeight: 240)
                .border(Color.secondary.opacity(0.3))
            }

            if let error {
                Text(error).foregroundStyle(.red).font(.caption)
            }

            HStack {
                Spacer()
                Button("Close", role: .cancel) { onClose() }
                Button(result == nil ? "Run" : "Run again") {
                    Task { await invoke() }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(isRunning)
            }
        }
        .padding(20)
        .frame(minWidth: 540, minHeight: 420)
    }

    private func invoke() async {
        isRunning = true
        error = nil
        defer { isRunning = false }
        do {
            result = try await service.skillInvoke(skillId: run.skill.id, input: input)
        } catch {
            self.error = String(describing: error)
        }
    }
}
