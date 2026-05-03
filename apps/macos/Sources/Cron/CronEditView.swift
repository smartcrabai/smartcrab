import SwiftUI

/// Sheet for creating or editing a cron job.
///
/// Provides a pipeline picker, a cron expression text field with a live
/// "Next: ..." preview, and an enabled toggle. The preview is computed
/// purely client-side via `CronExpressionPreview` to avoid round-trips
/// while typing.
public struct CronEditView: View {
    private let service: any BunServiceProtocol
    private let pipelines: [PipelineSummary]
    private let existing: CronJob?
    private let onSaved: (CronJob) -> Void
    private let onCancel: () -> Void

    @State private var pipelineId: String
    @State private var expression: String
    @State private var isActive: Bool
    @State private var isSaving = false
    @State private var saveError: String?

    public init(
        service: any BunServiceProtocol,
        pipelines: [PipelineSummary],
        existing: CronJob?,
        onSaved: @escaping (CronJob) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.service = service
        self.pipelines = pipelines
        self.existing = existing
        self.onSaved = onSaved
        self.onCancel = onCancel
        _pipelineId = State(initialValue: existing?.pipelineId ?? pipelines.first?.id ?? "")
        _expression = State(initialValue: existing?.schedule ?? "0 * * * *")
        _isActive = State(initialValue: existing?.isActive ?? true)
    }

    private var isEditing: Bool {
        existing != nil
    }

    private var preview: CronExpressionPreview.Result {
        CronExpressionPreview.evaluate(expression)
    }

    private var canSave: Bool {
        !pipelineId.isEmpty && preview.isValid && !isSaving
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(isEditing ? "Edit Cron Job" : "New Cron Job")
                .font(.title2).bold()

            Form {
                Picker("Pipeline", selection: $pipelineId) {
                    ForEach(pipelines) { p in
                        Text(p.name).tag(p.id)
                    }
                }
                .disabled(isEditing)

                TextField("Cron expression", text: $expression)
                    .font(.system(.body, design: .monospaced))
                    .textFieldStyle(.roundedBorder)

                HStack(alignment: .firstTextBaseline) {
                    Text("Next:").foregroundStyle(.secondary)
                    Text(preview.summary)
                        .foregroundStyle(preview.isValid ? Color.primary : Color.red)
                        .font(.system(.body, design: .monospaced))
                }

                Toggle("Enabled", isOn: $isActive)
            }
            .formStyle(.grouped)

            if let saveError {
                Text(saveError).foregroundStyle(.red).font(.caption)
            }

            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { onCancel() }
                Button(isEditing ? "Save" : "Create") {
                    Task { await save() }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!canSave)
            }
        }
        .padding(20)
        .frame(minWidth: 480, minHeight: 360)
    }

    private func save() async {
        isSaving = true
        saveError = nil
        defer { isSaving = false }
        do {
            let saved: CronJob
            if let existing {
                let scheduleChanged = expression != existing.schedule
                let activeChanged = isActive != existing.isActive
                guard scheduleChanged || activeChanged else {
                    onSaved(existing)
                    return
                }
                saved = try await service.cronUpdate(
                    id: existing.id,
                    schedule: scheduleChanged ? expression : nil,
                    isActive: activeChanged ? isActive : nil
                )
            } else {
                let created = try await service.cronCreate(
                    pipelineId: pipelineId,
                    schedule: expression
                )
                saved = isActive
                    ? created
                    : try await service.cronUpdate(id: created.id, schedule: nil, isActive: false)
            }
            onSaved(saved)
        } catch {
            saveError = String(describing: error)
        }
    }
}

// MARK: - Cron expression preview

/// Lightweight cron expression validator and human-friendly previewer.
///
/// Accepts standard 5-field (minute hour day-of-month month day-of-week) and
/// 6-field (with seconds prefix) expressions. Validation is conservative —
/// the authoritative parser lives in the Bun service. This preview exists
/// purely to give the editor an immediate "Next: ..." hint while typing.
enum CronExpressionPreview {
    struct Result {
        let isValid: Bool
        let summary: String
    }

    static func evaluate(_ raw: String) -> Result {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return Result(isValid: false, summary: "(empty)")
        }
        let parts = trimmed.split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count == 5 || parts.count == 6 else {
            return Result(isValid: false, summary: "expected 5 or 6 fields")
        }
        for field in parts where !isValidField(String(field)) {
            return Result(isValid: false, summary: "invalid field: \(field)")
        }
        return Result(isValid: true, summary: humanize(parts))
    }

    private static func isValidField(_ field: String) -> Bool {
        let allowed = CharacterSet(charactersIn: "0123456789*/,-?LW#")
            .union(.letters)
        return field.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    private static func humanize(_ parts: [Substring]) -> String {
        let offset = parts.count == 6 ? 1 : 0
        let minute = parts[offset]
        let hour = parts[offset + 1]
        let dom = parts[offset + 2]
        let month = parts[offset + 3]
        let dow = parts[offset + 4]

        if minute == "0" && hour == "*" && dom == "*" && month == "*" && dow == "*" {
            return "every hour, on the hour"
        }
        if minute == "*" && hour == "*" && dom == "*" && month == "*" && dow == "*" {
            return "every minute"
        }
        if dom == "*" && month == "*" && dow == "*" {
            return "daily at \(hour):\(minute)"
        }
        return parts.joined(separator: " ")
    }
}
