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

    private let service: BunServiceProtocol

    @State private var discord: DiscordAdapterConfig = .init()
    @State private var isLoading: Bool = true
    @State private var isToggling: Bool = false
    @State private var isRunning: Bool = false
    @State private var adapterError: String?
    @State private var saveStatus: SaveStatus = .idle
    @State private var lastSavedConfig: DiscordAdapterConfig?
    @State private var saveTask: Task<Void, Never>?

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

                    TextField(
                        "Bot token environment variable",
                        text: $discord.botTokenEnv,
                        prompt: Text("DISCORD_BOT_TOKEN")
                    )
                    .textFieldStyle(.roundedBorder)
                    #if os(iOS)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled(true)
                    #endif

                    TextField(
                        "Notification channel id",
                        text: $discord.notificationChannelId,
                        prompt: Text("123456789012345678")
                    )
                    .textFieldStyle(.roundedBorder)
                    #if os(iOS)
                        .keyboardType(.numberPad)
                        .autocorrectionDisabled(true)
                    #endif
                } header: {
                    Text("Discord")
                } footer: {
                    Text("The bot token is read from the named environment variable at adapter startup; it is never stored in the config database.")
                }

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
        .onChange(of: discord) { _, newValue in
            scheduleAutoSave(for: newValue)
        }
        .onDisappear { saveTask?.cancel() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let loaded = try await service.adapterLoad(adapterId: Self.discordAdapterId)
            discord = loaded
            lastSavedConfig = loaded
            saveStatus = .idle
            isRunning = (try? await service.chatStatus(adapterId: Self.discordAdapterId)) ?? false
        } catch {
            saveStatus = .failed("Failed to load: \(error.localizedDescription)")
        }
    }

    private func toggleRunning() async {
        isToggling = true
        defer { isToggling = false }
        adapterError = nil
        do {
            isRunning = if isRunning {
                try await service.chatStop(adapterId: Self.discordAdapterId)
            } else {
                try await service.chatStart(adapterId: Self.discordAdapterId)
            }
        } catch {
            adapterError = "Adapter error: \(error.localizedDescription)"
        }
    }

    private func scheduleAutoSave(for newValue: DiscordAdapterConfig) {
        // Cancel pending debounce BEFORE the no-op guard so an A→B→A revert
        // doesn't leave the B-scheduled task to fire a useless save.
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
