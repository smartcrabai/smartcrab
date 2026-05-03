// ChatComposer.swift
//
// Multiline composer pinned at the bottom of the Chat view. Cmd+Return (macOS)
// or the send button submit. The send action is delivered via an async closure
// so the parent can show a spinner and block re-entry while a request is in
// flight.

import SwiftUI

public struct ChatComposer: View {
    public typealias SendAction = (_ content: String) async -> Void

    private let isSending: Bool
    private let onSend: SendAction

    @State private var draft: String = ""
    @FocusState private var isFocused: Bool

    public init(isSending: Bool, onSend: @escaping SendAction) {
        self.isSending = isSending
        self.onSend = onSend
    }

    public var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Message", text: $draft, axis: .vertical)
                .lineLimit(1...6)
                .textFieldStyle(.roundedBorder)
                .focused($isFocused)
                .disabled(isSending)
                .onSubmit(submit)

            Button(action: submit) {
                if isSending {
                    ProgressView()
                        .frame(width: 22, height: 22)
                } else {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
            }
            .buttonStyle(.borderless)
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(!canSend)
            .accessibilityLabel("Send message")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.thinMaterial)
    }

    private var canSend: Bool {
        !isSending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func submit() {
        guard canSend else { return }
        let toSend = draft
        draft = ""
        Task { await onSend(toSend) }
    }
}

#Preview("ChatComposer idle") {
    ChatComposer(isSending: false) { _ in }
        .padding()
}

#Preview("ChatComposer sending") {
    ChatComposer(isSending: true) { _ in }
        .padding()
}
