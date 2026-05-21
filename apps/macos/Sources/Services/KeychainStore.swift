// KeychainStore.swift
//
// Thin wrapper around `kSecClassGenericPassword` items in the user's macOS
// Keychain. Used to store adapter secrets (e.g., the Discord bot token) so
// they never land in SmartCrab's SQLite database.
//
// On macOS the app is sandboxed (`com.apple.security.app-sandbox` true),
// which means the items live in the app's per-container keychain — other
// apps cannot read them. On iOS the same SecItem API operates on the
// device keychain. The Preview/iOS target uses the same helper because
// `Security` is available on both platforms.

import Foundation
import Security

public enum KeychainError: Error, Sendable {
    case unexpectedStatus(OSStatus)
    case dataConversionFailed
}

extension KeychainError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case let .unexpectedStatus(status):
            if let msg = SecCopyErrorMessageString(status, nil) as String? {
                return "Keychain error \(status): \(msg)"
            }
            return "Keychain error \(status)"
        case .dataConversionFailed:
            return "Keychain payload could not be decoded as UTF-8."
        }
    }
}

/// Service identifier used for all SmartCrab keychain items. Concrete
/// accounts (e.g. `"discord.bot_token"`) keep individual secrets distinct.
public enum KeychainStore {
    public static let defaultService = "ai.smartcrab.smartcrab"

    /// Store `value` under `account`. Replaces an existing item.
    /// Passing an empty string deletes the item — callers can treat
    /// "" the same way they treat a missing value.
    public static func set(
        _ value: String,
        for account: String,
        service: String = defaultService
    ) throws {
        if value.isEmpty {
            try delete(account: account, service: service)
            return
        }

        guard let data = value.data(using: .utf8) else {
            throw KeychainError.dataConversionFailed
        }

        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]

        // Update first; if the item doesn't exist yet, add it.
        let updateAttributes: [String: Any] = [
            kSecValueData as String: data,
        ]
        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, updateAttributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        if updateStatus != errSecItemNotFound {
            throw KeychainError.unexpectedStatus(updateStatus)
        }

        var addQuery = baseQuery
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus != errSecSuccess {
            throw KeychainError.unexpectedStatus(addStatus)
        }
    }

    /// Read the secret stored under `account`. Returns `nil` when no
    /// matching item exists.
    public static func get(
        account: String,
        service: String = defaultService
    ) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            guard let data = result as? Data else { return nil }
            return String(data: data, encoding: .utf8)
        case errSecItemNotFound:
            return nil
        default:
            throw KeychainError.unexpectedStatus(status)
        }
    }

    /// Remove the item under `account`. No-op when absent.
    public static func delete(
        account: String,
        service: String = defaultService
    ) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess, status != errSecItemNotFound {
            throw KeychainError.unexpectedStatus(status)
        }
    }
}

/// Stable account identifiers used by the GUI for keychain lookups. Kept
/// here so the SecureField in `AdapterSettings` and the chat-start path
/// don't drift apart.
public enum KeychainAccount {
    public static let discordBotToken = "discord.bot_token"
}
