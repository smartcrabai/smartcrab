// SettingsView.swift
//
// Top-level Settings container. Renders the seher LLM routing editor and the
// chat adapter (Discord) editor. All state is loaded/saved via
// `BunServiceProtocol`; the iOS Simulator preview target uses `BunServiceMock`.
//
// TODO(unit-13): When `Sources/Services/BunServiceProtocol.swift` lands on
// `main`, delete the stub types in this file (BunServiceProtocol, BunServiceMock,
// SeherConfig and friends, ChatMessage, DiscordAdapterConfig) and `import` the
// real shared module instead. The stub deliberately mirrors the planned shapes.

import SwiftUI

// MARK: - Stubbed shared types (TODO unit-13: remove) -----------------------------

/// One LLM provider entry in the seher config.
public struct SeherProvider: Identifiable, Hashable, Codable {
    public var id: String
    public var kind: String          // "claude" | "kimi" | "copilot"
    public var model: String
    public var envOverrides: [String: String]

    public init(id: String, kind: String, model: String, envOverrides: [String: String] = [:]) {
        self.id = id
        self.kind = kind
        self.model = model
        self.envOverrides = envOverrides
    }
}

/// Priority rule that ranks providers in a given context window.
public struct SeherPriorityRule: Identifiable, Hashable, Codable {
    public var id: UUID
    public var providerId: String
    public var weight: Int
    /// 0 = Sunday … 6 = Saturday. Empty matches every weekday.
    public var weekdayFilter: [Int]
    public var hourStart: Int        // 0..23 inclusive
    public var hourEnd: Int          // 0..23 inclusive
    public var condition: String     // free-form predicate string

    public init(
        id: UUID = UUID(),
        providerId: String,
        weight: Int = 1,
        weekdayFilter: [Int] = [],
        hourStart: Int = 0,
        hourEnd: Int = 23,
        condition: String = ""
    ) {
        self.id = id
        self.providerId = providerId
        self.weight = weight
        self.weekdayFilter = weekdayFilter
        self.hourStart = hourStart
        self.hourEnd = hourEnd
        self.condition = condition
    }
}

/// Defaults applied when no priority rule matches.
public struct SeherDefaults: Hashable, Codable {
    public var fallbackProviderId: String
    public var rateLimitBackoffSeconds: Int

    public init(fallbackProviderId: String = "", rateLimitBackoffSeconds: Int = 30) {
        self.fallbackProviderId = fallbackProviderId
        self.rateLimitBackoffSeconds = rateLimitBackoffSeconds
    }
}

/// Smartcrab seher configuration as edited by the GUI.
public struct SeherConfig: Hashable, Codable {
    public var providers: [SeherProvider]
    public var priorities: [SeherPriorityRule]
    public var defaults: SeherDefaults

    public init(
        providers: [SeherProvider] = [],
        priorities: [SeherPriorityRule] = [],
        defaults: SeherDefaults = SeherDefaults()
    ) {
        self.providers = providers
        self.priorities = priorities
        self.defaults = defaults
    }
}

/// Discord chat-adapter settings exposed in the UI.
public struct DiscordAdapterConfig: Hashable, Codable {
    public var botTokenEnv: String
    public var notificationChannelId: String
    public var enabled: Bool

    public init(botTokenEnv: String = "", notificationChannelId: String = "", enabled: Bool = false) {
        self.botTokenEnv = botTokenEnv
        self.notificationChannelId = notificationChannelId
        self.enabled = enabled
    }
}

/// Chat message used by the Chat view.
public struct ChatMessage: Identifiable, Hashable, Codable {
    public enum Role: String, Codable, Hashable {
        case user, assistant, system
    }

    public var id: UUID
    public var role: Role
    public var content: String
    public var createdAt: Date

    public init(id: UUID = UUID(), role: Role, content: String, createdAt: Date = Date()) {
        self.id = id
        self.role = role
        self.content = content
        self.createdAt = createdAt
    }
}

/// Subset of the BunService surface consumed by Unit 14 (Settings + Chat).
@MainActor
public protocol BunServiceProtocol: AnyObject {
    func settingsLoad() async throws -> SeherConfig
    func settingsSave(_ config: SeherConfig) async throws

    func adapterLoad(adapterId: String) async throws -> DiscordAdapterConfig
    func adapterSave(adapterId: String, config: DiscordAdapterConfig) async throws

    func chatHistory() async throws -> [ChatMessage]
    func chatSend(_ content: String) async throws -> ChatMessage
}

/// In-memory mock used for SwiftUI previews and the iOS Simulator preview target,
/// which cannot launch subprocesses.
@MainActor
public final class BunServiceMock: BunServiceProtocol {
    private var seherConfig: SeherConfig
    private var discord: DiscordAdapterConfig
    private var messages: [ChatMessage]

    public init() {
        self.seherConfig = SeherConfig(
            providers: [
                SeherProvider(id: "claude-default", kind: "claude", model: "claude-sonnet-4-7"),
                SeherProvider(id: "kimi-default", kind: "kimi", model: "kimi-k2-0905-preview"),
                SeherProvider(id: "copilot-default", kind: "copilot", model: "gpt-4o"),
            ],
            priorities: [
                SeherPriorityRule(
                    providerId: "claude-default",
                    weight: 10,
                    weekdayFilter: [1, 2, 3, 4, 5],
                    hourStart: 9,
                    hourEnd: 18,
                    condition: "task.kind == \"code\""
                ),
                SeherPriorityRule(providerId: "kimi-default", weight: 5),
            ],
            defaults: SeherDefaults(fallbackProviderId: "claude-default", rateLimitBackoffSeconds: 60)
        )
        self.discord = DiscordAdapterConfig(
            botTokenEnv: "DISCORD_BOT_TOKEN",
            notificationChannelId: "1234567890",
            enabled: false
        )
        self.messages = [
            ChatMessage(role: .assistant, content: "Welcome to SmartCrab. How can I help today?",
                        createdAt: Date(timeIntervalSinceNow: -300)),
            ChatMessage(role: .user, content: "Show me the pipelines I have configured.",
                        createdAt: Date(timeIntervalSinceNow: -240)),
            ChatMessage(role: .assistant,
                        content: "You have 3 pipelines: nightly-summary, on-demand-review, weekly-digest.",
                        createdAt: Date(timeIntervalSinceNow: -180)),
        ]
    }

    public func settingsLoad() async throws -> SeherConfig { seherConfig }
    public func settingsSave(_ config: SeherConfig) async throws { seherConfig = config }

    public func adapterLoad(adapterId _: String) async throws -> DiscordAdapterConfig { discord }
    public func adapterSave(adapterId _: String, config: DiscordAdapterConfig) async throws {
        discord = config
    }

    public func chatHistory() async throws -> [ChatMessage] { messages }
    public func chatSend(_ content: String) async throws -> ChatMessage {
        let userMessage = ChatMessage(role: .user, content: content)
        messages.append(userMessage)
        let reply = ChatMessage(role: .assistant, content: "Mock response to: \(content)")
        messages.append(reply)
        return reply
    }
}

// MARK: - SettingsView ----------------------------------------------------------

public struct SettingsView: View {
    public enum Tab: String, CaseIterable, Identifiable {
        case seher = "LLM routing"
        case adapters = "Chat adapters"

        public var id: String { rawValue }
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
        SettingsView(service: BunServiceMock())
    }
}
