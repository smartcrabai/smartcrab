// BunServiceMock.swift
// In-memory mock used by the SmartCrabPreview (iOS Simulator) target so that
// SwiftUI previews and Simulator runs do not require the Bun subprocess.

#if os(iOS)
import Foundation

public final class BunServiceMock: BunServiceProtocol, @unchecked Sendable {
    private var conversations: [String: [ChatMessage]] = [:]

    public init() {}

    public func start() async throws { /* no-op */ }
    public func stop() async { /* no-op */ }

    public func ping(nonce: String) async throws -> PingResponse {
        PingResponse(nonce: nonce, serverTime: ISO8601DateFormatter().string(from: Date()))
    }

    public func pipelineList() async throws -> [Pipeline] {
        [
            Pipeline(id: "pl-1", name: "Daily Standup Summary", description: "Aggregates Slack messages."),
            Pipeline(id: "pl-2", name: "Issue Triage", description: "Classifies new GitHub issues."),
            Pipeline(id: "pl-3", name: "Release Notes", description: "Drafts release notes from PRs."),
        ]
    }

    public func chatSend(_ request: ChatSendRequest) async throws -> ChatSendResponse {
        let convoId = request.conversationId ?? "conv-mock"
        let now = ISO8601DateFormatter().string(from: Date())
        let userMsg = ChatMessage(
            id: "u-\(UUID().uuidString.prefix(6))",
            role: .user,
            content: request.content,
            createdAt: now
        )
        let assistantMsg = ChatMessage(
            id: "a-\(UUID().uuidString.prefix(6))",
            role: .assistant,
            content: "Mock reply to: \(request.content)",
            createdAt: now
        )
        conversations[convoId, default: seedMessages()].append(contentsOf: [userMsg, assistantMsg])
        return ChatSendResponse(conversationId: convoId, message: assistantMsg)
    }

    public func chatHistory(conversationId: String) async throws -> [ChatMessage] {
        conversations[conversationId] ?? seedMessages()
    }

    public func skillList() async throws -> [Skill] {
        [
            Skill(id: "sk-1", name: "Web Search", summary: "Query the public web."),
            Skill(id: "sk-2", name: "Code Review", summary: "Inspect a diff and suggest fixes."),
        ]
    }

    private func seedMessages() -> [ChatMessage] {
        let t = ISO8601DateFormatter().string(from: Date())
        return [
            ChatMessage(id: "m-1", role: .system, content: "You are SmartCrab.", createdAt: t),
            ChatMessage(id: "m-2", role: .user, content: "Hi!", createdAt: t),
            ChatMessage(id: "m-3", role: .assistant, content: "Hello, I am the mock.", createdAt: t),
            ChatMessage(id: "m-4", role: .user, content: "What can you do?", createdAt: t),
            ChatMessage(id: "m-5", role: .assistant, content: "Anything you imagine.", createdAt: t),
        ]
    }
}
#endif
