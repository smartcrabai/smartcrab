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

    /// 1-based shortcut number for the View menu (Cmd+1 ... Cmd+6).
    var shortcutNumber: Int {
        guard let idx = SidebarTab.allCases.firstIndex(of: self) else { return 0 }
        return idx + 1
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
        #if os(macOS)
        // Cmd+1..6 jump straight to a tab. Lets keyboard-driven workflows
        // (and `scripts/e2e/preview-mac.sh`) navigate without clicking the
        // sidebar — SwiftUI's List+selection doesn't respond to synthetic
        // mouse events from System Events / CGEvent reliably.
        .background(
            VStack {
                ForEach(SidebarTab.allCases) { tab in
                    Button("") { selection = tab }
                        .keyboardShortcut(KeyEquivalent(Character("\(tab.shortcutNumber)")), modifiers: .command)
                        .opacity(0)
                        .frame(width: 0, height: 0)
                }
            }
        )
        #endif
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
