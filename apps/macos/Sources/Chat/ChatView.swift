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
    @AppStorage("smartcrab.welcomeDismissed") private var welcomeDismissed: Bool = false

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
        VStack(spacing: 0) {
            messageList
            Divider()
            ChatComposer(isSending: isSending) { content in
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
            Text("Open Settings (⌘6) and add an LLM provider so the chat can route through your Claude / Kimi / Copilot subscription.")
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
                .onChange(of: messages.last?.id) { _, newId in
                    guard let newId else { return }
                    withAnimation { proxy.scrollTo(newId, anchor: .bottom) }
                }
                .onAppear {
                    if let lastId = messages.last?.id {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    }
                }
            }
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
}
