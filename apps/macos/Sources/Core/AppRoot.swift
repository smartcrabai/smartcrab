// AppRoot.swift
// Top-level navigation shell with a sidebar of feature tabs.

import SwiftUI

enum SidebarTab: String, CaseIterable, Identifiable, Hashable {
    case chat = "Chat"
    case pipelines = "Pipelines"
    case cron = "Cron"
    case skills = "Skills"
    case history = "History"
    case settings = "Settings"

    var id: String {
        rawValue
    }

    var systemImage: String {
        switch self {
        case .chat: return "bubble.left.and.bubble.right"
        case .pipelines: return "rectangle.connected.to.line.below"
        case .cron: return "clock.arrow.circlepath"
        case .skills: return "puzzlepiece.extension"
        case .history: return "clock"
        case .settings: return "gearshape"
        }
    }
}

struct AppRoot: View {
    @EnvironmentObject private var bun: BunServiceContainer
    @State private var selection: SidebarTab? = .chat

    var body: some View {
        NavigationSplitView {
            List(SidebarTab.allCases, selection: $selection) { tab in
                Label(tab.rawValue, systemImage: tab.systemImage)
                    .tag(Optional(tab))
            }
            .navigationTitle("SmartCrab")
            #if os(macOS)
                .frame(minWidth: 180)
            #endif
        } detail: {
            detailView(for: selection ?? .chat)
        }
    }

    @ViewBuilder
    private func detailView(for tab: SidebarTab) -> some View {
        switch tab {
        case .chat:
            ChatView(service: bun.service)
        case .pipelines:
            PipelineListView(service: bun.service)
        case .cron:
            CronListView(service: bun.service)
        case .skills:
            SkillsView(service: bun.service)
        case .history:
            ExecutionHistoryView(service: bun.service)
        case .settings:
            SettingsView(service: bun.service)
        }
    }
}
