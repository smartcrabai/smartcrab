// SeherConfigEditor.swift
//
// GUI editor for the smartcrab seher configuration. Users edit providers
// (kind, model, credentials), priority rules (weight, weekday/hour windows,
// condition predicate) and defaults (fallback provider, rate-limit backoff).
// Credentials are kind-specific: API-key kinds (anthropic / openai) show
// secure fields; OAuth kinds (copilot / openai-codex) show a credential badge
// plus a Sign-in button that runs the seher-bridge device-flow / OAuth via
// `AuthFlowSheet`. Edits are auto-saved (debounced) via
// `BunServiceProtocol.settingsSave`; the toolbar shows a live save-status
// indicator.

import SwiftUI

public struct SeherConfigEditor: View {
    private let service: BunServiceProtocol

    @State private var config: SeherConfig = .init()
    @State private var isLoading: Bool = true
    @State private var saveStatus: SaveStatus = .idle
    @State private var lastSavedConfig: SeherConfig?
    @State private var saveTask: Task<Void, Never>?
    /// Keyed by pi canonical provider id (github-copilot / openai-codex / ...).
    @State private var credentialStatuses: [String: ProviderCredentialStatus] = [:]
    @State private var bridgeAvailable: Bool = true

    private static let autoSaveDebounce: Duration = .milliseconds(500)

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
            }
        }
        .formStyle(.grouped)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack {
                Spacer()
                SaveStatusIndicator(status: saveStatus) {
                    Task { await save() }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .background(.bar)
        }
        .task { await load() }
        .task { await refreshCredentialStatuses() }
        .onChange(of: config) { _, newValue in
            scheduleAutoSave(for: newValue)
        }
        .onDisappear { saveTask?.cancel() }
    }

    // MARK: Sections -----------------------------------------------------------

    private var providersSection: some View {
        Section {
            ForEach($config.providers, id: \.rowKey) { $provider in
                ProviderRow(
                    provider: $provider,
                    service: service,
                    credentialStatuses: credentialStatuses,
                    bridgeAvailable: bridgeAvailable
                ) {
                    Task { await refreshCredentialStatuses() }
                }
            }
            .onDelete { indices in
                config.providers.remove(atOffsets: indices)
            }

            Button {
                config.providers.append(
                    SeherProvider(id: "provider-\(config.providers.count + 1)", kind: "anthropic", model: "")
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
                in: 1 ... 3600
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
            let loaded = try await service.settingsLoad()
            config = loaded
            lastSavedConfig = loaded
            saveStatus = .idle
        } catch {
            saveStatus = .failed("Failed to load: \(error.localizedDescription)")
        }
    }

    private func scheduleAutoSave(for newValue: SeherConfig) {
        // Skip until the initial load has populated `lastSavedConfig`. Cancel
        // any pending debounce on every edit BEFORE the no-op guard — otherwise
        // an A→B→A revert leaves the B-scheduled task to fire a useless save.
        guard let baseline = lastSavedConfig else { return }
        saveTask?.cancel()
        guard baseline != newValue else { return }
        saveTask = Task { @MainActor in
            do {
                try await Task.sleep(for: Self.autoSaveDebounce)
            } catch {
                return
            }
            await save()
        }
    }

    private func save() async {
        saveStatus = .saving
        do {
            let snapshot = config
            try await service.settingsSave(snapshot)
            lastSavedConfig = snapshot
            saveStatus = .saved(Date())
        } catch {
            saveStatus = .failed("Failed to save: \(error.localizedDescription)")
        }
    }

    /// Refresh the per-provider credential badges from pi's auth.json (via
    /// `auth.credential-status`). Badge data is advisory: a failure just hides
    /// the badges rather than blocking the editor.
    private func refreshCredentialStatuses() async {
        do {
            let result = try await service.authCredentialStatus()
            bridgeAvailable = result.bridgeAvailable
            credentialStatuses = result.providers
        } catch {
            bridgeAvailable = false
            credentialStatuses = [:]
        }
    }
}

// MARK: - Save status (shared with AdapterSettings) -----------------------------

enum SaveStatus: Equatable {
    case idle
    case saving
    case saved(Date)
    case failed(String)
}

struct SaveStatusIndicator: View {
    let status: SaveStatus
    let retry: () -> Void

    var body: some View {
        switch status {
        case .idle:
            Text("Up to date")
                .font(.caption)
                .foregroundStyle(.secondary)
        case .saving:
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Saving…").font(.caption).foregroundStyle(.secondary)
            }
        case let .saved(at):
            Text("Saved \(at.formatted(date: .omitted, time: .shortened))")
                .font(.caption)
                .foregroundStyle(.secondary)
        case let .failed(message):
            HStack(spacing: 6) {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(1)
                    .help(message)
                Button("Retry", action: retry)
                    .controlSize(.small)
            }
        }
    }
}

// MARK: - Provider row ----------------------------------------------------------

