// ChatMessageRow.swift
//
// One message bubble. User messages align trailing with an accent fill;
// assistant and system messages align leading on a secondary background.

import SwiftUI

public struct ChatMessageRow: View {
    public let message: ChatMessage

    public init(message: ChatMessage) {
        self.message = message
    }

    public var body: some View {
        HStack(alignment: .bottom) {
            if isFromUser { Spacer(minLength: 40) }

            VStack(alignment: alignment, spacing: 4) {
                Text(message.content)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(bubbleBackground)
                    .foregroundStyle(bubbleForeground)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .textSelection(.enabled)

                Text(timestampLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if !isFromUser { Spacer(minLength: 40) }
        }
        .frame(maxWidth: .infinity, alignment: isFromUser ? .trailing : .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(roleLabel): \(message.content)")
    }

    // MARK: Style

    private var isFromUser: Bool {
        message.role == .user
    }

    private var alignment: HorizontalAlignment {
        isFromUser ? .trailing : .leading
    }

    private var bubbleBackground: Color {
        switch message.role {
        case .user: return .accentColor
        case .assistant: return .secondary.opacity(0.15)
        case .system: return .yellow.opacity(0.2)
        }
    }

    private var bubbleForeground: Color {
        message.role == .user ? .white : .primary
    }

    private var roleLabel: String {
        switch message.role {
        case .user: return "You"
        case .assistant: return "Assistant"
        case .system: return "System"
        }
    }

    private var timestampLabel: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return "\(roleLabel) · \(formatter.string(from: message.createdAt))"
    }
}

#Preview("ChatMessageRow") {
    VStack(alignment: .leading, spacing: 12) {
        ChatMessageRow(message: ChatMessage(
            role: .assistant,
            content: "Hi! Ask me anything about your pipelines or skills.",
            createdAt: Date(timeIntervalSinceNow: -120)
        ))
        ChatMessageRow(message: ChatMessage(
            role: .user,
            content: "Run the nightly summary now please.",
            createdAt: Date(timeIntervalSinceNow: -60)
        ))
        ChatMessageRow(message: ChatMessage(
            role: .system,
            content: "Cron job triggered manually.",
            createdAt: Date(timeIntervalSinceNow: -30)
        ))
    }
    .padding()
}
