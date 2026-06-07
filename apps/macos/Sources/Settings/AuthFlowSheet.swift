// AuthFlowSheet.swift
//
// Modal sheet driving a provider sign-in via the auth RPC commands
// (`auth.start` / `auth.status` / `auth.cancel`, backed by `seher-bridge auth`):
//   - device-code flow (GitHub Copilot): show the user code prominently, open
//     the verification page, poll until the user authorizes.
//   - browser flow (OpenAI Codex / ChatGPT): open the authorize URL; the
//     bridge's localhost callback completes the exchange; poll until done.
// Credentials land in pi's auth.json, so no key ever enters the GUI.

import SwiftUI

struct AuthFlowSheet: View {
    /// GUI provider kind: "copilot" | "openai-codex".
    let kind: String
    let service: BunServiceProtocol
    /// Invoked once after a successful sign-in (refresh credential badges).
    let onSuccess: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    private enum Phase: Equatable {
        case starting
        case waiting
        case done
        case failed(String)
    }

    @State private var phase: Phase = .starting
    @State private var start: AuthStartResult?
    @State private var pollTask: Task<Void, Never>?

    private static let pollInterval: Duration = .seconds(2)

    private var title: String {
        kind == "openai-codex" ? "Sign in to OpenAI Codex (ChatGPT)" : "Sign in to GitHub Copilot"
    }

    var body: some View {
        VStack(spacing: 16) {
            Text(title).font(.headline)

            switch phase {
            case .starting:
                ProgressView("Contacting the provider…")

            case .waiting:
                waitingBody

            case .done:
                Label("Signed in", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)

            case let .failed(message):
                VStack(spacing: 8) {
                    Label("Sign-in failed", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }

            HStack {
                if case .failed = phase {
                    Button("Retry") { restart() }
                }
                Button(phase == .done ? "Close" : "Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)
            }
        }
        .padding(24)
        .frame(minWidth: 380)
        .task { await begin() }
        .onDisappear {
            pollTask?.cancel()
            // A sheet dismissed mid-flow abandons the login: tell the service
            // to kill the bridge process (best-effort).
            if phase == .waiting || phase == .starting, let sessionId = start?.sessionId {
                let service = self.service
                Task { try? await service.authCancel(sessionId: sessionId) }
            }
        }
    }

    @ViewBuilder
    private var waitingBody: some View {
        if let start, start.flow == .deviceCode {
            VStack(spacing: 12) {
                Text("Enter this code on the verification page:")
                    .font(.callout)
                Text(start.userCode ?? "—")
                    .font(.system(size: 28, weight: .bold, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                Button {
                    if let uri = start.verificationUriComplete ?? start.verificationUri,
                       let url = URL(string: uri)
                    {
                        openURL(url)
                    }
                } label: {
                    Label("Open verification page", systemImage: "safari")
                }
                .buttonStyle(.borderedProminent)
            }
        } else {
            VStack(spacing: 12) {
                Text("Finish signing in from your browser. This window updates automatically.")
                    .font(.callout)
                    .multilineTextAlignment(.center)
                Button {
                    if let urlString = start?.url, let url = URL(string: urlString) {
                        openURL(url)
                    }
                } label: {
                    Label("Continue in browser", systemImage: "safari")
                }
                .buttonStyle(.borderedProminent)
            }
        }
        HStack(spacing: 6) {
            ProgressView().controlSize(.small)
            Text("Waiting for authorization…")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func restart() {
        pollTask?.cancel()
        start = nil
        phase = .starting
        Task { await begin() }
    }

    private func begin() async {
        do {
            let result = try await service.authStart(kind: kind)
            start = result
            phase = .waiting
            // Browser flow: open immediately — the redirect only works while
            // the bridge's callback server is listening.
            if result.flow == .browser, let urlString = result.url, let url = URL(string: urlString) {
                openURL(url)
            }
            poll(sessionId: result.sessionId)
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func poll(sessionId: String) {
        pollTask?.cancel()
        pollTask = Task { @MainActor in
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: Self.pollInterval)
                } catch {
                    return
                }
                do {
                    let status = try await service.authStatus(sessionId: sessionId)
                    switch status.state {
                    case .pending:
                        continue
                    case .done:
                        phase = .done
                        onSuccess()
                        return
                    case .error:
                        phase = .failed(status.message ?? "Sign-in failed.")
                        return
                    }
                } catch {
                    phase = .failed(error.localizedDescription)
                    return
                }
            }
        }
    }
}

#Preview("AuthFlowSheet (device code)") {
    AuthFlowSheet(kind: "copilot", service: StubBunService()) {}
}

#Preview("AuthFlowSheet (browser)") {
    AuthFlowSheet(kind: "openai-codex", service: StubBunService()) {}
}
