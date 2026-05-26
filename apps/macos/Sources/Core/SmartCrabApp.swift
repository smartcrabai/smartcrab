// SmartCrabApp.swift
// Universal SwiftUI entry point for both SmartCrabMac (macOS) and SmartCrabPreview (iOS Simulator).

import SwiftUI

@main
struct SmartCrabApp: App {
    @State private var bun = BunServiceContainer()

    var body: some Scene {
        #if os(macOS)
            WindowGroup("SmartCrab") {
                AppRoot()
                    .environment(bun)
                    .frame(minWidth: 900, minHeight: 600)
                    .task { await bun.start() }
            }
            .windowStyle(.titleBar)
            .windowToolbarStyle(.unified)
        #else
            WindowGroup {
                AppRoot()
                    .environment(bun)
                    .task { await bun.start() }
            }
        #endif
    }
}

/// Container that provides a `BunServiceProtocol` to the SwiftUI environment.
/// On macOS we use the real subprocess-backed service; on iOS we use the mock.
@MainActor
@Observable
final class BunServiceContainer {
    let service: BunServiceProtocol
    #if os(macOS)
        private let keychainProvider: () throws -> String?
    #endif

    init() {
        #if os(macOS)
            service = BunServiceMacOS()
            keychainProvider = { try KeychainStore.get(account: KeychainAccount.discordBotToken) }
        #else
            service = BunServiceMock()
        #endif
    }

    #if os(macOS)
        init(service: BunServiceProtocol, keychainProvider: @escaping () throws -> String?) {
            self.service = service
            self.keychainProvider = keychainProvider
        }
    #endif

    func start() async {
        do {
            try await service.start()
        } catch {
            // Best-effort start; UI will display its own connectivity state.
            print("BunService failed to start: \(error)")
            return
        }
        #if os(macOS)
            await autostartDiscordAdapter()
        #endif
    }

    #if os(macOS)
        /// Restores enabled adapters on launch; failures are ignored — user recovers via Settings.
        private func autostartDiscordAdapter() async {
            let adapterId = AdapterSettings.discordAdapterId
            let config: DiscordAdapterConfig
            do {
                config = try await service.adapterLoad(adapterId: adapterId)
            } catch {
                print("Adapter autostart: adapterLoad(\(adapterId)) failed: \(error)")
                return
            }
            guard config.enabled else { return }

            let token: String
            do {
                guard let stored = try keychainProvider() else { return }
                token = stored.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !token.isEmpty else { return }
            } catch {
                print("Adapter autostart: keychain read failed for \(adapterId): \(error)")
                return
            }

            do {
                _ = try await service.chatStart(adapterId: adapterId, token: token)
            } catch {
                print("Adapter autostart: chat.start(\(adapterId)) failed: \(error)")
            }
        }
    #endif
}
