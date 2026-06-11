// SeherConfigEditor.swift
//
// GUI editor for the smartcrab seher configuration. Users edit providers
// (kind, model, credentials) and defaults (fallback provider, rate-limit
// backoff). The provider *order* is the single source of truth for routing
// priority: the topmost provider wins (highest weight). Reordering or
// deleting a provider re-derives the seher `priorities` automatically, so
// there is no separate priority-rules UI. Credentials are kind-specific:
// API-key kinds (anthropic / openai) show secure fields; OAuth kinds
// (copilot / openai-codex) show a credential badge plus a Sign-in button that
// runs the seher-bridge device-flow / OAuth via `AuthFlowSheet`. Edits are
// auto-saved (debounced) via `BunServiceProtocol.settingsSave`; the toolbar
// shows a live save-status indicator.

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
        // A `List` (not `Form`) so the providers `ForEach` can use `.onMove`,
        // which gives native macOS drag-to-reorder — system insertion indicator,
        // cursor, and drag-end cleanup all handled for us.
        List {
            if isLoading {
                ProgressView("Loading configuration…")
            } else {
                providersSection
                defaultsSection
            }
        }
        .listStyle(.inset)
        .readableWidth()
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
        .onChange(of: config.providers) { _, providers in
            syncPriorities(with: providers)
        }
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
                    bridgeAvailable: bridgeAvailable,
                    onDelete: { config.providers.removeAll { $0.rowKey == provider.rowKey } },
                    onCredentialsChanged: { Task { await refreshCredentialStatuses() } }
                )
            }
            .onMove { source, destination in
                config.providers.move(fromOffsets: source, toOffset: destination)
            }

            Button {
                config.providers.append(
                    SeherProvider(id: uniqueProviderId(), kind: "anthropic", model: "")
                )
            } label: {
                Label("Add provider", systemImage: "plus")
            }
        } header: {
            Text("Providers")
        } footer: {
            Text("Drag a row to reorder — the topmost provider has the highest routing priority. Each provider id must be unique and is referenced by the fallback default.")
        }
    }

    private static let backoffRange = 1 ... 3600

    private var defaultsSection: some View {
        Section("Defaults") {
            Picker("Fallback provider", selection: $config.defaults.fallbackProviderId) {
                Text("(none)").tag("")
                ForEach(config.providers) { provider in
                    Text(provider.id).tag(provider.id)
                }
            }

            LabeledContent("Rate-limit backoff (s)") {
                HStack(spacing: 8) {
                    TextField(
                        "",
                        value: $config.defaults.rateLimitBackoffSeconds,
                        format: .number.grouping(.never)
                    )
                    .labelsHidden()
                    .multilineTextAlignment(.trailing)
                    .frame(width: 64)
                    #if os(macOS)
                        .textFieldStyle(.roundedBorder)
                    #endif

                    Stepper(
                        "",
                        value: $config.defaults.rateLimitBackoffSeconds,
                        in: Self.backoffRange
                    )
                    .labelsHidden()
                }
                .onChange(of: config.defaults.rateLimitBackoffSeconds) { _, newValue in
                    let clamped = min(
                        max(newValue, Self.backoffRange.lowerBound),
                        Self.backoffRange.upperBound
                    )
                    if clamped != newValue {
                        config.defaults.rateLimitBackoffSeconds = clamped
                    }
                }
            }
        }
    }

    // MARK: Priority derivation -------------------------------------------------

    /// The provider order *is* the priority: the topmost provider gets the
    /// highest weight, decreasing by one per row. Used both on load (to migrate
    /// older configs / sort by existing weight) and whenever the provider list
    /// changes.
    private func derivedPriorities(for providers: [SeherProvider]) -> [SeherPriorityRule] {
        let count = providers.count
        return providers.enumerated().map { index, provider in
            SeherPriorityRule(providerId: provider.id, weight: count - index)
        }
    }

    /// Re-derive `priorities` from the (possibly reordered) provider list.
    /// Guarded on the ordered (providerId, weight) sequence so editing an
    /// unrelated field (kind / model / credentials) doesn't churn the priorities
    /// array. Order-sensitive (not a dictionary) so duplicate or empty provider
    /// ids can't collapse into one another and skip a real update.
    private func syncPriorities(with providers: [SeherProvider]) {
        let derived = derivedPriorities(for: providers)
        let unchanged = config.priorities.count == derived.count
            && zip(config.priorities, derived).allSatisfy {
                $0.providerId == $1.providerId && $0.weight == $1.weight
            }
        if !unchanged {
            config.priorities = derived
        }
    }

    /// A `provider-N` id not already in use, so the Add button never produces a
    /// duplicate (which would otherwise let two providers share a priority slot).
    private func uniqueProviderId() -> String {
        let existing = Set(config.providers.map(\.id))
        var n = config.providers.count + 1
        while existing.contains("provider-\(n)") {
            n += 1
        }
        return "provider-\(n)"
    }

    /// Open the editor in priority order: sort providers by their existing rule
    /// weight (highest first), then re-derive priorities so the persisted
    /// weights match the displayed order exactly.
    private func normalize(_ loaded: SeherConfig) -> SeherConfig {
        var result = loaded
        let weightFor: (String) -> Int = { id in
            loaded.priorities.filter { $0.providerId == id }.map(\.weight).max() ?? 0
        }
        result.providers = loaded.providers.enumerated()
            .sorted { lhs, rhs in
                let lw = weightFor(lhs.element.id), rw = weightFor(rhs.element.id)
                return lw != rw ? lw > rw : lhs.offset < rhs.offset // stable
            }
            .map(\.element)
        result.priorities = derivedPriorities(for: result.providers)
        return result
    }

    // MARK: Persistence --------------------------------------------------------

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let loaded = try await service.settingsLoad()
            // Open in priority order, but treat the normalized config as the save
            // baseline so merely opening the editor never rewrites the on-disk
            // config (nor silently drops any legacy priority-rule fields). The
            // new order is persisted only once the user actually edits something.
            let normalized = normalize(loaded)
            config = normalized
            lastSavedConfig = normalized
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
    let onDelete: () -> Void
    /// Invoked after a successful sign-in so the editor refreshes the badges.
    let onCredentialsChanged: () -> Void

    @State private var newEnvKey: String = ""
    @State private var newEnvValue: String = ""
    @State private var showAuthSheet: Bool = false
    /// Models fetched live via `models.list` for the current kind (augments the
    /// hardcoded catalog). Cleared when the kind changes.
    @State private var fetchedModels: [String] = []
    @State private var isFetchingModels: Bool = false
    @State private var fetchModelsError: String?

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
                // ☰ affordance: the whole row is draggable via the List's
                // `.onMove`, so this just signals "grab here to reorder".
                Image(systemName: "line.3.horizontal")
                    .foregroundStyle(.secondary)
                    .help("Drag to reorder priority (top = highest)")

                TextField("id", text: $provider.id)
                    .textFieldStyle(.roundedBorder)
                Picker("kind", selection: $provider.kind) {
                    ForEach(Self.kinds, id: \.id) { Text($0.label).tag($0.id) }
                }
                .labelsHidden()
                .frame(width: 200)

                Spacer(minLength: 8)

                Button(role: .destructive, action: onDelete) {
                    Image(systemName: "trash")
                }
                .buttonStyle(.borderless)
                .help("Remove this provider")
            }
            modelField

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
        .task(id: provider.kind) {
            // Reset then (auto-)fetch in one ordered step — keeping the clear in
            // the same closure as the fetch avoids racing a separate onChange,
            // which SwiftUI does not order against task startup. Pull the live
            // list so the dropdown shows current models without a manual click;
            // pi caches, so re-opening is cheap and failures silently leave the
            // hardcoded catalog in place.
            fetchedModels = []
            fetchModelsError = nil
            if SeherModelCatalog.supportsFetch(provider.kind) {
                await fetchModelsAsync(silentOnError: true, refresh: false)
            }
        }
    }

    // MARK: Model (free text + suggestions + live fetch) ------------------------

    /// Hardcoded catalog plus any live-fetched ids (fetched first), de-duplicated
    /// in order. Free-form entry stays available — the menu only fills the field,
    /// so a model newer than the list can always be typed directly.
    private var modelSuggestions: [String] {
        var seen = Set<String>()
        return (fetchedModels + SeherModelCatalog.fallback(for: provider.kind))
            .filter { seen.insert($0).inserted }
    }

    /// Model id entry: a free-form `TextField` plus a dropdown of known models
    /// for the current kind, with an optional live "Fetch" for kinds that pi can
    /// list (anthropic / openai via API key, copilot via auth.json).
    @ViewBuilder
    private var modelField: some View {
        let suggestions = modelSuggestions
        let canFetch = SeherModelCatalog.supportsFetch(provider.kind)
        HStack(spacing: 4) {
            TextField("model", text: $provider.model)
                .textFieldStyle(.roundedBorder)
            if !suggestions.isEmpty || canFetch {
                Menu {
                    ForEach(suggestions, id: \.self) { model in
                        Button {
                            provider.model = model
                        } label: {
                            if provider.model == model {
                                Label(model, systemImage: "checkmark")
                            } else {
                                Text(model)
                            }
                        }
                    }
                    if canFetch {
                        Divider()
                        Button {
                            fetchModels()
                        } label: {
                            Label(
                                fetchedModels.isEmpty ? "Fetch available models" : "Refresh models",
                                systemImage: "arrow.clockwise"
                            )
                        }
                        .disabled(isFetchingModels)
                    }
                    if let fetchModelsError {
                        Divider()
                        Text(fetchModelsError).foregroundStyle(.red)
                    }
                } label: {
                    if isFetchingModels {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "chevron.down")
                    }
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .help("Choose a known model, or fetch the latest from the provider")
            }
        }
    }

    /// API key env var the editor stores for a key-based kind (nil for OAuth).
    private var apiKeyEnvVar: String? {
        switch provider.kind {
        case "anthropic": return "ANTHROPIC_API_KEY"
        case "openai": return "OPENAI_API_KEY"
        default: return nil
        }
    }

    /// Manual fetch trigger (the menu button): bypass the cache and surface errors.
    private func fetchModels() {
        Task { await fetchModelsAsync(silentOnError: false, refresh: true) }
    }

    /// Fetch the live model list for the current kind via the bun-service →
    /// seher-bridge → pi path. Failures (not signed in, no key, offline, bridge
    /// not rebuilt) leave the hardcoded catalog in place. `silentOnError` skips
    /// the in-menu error message for the automatic on-appear fetch so a missing
    /// credential doesn't nag — an explicit "Refresh" still reports the reason.
    /// `refresh` bypasses pi's model cache (manual refresh; the auto fetch may
    /// serve a warm cache).
    private func fetchModelsAsync(silentOnError: Bool, refresh: Bool) async {
        isFetchingModels = true
        fetchModelsError = nil
        defer { isFetchingModels = false }
        let kind = provider.kind
        let apiKey = apiKeyEnvVar.flatMap { provider.envOverrides[$0] }
        let baseUrl = kind == "openai" ? provider.envOverrides["OPENAI_BASE_URL"] : nil
        do {
            let models = try await service.modelsList(kind: kind, apiKey: apiKey, baseUrl: baseUrl, refresh: refresh)
            // The kind may have changed while the request was in flight.
            guard provider.kind == kind else { return }
            fetchedModels = models
            if models.isEmpty, !silentOnError {
                fetchModelsError = "No models returned"
            }
        } catch {
            guard provider.kind == kind else { return }
            if !silentOnError {
                fetchModelsError = error.localizedDescription
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

#Preview("SeherConfigEditor") {
    NavigationStack {
        SeherConfigEditor(service: StubBunService())
    }
}
