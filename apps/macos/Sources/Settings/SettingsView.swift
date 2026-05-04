// SettingsView.swift
//
// Top-level Settings container. Renders the seher LLM routing editor and the
// chat adapter (Discord) editor. All state is loaded/saved via
// `BunServiceProtocol`; the iOS Simulator preview target uses `BunServiceMock`.

import SwiftUI

// MARK: - SettingsView ----------------------------------------------------------

public struct SettingsView: View {
    public enum Tab: String, CaseIterable, Identifiable {
        case seher = "LLM routing"
        case adapters = "Chat adapters"

        public var id: String {
            rawValue
        }
    }

    private let service: BunServiceProtocol
    @State private var selection: Tab = .seher

    public init(service: BunServiceProtocol) {
        self.service = service
    }

    public var body: some View {
        VStack(spacing: 0) {
            Picker("Section", selection: $selection) {
                ForEach(Tab.allCases) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.top, 12)
            .padding(.bottom, 8)

            Divider()

            switch selection {
            case .seher:
                SeherConfigEditor(service: service)
            case .adapters:
                AdapterSettings(service: service)
            }
        }
        .navigationTitle("Settings")
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

#Preview("Settings") {
    NavigationStack {
        SettingsView(service: StubBunService())
    }
}
