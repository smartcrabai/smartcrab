// ChatView.swift
//
// Top-level Chat tab. Renders a scrollable message list with auto-scroll on new
// messages and the composer pinned at the bottom. History is loaded once via
// `BunServiceProtocol.chatHistory()`; sends round-trip through `chatSend`.

import SwiftUI

public struct ChatView: View {
    private let service: BunServiceProtocol

    @State private var messages: [ChatBubble] = []
    @State private var isLoading: Bool = true
    @State private var isSending: Bool = false
    @State private var errorMessage: String?
    @State private var needsProviderSetup: Bool = false
    @State private var composerHeight: CGFloat = 0
    @AppStorage("smartcrab.welcomeDismissed") private var welcomeDismissed: Bool = false
    /// Window-level draft store so unsent input survives tab switches (this
    /// view is recreated each time the sidebar selection changes).
    @Environment(DraftStore.self) private var drafts

    public init(service: BunServiceProtocol) {
        self.service = service
    }

    public var body: some View {
        Group {
            if needsProviderSetup && !welcomeDismissed {
                welcomeView
            } else {
                chatView
            }
        }
        .navigationTitle("Chat")
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .task { await load() }
    }

    private var chatView: some View {
        @Bindable var drafts = drafts
        return VStack(spacing: 0) {
            messageList
            Divider()
            ChatComposer(
                draft: $drafts.chatDraft,
                isSending: isSending,
                onHeightChange: { composerHeight = $0 }
            ) { content in
                await send(content)
            }
        }
    }

    private var welcomeView: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "sparkles")
                .font(.system(size: 48))
                .foregroundStyle(Color.accentColor)
            Text("Welcome to SmartCrab")
                .font(.title2)
                .fontWeight(.semibold)
            // sakoku-ignore-next-line
            Text("Open Settings (⌘6) and add an LLM provider so the chat can route through your Claude / Copilot / pi.dev subscription.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
            Button("Continue without setup") { welcomeDismissed = true }
                .buttonStyle(.borderless)
                .padding(.top, 8)
            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var messageList: some View {
        if isLoading {
            VStack {
                Spacer()
                ProgressView("Loading conversation…")
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage {
            VStack(spacing: 8) {
                Spacer()
                Text(errorMessage).foregroundStyle(.red)
                Button("Retry") { Task { await load() } }
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if messages.isEmpty {
            VStack(spacing: 8) {
                Spacer()
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                Text("No messages yet").foregroundStyle(.secondary)
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            // `defaultScrollAnchor(.bottom)` opens at the latest message and
            // keeps the scroll glued to the bottom when new messages arrive.
            // The ScrollViewReader additionally re-pins to the bottom when the
            // composer grows to fit multiple lines (tracked via `composerHeight`)
            // so the latest message is never hidden behind it. Keying off the
            // composer height — rather than the scroll view's own height —
            // avoids yanking the user back to the bottom on window resizes while
            // they're reading history.
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(messages) { message in
                            ChatBubbleRow(message: message)
                                .id(message.id)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
                .defaultScrollAnchor(.bottom)
                .onChange(of: messages.count) { _, _ in
                    scrollToBottom(proxy)
                }
                .onChange(of: composerHeight) { _, _ in
                    scrollToBottom(proxy)
                }
            }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        guard let lastID = messages.last?.id else { return }
        withAnimation(.easeOut(duration: 0.15)) {
            proxy.scrollTo(lastID, anchor: .bottom)
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        errorMessage = nil
        do {
            messages = try await service.chatHistory()
        } catch {
            errorMessage = "Failed to load history: \(error.localizedDescription)"
        }
        // Show the welcome banner if the user hasn't configured any LLM
        // providers yet. Best-effort: if settingsLoad fails for any reason,
        // assume they're fine and don't block the chat.
        if let cfg = try? await service.settingsLoad() {
            needsProviderSetup = cfg.providers.isEmpty
        }
    }

    private func send(_ content: String) async {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // Optimistic echo so the user sees their message immediately while the
        // request is in flight. `chatSend` returns only the assistant reply.
        messages.append(ChatBubble(role: .user, content: trimmed))

        isSending = true
        defer { isSending = false }
        do {
            let reply = try await service.chatSend(trimmed)
            messages.append(reply)
        } catch {
            errorMessage = "Send failed: \(error.localizedDescription)"
        }
    }
}

#Preview("Chat") {
    NavigationStack {
        ChatView(service: StubBunService())
    }
    .environment(DraftStore())
}
