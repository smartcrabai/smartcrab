// SmartCrabApp.swift
// Universal SwiftUI entry point for both SmartCrabMac (macOS) and SmartCrabPreview (iOS Simulator).

import SwiftUI

@main
struct SmartCrabApp: App {
    @StateObject private var bun = BunServiceContainer()

    var body: some Scene {
        #if os(macOS)
            WindowGroup("SmartCrab") {
                AppRoot()
                    .environmentObject(bun)
                    .frame(minWidth: 900, minHeight: 600)
                    .task {
                        await bun.start()
                    }
            }
            .windowStyle(.titleBar)
            .windowToolbarStyle(.unified)
        #else
            WindowGroup {
                AppRoot()
                    .environmentObject(bun)
                    .task {
                        await bun.start()
                    }
            }
        #endif
    }
}

/// Container that provides a `BunServiceProtocol` to the SwiftUI environment.
/// On macOS we use the real subprocess-backed service; on iOS we use the mock.
@MainActor
final class BunServiceContainer: ObservableObject {
    let service: BunServiceProtocol

    init() {
        #if os(macOS)
            service = BunServiceMacOS()
        #else
            service = BunServiceMock()
        #endif
    }

    func start() async {
        do {
            try await service.start()
        } catch {
            // Best-effort start; UI will display its own connectivity state.
            print("BunService failed to start: \(error)")
        }
    }
}
