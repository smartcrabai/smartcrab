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

// MARK: - Local request/response shapes

// TODO: replace with generated types once gen-swift.ts emits per-method shapes.

public struct PingResponse: Codable, Sendable, Equatable {
    public let nonce: String
    public let serverTime: String

    public init(nonce: String, serverTime: String) {
        self.nonce = nonce
        self.serverTime = serverTime
    }
}

public struct ChatSendRequest: Codable, Sendable, Equatable {
    public let conversationId: String?
    public let body: String

    public init(conversationId: String? = nil, body: String) {
        self.conversationId = conversationId
        self.body = body
    }
}

public struct ChatSendResponse: Codable, Sendable, Equatable {
    public let conversationId: String
    public let message: ChatMessage

    public init(conversationId: String, message: ChatMessage) {
        self.conversationId = conversationId
        self.message = message
    }
}

public struct PingRequest: Codable, Sendable, Equatable {
    public let nonce: String

    public init(nonce: String) {
        self.nonce = nonce
    }
}

public struct RPCRequest<P: Encodable & Sendable>: Encodable, Sendable {
    public let jsonrpc: String
    public let id: String
    public let method: String
    public let params: P

    public init(id: String, method: String, params: P) {
        jsonrpc = JSONRPC_VERSION
        self.id = id
        self.method = method
        self.params = params
    }
}

public struct RPCResponse<R: Decodable & Sendable>: Decodable, Sendable {
    public let jsonrpc: String
    public let id: String?
    public let result: R?
    public let error: JSONRPCError?
}

extension JSONRPCError: Error {}
