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

    var id: String { rawValue }

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
            PlaceholderView(title: "Chat", subtitle: "Conversations land here.")
        case .pipelines:
            PlaceholderView(title: "Pipelines", subtitle: "Manage and execute pipelines.")
        case .cron:
            PlaceholderView(title: "Cron", subtitle: "Scheduled tasks live here.")
        case .skills:
            PlaceholderView(title: "Skills", subtitle: "Reusable agent skills.")
        case .history:
            PlaceholderView(title: "History", subtitle: "Past runs and transcripts.")
        case .settings:
            PlaceholderView(title: "Settings", subtitle: "Configure SmartCrab.")
        }
    }
}

private struct PlaceholderView: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 12) {
            Text(title).font(.largeTitle.bold())
            Text(subtitle).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle(title)
    }
}

#Preview {
    AppRoot()
}
