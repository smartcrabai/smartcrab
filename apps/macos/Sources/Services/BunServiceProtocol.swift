// BunServiceProtocol.swift
// Abstract contract for the Bun-backed JSON-RPC service.

import Foundation

public protocol BunServiceProtocol: AnyObject, Sendable {
    /// Boot the underlying transport (subprocess on macOS, no-op on iOS mock).
    func start() async throws

    /// Tear down the transport.
    func stop() async

    /// Liveness check.
    func ping(nonce: String) async throws -> PingResponse

    /// Pipelines.
    func pipelineList() async throws -> [Pipeline]

    /// Chat.
    func chatSend(_ request: ChatSendRequest) async throws -> ChatSendResponse
    func chatHistory(conversationId: String) async throws -> [ChatMessage]

    /// Skills.
    func skillList() async throws -> [Skill]
}
