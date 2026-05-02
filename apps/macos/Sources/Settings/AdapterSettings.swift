// AdapterSettings.swift
//
// Chat-adapter configuration screen. Currently only Discord is wired up; future
// adapters will be added here as additional sections. Each adapter loads from
// `BunServiceProtocol.adapterLoad(adapterId:)` and saves via `adapterSave`.

import SwiftUI

public struct AdapterSettings: View {
    private static let discordAdapterId = "discord"

    private let service: BunServiceProtocol

    @State private var discord: DiscordAdapterConfig = DiscordAdapterConfig()
    @State private var isLoading: Bool = true
    @State private var isSaving: Bool = false
    @State private var errorMessage: String?
    @State private var savedMessage: String?

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

                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
                if let savedMessage {
                    Section { Text(savedMessage).foregroundStyle(.secondary) }
                }
            }
        }
        .formStyle(.grouped)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await save() }
                } label: {
                    if isSaving { ProgressView() } else { Text("Save") }
                }
                .disabled(isLoading || isSaving)
            }
        }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            discord = try await service.adapterLoad(adapterId: Self.discordAdapterId)
        } catch {
            errorMessage = "Failed to load: \(error.localizedDescription)"
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        errorMessage = nil
        savedMessage = nil
        do {
            try await service.adapterSave(adapterId: Self.discordAdapterId, config: discord)
            savedMessage = "Saved."
        } catch {
            errorMessage = "Failed to save: \(error.localizedDescription)"
        }
    }
}

#Preview("AdapterSettings") {
    NavigationStack {
        AdapterSettings(service: BunServiceMock())
    }
}
