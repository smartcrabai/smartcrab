// AdapterSettings.swift
//
// Chat-adapter configuration screen. Currently only Discord is wired up; future
// adapters will be added here as additional sections. Edits are auto-saved
// (debounced) via `BunServiceProtocol.adapterSave`; a save-status pill is
// pinned to the bottom of the form.

import SwiftUI

public struct AdapterSettings: View {
    private static let discordAdapterId = "discord"
    private static let autoSaveDebounce: Duration = .milliseconds(500)
    private static let pairingPollInterval: Duration = .seconds(5)

    private let service: BunServiceProtocol

    @State private var discord: DiscordAdapterConfig = .init()
    @State private var token: String = ""
    @State private var isLoading: Bool = true
    @State private var isToggling: Bool = false
    @State private var isRunning: Bool = false
    @State private var adapterError: String?
    @State private var saveStatus: SaveStatus = .idle
    @State private var lastSavedConfig: DiscordAdapterConfig?
    @State private var lastSavedToken: String = ""
    @State private var saveTask: Task<Void, Never>?
    @State private var tokenSaveTask: Task<Void, Never>?

    // DM pairing state
    @State private var pendingRequests: [DiscordPairingRequest] = []
    @State private var allowlist: [DiscordAllowlistEntry] = []
    @State private var pairingError: String?
    @State private var pairingBusyId: String?

    public init(service: BunServiceProtocol) {
        self.service = service
    }

    public var body: some View {
        Form {
            if isLoading {
                ProgressView("Loading adapter configuration…")
            } else {
                Section {
                    Toggle("Enable Discord adapter", isOn: $discord.enabled)

                    SecureField(
                        "Bot token",
                        text: $token,
                        prompt: Text("Paste your Discord bot token")
                    )
                    .textFieldStyle(.roundedBorder)
                    #if os(iOS)
                        .autocorrectionDisabled(true)
                        .textInputAutocapitalization(.never)
                    #endif
                } header: {
                    Text("Discord")
                } footer: {
                    Text("The token is stored in the macOS Keychain (app-sandbox scoped) and is sent to the Bun service only when the adapter starts. It never touches SmartCrab's SQLite database.")
                }

                Section {
                    Picker("DM policy", selection: $discord.dmPolicy) {
                        Text("Pairing").tag(DiscordDmPolicy.pairing)
                        Text("Allowlist").tag(DiscordDmPolicy.allowlist)
                        Text("Disabled").tag(DiscordDmPolicy.disabled)
                    }
                } header: {
                    Text("Direct message access")
                } footer: {
                    Text(dmPolicyFooter(discord.dmPolicy))
                }

                pendingPairingSection
                allowlistSection

                Section {
                    HStack {
                        Circle()
                            .fill(isRunning ? Color.green : Color.secondary)
                            .frame(width: 10, height: 10)
                        Text(isRunning ? "Running" : "Stopped")
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button(isRunning ? "Stop" : "Start") {
                            Task { await toggleRunning() }
                        }
                        .disabled(isToggling)
                    }
                } header: {
                    Text("Adapter status")
                }

                if let adapterError {
                    Section { Text(adapterError).foregroundStyle(.red) }
                }
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
        .task(id: isRunning) { await pollPairingState() }
        .onChange(of: discord) { _, newValue in
            scheduleAutoSave(for: newValue)
        }
        .onChange(of: token) { _, newValue in
            scheduleTokenSave(for: newValue)
        }
        .onDisappear {
            saveTask?.cancel()
            tokenSaveTask?.cancel()
        }
    }

    // MARK: - Pairing UI

    @ViewBuilder
    private var pendingPairingSection: some View {
        Section {
            if pendingRequests.isEmpty {
                Text("No pending pairing requests.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(pendingRequests) { request in
                    pendingRow(request)
                }
            }
            if let pairingError {
                Text(pairingError).foregroundStyle(.red)
            }
        } header: {
            HStack {
                Text("Pending pairing requests")
                Spacer()
                Button {
                    Task { await refreshPairing() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
            }
        } footer: {
            Text("DM senders whose code is approved here can talk to the bot. Codes expire after one hour.")
        }
    }

    private func pendingRow(_ request: DiscordPairingRequest) -> some View {
        let busy = pairingBusyId == request.id
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(request.displayName)
                    .font(.body.monospacedDigit())
                Text(request.senderId)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(request.code)
                .font(.system(.body, design: .monospaced))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.gray.opacity(0.15), in: RoundedRectangle(cornerRadius: 6))
            Button("Approve") {
                Task { await approve(request) }
            }
            .buttonStyle(.borderedProminent)
            .disabled(busy)
            Button("Reject") {
                Task { await reject(request) }
            }
            .disabled(busy)
        }
    }

    @ViewBuilder
    private var allowlistSection: some View {
        Section {
            if allowlist.isEmpty {
                Text("No approved senders yet.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(allowlist) { entry in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.displayName)
                            Text(entry.senderId)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Remove") {
                            Task { await removeAllow(entry) }
                        }
                        .disabled(pairingBusyId == entry.id)
                    }
                }
            }
        } header: {
            Text("Approved DM senders")
        }
    }

    private func dmPolicyFooter(_ policy: DiscordDmPolicy) -> String {
        switch policy {
        case .pairing:
            return "Unknown DM senders receive a pairing code and are held until you approve them here."
        case .allowlist:
            return "Only senders in the allowlist below can DM the bot. Others are dropped silently."
        case .disabled:
            return "All DMs are ignored. Guild messages are unaffected."
        }
    }

