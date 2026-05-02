// RPCTypes.swift
// TODO: replace with Unit 2's gen-swift output once available.
// Minimal Codable types matching the Bun JSON-RPC service surface.

import Foundation

public struct PingRequest: Codable, Sendable, Equatable {
    public let nonce: String
    public init(nonce: String) { self.nonce = nonce }
}

public struct PingResponse: Codable, Sendable, Equatable {
    public let nonce: String
    public let serverTime: String
    public init(nonce: String, serverTime: String) {
        self.nonce = nonce
        self.serverTime = serverTime
    }
}

public struct Pipeline: Codable, Sendable, Identifiable, Equatable, Hashable {
    public let id: String
    public let name: String
    public let description: String?
    public init(id: String, name: String, description: String? = nil) {
        self.id = id
        self.name = name
        self.description = description
    }
}

public struct ChatMessage: Codable, Sendable, Identifiable, Equatable, Hashable {
    public enum Role: String, Codable, Sendable { case user, assistant, system }
    public let id: String
    public let role: Role
    public let content: String
    public let createdAt: String
    public init(id: String, role: Role, content: String, createdAt: String) {
        self.id = id
        self.role = role
        self.content = content
        self.createdAt = createdAt
    }
}

public struct ChatSendRequest: Codable, Sendable, Equatable {
    public let conversationId: String?
    public let content: String
    public init(conversationId: String?, content: String) {
        self.conversationId = conversationId
        self.content = content
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

public struct Skill: Codable, Sendable, Identifiable, Equatable, Hashable {
    public let id: String
    public let name: String
    public let summary: String?
    public init(id: String, name: String, summary: String? = nil) {
        self.id = id
        self.name = name
        self.summary = summary
    }
}

// MARK: - JSON-RPC envelope

public struct RPCRequest<P: Encodable>: Encodable {
    public let jsonrpc: String
    public let id: String
    public let method: String
    public let params: P?
    public init(id: String, method: String, params: P?) {
        self.jsonrpc = "2.0"
        self.id = id
        self.method = method
        self.params = params
    }
}

public struct RPCError: Codable, Sendable, Error {
    public let code: Int
    public let message: String
    public let data: String?
}

public struct RPCResponse<R: Decodable>: Decodable {
    public let jsonrpc: String
    public let id: String?
    public let result: R?
    public let error: RPCError?
}