private struct ProviderRow: View {
    @Binding var provider: SeherProvider
    let service: BunServiceProtocol
    /// Keyed by pi canonical provider id; loaded once by the editor.
    let credentialStatuses: [String: ProviderCredentialStatus]
    let bridgeAvailable: Bool
    /// Invoked after a successful sign-in so the editor refreshes the badges.
    let onCredentialsChanged: () -> Void

    @State private var newEnvKey: String = ""
    @State private var newEnvValue: String = ""
    @State private var showAuthSheet: Bool = false

    /// All kinds run on the Rust pi engine; the kind picks the pi provider
    /// (model id prefix) and the credential UI below.
    private static let kinds: [(id: String, label: String)] = [
        ("anthropic", "Anthropic API"),
        ("openai", "OpenAI API compatible"),
        ("copilot", "GitHub Copilot"),
        ("openai-codex", "OpenAI Codex (ChatGPT)"),
    ]

    /// pi canonical provider id for the current kind (badge lookup).
    private var piProviderId: String {
        provider.kind == "copilot" ? "github-copilot" : provider.kind
    }

    private var usesOAuth: Bool {
        provider.kind == "copilot" || provider.kind == "openai-codex"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("id", text: $provider.id)
                    .textFieldStyle(.roundedBorder)
                Picker("kind", selection: $provider.kind) {
                    ForEach(Self.kinds, id: \.id) { Text($0.label).tag($0.id) }
                }
                .labelsHidden()
                .frame(width: 200)
            }
            TextField("model", text: $provider.model)
                .textFieldStyle(.roundedBorder)

            credentialBody

            DisclosureGroup("Advanced") {
                envOverridesEditor
            }
        }
        .padding(.vertical, 4)
        .sheet(isPresented: $showAuthSheet) {
            AuthFlowSheet(kind: provider.kind, service: service) {
                onCredentialsChanged()
            }
        }
    }

    // MARK: Credentials (kind-specific) -----------------------------------------

    @ViewBuilder
    private var credentialBody: some View {
        switch provider.kind {
        case "anthropic":
            SecureField("API key (ANTHROPIC_API_KEY)", text: envBinding("ANTHROPIC_API_KEY"))
                .textFieldStyle(.roundedBorder)
        case "openai":
            SecureField("API key (OPENAI_API_KEY)", text: envBinding("OPENAI_API_KEY"))
                .textFieldStyle(.roundedBorder)
            TextField("Endpoint (OPENAI_BASE_URL, optional)", text: envBinding("OPENAI_BASE_URL"))
                .textFieldStyle(.roundedBorder)
        case "copilot", "openai-codex":
            HStack(spacing: 12) {
                credentialBadge
                Spacer()
                Button("Sign in…") { showAuthSheet = true }
                    .disabled(!bridgeAvailable)
                    .help(bridgeAvailable
                        ? "Sign in via \(provider.kind == "copilot" ? "GitHub device flow" : "ChatGPT in the browser")"
                        : "seher-bridge binary is not available")
            }
        default:
            EmptyView()
        }
    }

    /// Badge mapping pi's credential status for this kind's provider. OAuth
    /// credentials live in pi's auth.json — never in the YAML config.
    @ViewBuilder
    private var credentialBadge: some View {
        let status = credentialStatuses[piProviderId]?.status
        switch status {
        case "oauth_valid":
            Label("Signed in", systemImage: "checkmark.seal.fill")
                .font(.caption)
                .foregroundStyle(.green)
        case "oauth_expired":
            Label("Expired — sign in again", systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.orange)
        case "api_key", "bearer", "aws", "service_key":
            Label("Credential set", systemImage: "key.fill")
                .font(.caption)
                .foregroundStyle(.blue)
        default:
            Label("Not signed in", systemImage: "person.crop.circle.badge.questionmark")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    /// Two-way binding into `envOverrides[key]`; setting an empty string
    /// removes the key so cleared fields don't linger in the saved config.
    private func envBinding(_ key: String) -> Binding<String> {
        Binding(
            get: { provider.envOverrides[key] ?? "" },
            set: { newValue in
                if newValue.isEmpty {
                    provider.envOverrides.removeValue(forKey: key)
                } else {
                    provider.envOverrides[key] = newValue
                }
            }
        )
    }

    // MARK: Advanced env overrides ----------------------------------------------

    @ViewBuilder
    private var envOverridesEditor: some View {
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
                Stepper(value: $rule.weight, in: 0 ... 100) {
                    LabeledContent("Weight") { Text("\(rule.weight)") }
                }
                .frame(maxWidth: 180)
            }

            HStack(spacing: 4) {
                Text("Weekdays").font(.caption).foregroundStyle(.secondary)
                ForEach(0 ..< 7) { day in
                    Toggle(Self.weekdayLabels[day], isOn: weekdayBinding(day))
                        .toggleStyle(.button)
                        .controlSize(.small)
                }
            }

            HStack {
                Stepper(value: $rule.hourStart, in: 0 ... 23) {
                    LabeledContent("From") { Text(String(format: "%02d:00", rule.hourStart)) }
                }
                Stepper(value: $rule.hourEnd, in: 0 ... 23) {
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
        SeherConfigEditor(service: StubBunService())
    }
}