    // MARK: - Networking

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        async let loadedConfig = service.adapterLoad(adapterId: Self.discordAdapterId)
        async let runningStatus = service.chatStatus(adapterId: Self.discordAdapterId)
        async let pendingList = service.chatPairingList(adapterId: Self.discordAdapterId)
        async let allowedList = service.chatPairingAllowlist(adapterId: Self.discordAdapterId)
        do {
            let loaded = try await loadedConfig
            discord = loaded
            lastSavedConfig = loaded
            do {
                token = (try loadStoredToken()) ?? ""
                lastSavedToken = token
            } catch {
                adapterError = "Keychain read failed: \(error.localizedDescription)"
            }
            saveStatus = .idle
            isRunning = (try? await runningStatus) ?? false
            do {
                pendingRequests = try await pendingList
                allowlist = try await allowedList
                pairingError = nil
            } catch {
                pairingError = "Failed to load pairing state: \(error.localizedDescription)"
            }
        } catch {
            saveStatus = .failed("Failed to load: \(error.localizedDescription)")
        }
    }

    private func toggleRunning() async {
        isToggling = true
        defer { isToggling = false }
        adapterError = nil
        do {
            if isRunning {
                isRunning = try await service.chatStop(adapterId: Self.discordAdapterId)
            } else {
                // Flush any in-flight token edit so the chat.start call sees
                // the same value the user just typed.
                tokenSaveTask?.cancel()
                do {
                    try saveStoredToken(token)
                    lastSavedToken = token
                } catch {
                    adapterError = "Keychain write failed: \(error.localizedDescription)"
                    return
                }
                let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
                let tokenParam: String? = trimmed.isEmpty ? nil : trimmed
                isRunning = try await service.chatStart(
                    adapterId: Self.discordAdapterId, token: tokenParam,
                )
            }
        } catch {
            adapterError = "Adapter error: \(error.localizedDescription)"
        }
    }

    // MARK: - Keychain plumbing

    private func loadStoredToken() throws -> String? {
        try KeychainStore.get(account: KeychainAccount.discordBotToken)
    }

    private func saveStoredToken(_ value: String) throws {
        try KeychainStore.set(value, for: KeychainAccount.discordBotToken)
    }

    private func scheduleTokenSave(for newValue: String) {
        guard newValue != lastSavedToken else { return }
        tokenSaveTask?.cancel()
        tokenSaveTask = makeDebouncedTask {
            do {
                try saveStoredToken(newValue)
                lastSavedToken = newValue
            } catch {
                adapterError = "Keychain write failed: \(error.localizedDescription)"
            }
        }
    }

    private func makeDebouncedTask(_ work: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
        Task { @MainActor in
            do {
                try await Task.sleep(for: Self.autoSaveDebounce)
            } catch {
                return
            }
            await work()
        }
    }

    private func refreshPairing() async {
        pairingError = nil
        do {
            async let pending = service.chatPairingList(adapterId: Self.discordAdapterId)
            async let allowed = service.chatPairingAllowlist(adapterId: Self.discordAdapterId)
            let nextPending = try await pending
            let nextAllowed = try await allowed
            // Guard SwiftUI re-renders: the 5s poll otherwise dirties the
            // two ForEach sections every tick even when nothing changed.
            if nextPending != pendingRequests { pendingRequests = nextPending }
            if nextAllowed != allowlist { allowlist = nextAllowed }
        } catch {
            pairingError = "Failed to load pairing state: \(error.localizedDescription)"
        }
    }

    /// Adapter has no push channel, so poll every `pairingPollInterval`
    /// while Settings is open.
    private func pollPairingState() async {
        while !Task.isCancelled {
            do {
                try await Task.sleep(for: Self.pairingPollInterval)
            } catch {
                return
            }
            await refreshPairing()
        }
    }

    private func approve(_ request: DiscordPairingRequest) async {
        pairingBusyId = request.id
        defer { pairingBusyId = nil }
        do {
            _ = try await service.chatPairingApprove(
                adapterId: Self.discordAdapterId, code: request.code,
            )
            await refreshPairing()
        } catch {
            pairingError = "Approve failed: \(error.localizedDescription)"
        }
    }

    private func reject(_ request: DiscordPairingRequest) async {
        pairingBusyId = request.id
        defer { pairingBusyId = nil }
        do {
            _ = try await service.chatPairingReject(
                adapterId: Self.discordAdapterId, code: request.code,
            )
            await refreshPairing()
        } catch {
            pairingError = "Reject failed: \(error.localizedDescription)"
        }
    }

    private func removeAllow(_ entry: DiscordAllowlistEntry) async {
        pairingBusyId = entry.id
        defer { pairingBusyId = nil }
        do {
            _ = try await service.chatPairingAllowlistRemove(
                adapterId: Self.discordAdapterId, senderId: entry.senderId,
            )
            await refreshPairing()
        } catch {
            pairingError = "Remove failed: \(error.localizedDescription)"
        }
    }

    private func scheduleAutoSave(for newValue: DiscordAdapterConfig) {
        // Cancel BEFORE the no-op guard so an A→B→A revert doesn't leave the
        // B-scheduled task firing a useless save.
        guard let baseline = lastSavedConfig else { return }
        saveTask?.cancel()
        guard baseline != newValue else { return }
        saveTask = makeDebouncedTask { await save() }
    }

    private func save() async {
        saveStatus = .saving
        do {
            let snapshot = discord
            try await service.adapterSave(adapterId: Self.discordAdapterId, config: snapshot)
            lastSavedConfig = snapshot
            saveStatus = .saved(Date())
        } catch {
            saveStatus = .failed("Failed to save: \(error.localizedDescription)")
        }
    }
}

#Preview("AdapterSettings") {
    NavigationStack {
        AdapterSettings(service: StubBunService())
    }
}
