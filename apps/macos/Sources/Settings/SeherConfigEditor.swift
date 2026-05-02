// SeherConfigEditor.swift
//
// GUI editor for the smartcrab seher configuration. Users edit providers
// (kind, model, env overrides), priority rules (weight, weekday/hour windows,
// condition predicate) and defaults (fallback provider, rate-limit backoff).
// Save persists via `BunServiceProtocol.settingsSave`.

import SwiftUI

public struct SeherConfigEditor: View {
    private let service: BunServiceProtocol

    @State private var config: SeherConfig = SeherConfig()
    @State private var isLoading: Bool = true
    @State private var saveError: String?
    @State private var isSaving: Bool = false

    public init(service: BunServiceProtocol) {
        self.service = service
    }

    public var body: some View {
        Form {
            if isLoading {
                ProgressView("Loading configuration…")
            } else {
                providersSection
                prioritiesSection
                defaultsSection

                if let error = saveError {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }
            }
        }
        .formStyle(.grouped)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await save() }
                } label: {
                    if isSaving {
                        ProgressView()
                    } else {
                        Text("Save")
                    }
                }
                .disabled(isLoading || isSaving)
            }
        }
        .task { await load() }
    }

    // MARK: Sections -----------------------------------------------------------

    private var providersSection: some View {
        Section {
            ForEach($config.providers) { $provider in
                ProviderRow(provider: $provider)
            }
            .onDelete { indices in
                config.providers.remove(atOffsets: indices)
            }

            Button {
                config.providers.append(
                    SeherProvider(id: "provider-\(config.providers.count + 1)", kind: "claude", model: "")
                )
            } label: {
                Label("Add provider", systemImage: "plus")
            }
        } header: {
            Text("Providers")
        } footer: {
            Text("Each provider id must be unique and is referenced by priority rules and the fallback default.")
        }
    }

    private var prioritiesSection: some View {
        Section {
            ForEach($config.priorities) { $rule in
                PriorityRow(rule: $rule, providers: config.providers)
            }
            .onDelete { indices in
                config.priorities.remove(atOffsets: indices)
            }

            Button {
                let firstProvider = config.providers.first?.id ?? ""
                config.priorities.append(SeherPriorityRule(providerId: firstProvider))
            } label: {
                Label("Add priority rule", systemImage: "plus")
            }
            .disabled(config.providers.isEmpty)
        } header: {
            Text("Priority rules")
        } footer: {
            Text("Higher weight wins. Rules are scoped by weekday and hour window; an empty weekday filter matches every day.")
        }
    }

    private var defaultsSection: some View {
        Section("Defaults") {
            Picker("Fallback provider", selection: $config.defaults.fallbackProviderId) {
                Text("(none)").tag("")
                ForEach(config.providers) { provider in
                    Text(provider.id).tag(provider.id)
                }
            }

            Stepper(
                value: $config.defaults.rateLimitBackoffSeconds,
                in: 1...3600
            ) {
                LabeledContent("Rate-limit backoff (s)") {
                    Text("\(config.defaults.rateLimitBackoffSeconds)")
                }
            }
        }
    }

    // MARK: Persistence --------------------------------------------------------

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            config = try await service.settingsLoad()
        } catch {
            saveError = "Failed to load: \(error.localizedDescription)"
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        saveError = nil
        do {
            try await service.settingsSave(config)
        } catch {
            saveError = "Failed to save: \(error.localizedDescription)"
        }
    }
}

// MARK: - Provider row ----------------------------------------------------------

private struct ProviderRow: View {
    @Binding var provider: SeherProvider
    @State private var newEnvKey: String = ""
    @State private var newEnvValue: String = ""

    private static let kinds = ["claude", "kimi", "copilot"]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("id", text: $provider.id)
                    .textFieldStyle(.roundedBorder)
                Picker("kind", selection: $provider.kind) {
                    ForEach(Self.kinds, id: \.self) { Text($0).tag($0) }
                }
                .labelsHidden()
                .frame(width: 120)
            }
            TextField("model", text: $provider.model)
                .textFieldStyle(.roundedBorder)

            DisclosureGroup("Env overrides (\(provider.envOverrides.count))") {
                ForEach(provider.envOverrides.keys.sorted(), id: \.self) { key in
                    HStack {
                        Text(key).font(.caption.monospaced())
                        Spacer()
                        Text(provider.envOverrides[key] ?? "")
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                        Button(role: .destructive) {
                            provider.envOverrides.removeValue(forKey: key)
                        } label: {
                            Image(systemName: "minus.circle")
                        }
                        .buttonStyle(.borderless)
                    }
                }
                HStack {
                    TextField("KEY", text: $newEnvKey)
                        .textFieldStyle(.roundedBorder)
                    TextField("value", text: $newEnvValue)
                        .textFieldStyle(.roundedBorder)
                    Button {
                        let key = newEnvKey.trimmingCharacters(in: .whitespaces)
                        guard !key.isEmpty else { return }
                        provider.envOverrides[key] = newEnvValue
                        newEnvKey = ""
                        newEnvValue = ""
                    } label: {
                        Image(systemName: "plus.circle.fill")
                    }
                    .buttonStyle(.borderless)
                    .disabled(newEnvKey.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Priority row ----------------------------------------------------------

private struct PriorityRow: View {
    @Binding var rule: SeherPriorityRule
    let providers: [SeherProvider]

    private static let weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Picker("Provider", selection: $rule.providerId) {
                    ForEach(providers) { provider in
                        Text(provider.id).tag(provider.id)
                    }
                }
                Stepper(value: $rule.weight, in: 0...100) {
                    LabeledContent("Weight") { Text("\(rule.weight)") }
                }
                .frame(maxWidth: 180)
            }

            HStack(spacing: 4) {
                Text("Weekdays").font(.caption).foregroundStyle(.secondary)
                ForEach(0..<7) { day in
                    Toggle(Self.weekdayLabels[day], isOn: weekdayBinding(day))
                        .toggleStyle(.button)
                        .controlSize(.small)
                }
            }

            HStack {
                Stepper(value: $rule.hourStart, in: 0...23) {
                    LabeledContent("From") { Text(String(format: "%02d:00", rule.hourStart)) }
                }
                Stepper(value: $rule.hourEnd, in: 0...23) {
                    LabeledContent("To") { Text(String(format: "%02d:59", rule.hourEnd)) }
                }
            }

            TextField("condition (e.g. task.kind == \"code\")", text: $rule.condition)
                .textFieldStyle(.roundedBorder)
        }
        .padding(.vertical, 4)
    }

    private func weekdayBinding(_ day: Int) -> Binding<Bool> {
        Binding(
            get: { rule.weekdayFilter.contains(day) },
            set: { isOn in
                if isOn {
                    if !rule.weekdayFilter.contains(day) {
                        rule.weekdayFilter.append(day)
                        rule.weekdayFilter.sort()
                    }
                } else {
                    rule.weekdayFilter.removeAll { $0 == day }
                }
            }
        )
    }
}

#Preview("SeherConfigEditor") {
    NavigationStack {
        SeherConfigEditor(service: BunServiceMock())
    }
}
