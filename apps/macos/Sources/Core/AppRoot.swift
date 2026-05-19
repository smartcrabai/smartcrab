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
    @Environment(BunServiceContainer.self) private var bun
    @State private var selection: SidebarTab? = .chat

    var body: some View {
        NavigationSplitView {
            sidebar
                .navigationTitle("SmartCrab")
            #if os(macOS)
                .frame(minWidth: 180)
            #endif
        } detail: {
            detailView(for: selection ?? .chat)
        }
    }

    /// Hand-rolled VStack instead of `List(selection:)` because the latter
    /// stops propagating real mouse clicks to its binding on macOS 15
    /// (AXSelected still works; clicks no-op).
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(SidebarTab.allCases) { tab in
                sidebarRow(for: tab)
            }
            Spacer()
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private func sidebarRow(for tab: SidebarTab) -> some View {
        let shape = RoundedRectangle(cornerRadius: 6)
        Button {
            selection = tab
        } label: {
            Label(tab.rawValue, systemImage: tab.systemImage)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(selection == tab ? Color.accentColor.opacity(0.25) : .clear, in: shape)
                .contentShape(shape)
        }
        .buttonStyle(.plain)
        #if os(macOS)
            .keyboardShortcut(
                KeyEquivalent(Character("\(tab.shortcutNumber)")),
                modifiers: .command
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

// MARK: - Helpers

extension Binding {
    /// Bridges a `Binding<T?>` to the `Binding<Bool>` that SwiftUI's
    /// `alert/sheet(isPresented:presenting:)` modifiers expect. Setting it to
    /// `false` clears the optional — analogous to the deprecated
    /// `.alert(item:)` pattern.
    static func isPresenting<Wrapped>(_ source: Binding<Wrapped?>) -> Binding<Bool>
        where Value == Bool
    {
        Binding<Bool>(
            get: { source.wrappedValue != nil },
            set: { isPresented in
                if !isPresented { source.wrappedValue = nil }
            }
        )
    }
}
