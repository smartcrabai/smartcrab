// ChatBubbleRow.swift
//
// One message bubble. User messages align trailing with an accent fill;
// assistant and system messages align leading on a secondary background.

import SwiftUI

public struct ChatBubbleRow: View {
    public let message: ChatBubble

    public init(message: ChatBubble) {
        self.message = message
    }

    public var body: some View {
        TimelineView(.periodic(from: Calendar.autoupdatingCurrent.startOfDay(for: .now), by: 86400)) { context in
            HStack(alignment: .bottom) {
                if isFromUser {
                    Spacer(minLength: 40)
                }

                VStack(alignment: alignment, spacing: 4) {
                    Text(message.content)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(bubbleBackground)
                        .foregroundStyle(bubbleForeground)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .textSelection(.enabled)

                    Text(timestampLabel(referenceDate: context.date))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                // Keep bubbles at a chat-like width instead of spanning the row.
                .frame(maxWidth: 560, alignment: isFromUser ? .trailing : .leading)

                if !isFromUser {
                    Spacer(minLength: 40)
                }
            }
            .frame(maxWidth: .infinity, alignment: isFromUser ? .trailing : .leading)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(roleLabel): \(message.content), \(formattedTime(referenceDate: context.date))")
        }
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

    private func formattedTime(referenceDate: Date) -> String {
        let createdAt = message.createdAt
        if Calendar.autoupdatingCurrent.isDate(createdAt, inSameDayAs: referenceDate) {
            return createdAt.formatted(date: .omitted, time: .shortened)
        }
        return createdAt.formatted(date: .abbreviated, time: .shortened)
    }

    private func timestampLabel(referenceDate: Date) -> String {
        "\(roleLabel) - \(formattedTime(referenceDate: referenceDate))"
    }
}

// MARK: - Preview

#Preview("ChatBubbleRow – timestamp variants") {
    VStack(alignment: .leading, spacing: 16) {
        ChatBubbleRow(message: ChatBubble(
            role: .assistant,
            content: "Hi! Ask me anything about your pipelines or skills.",
            createdAt: Date(timeIntervalSinceNow: -120)
        ))
        ChatBubbleRow(message: ChatBubble(
            role: .user,
            content: "Run the nightly summary now please.",
            createdAt: Date(timeIntervalSinceNow: -60)
        ))
        ChatBubbleRow(message: ChatBubble(
            role: .system,
            content: "Cron job triggered manually.",
            createdAt: Date(timeIntervalSinceNow: -60 * 60 * 48)
        ))
    }
    .padding()
}
