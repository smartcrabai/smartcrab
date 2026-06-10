// ChatComposer.swift
//
// Multiline composer pinned at the bottom of the Chat view. Return inserts a
// newline; Cmd+Return (macOS) or the send button submit. On macOS the text
// input wraps an AppKit NSTextView directly (via `MultilineTextField`) because
// SwiftUI's TextField/TextEditor do not reliably route a plain Return to a
// newline there; on other platforms it falls back to a SwiftUI TextEditor.
// The send action is delivered via an async closure so the parent can show a
// spinner and block re-entry while a request is in flight. The draft text is
// owned by the parent (via a binding) so it survives this view being torn
// down, e.g. when the user navigates to another tab and back.

import SwiftUI
#if canImport(AppKit)
    import AppKit
#endif

public struct ChatComposer: View {
    public typealias SendAction = (_ content: String) async -> Void

    private let isSending: Bool
    private let onHeightChange: ((CGFloat) -> Void)?
    private let onSend: SendAction

    @Binding private var draft: String

    // Approximate line height used to grow the editor up to `maxVisibleLines`.
    private let lineHeight: CGFloat = 18
    private let maxVisibleLines = 6

    public init(
        draft: Binding<String>,
        isSending: Bool,
        onHeightChange: ((CGFloat) -> Void)? = nil,
        onSend: @escaping SendAction
    ) {
        _draft = draft
        self.isSending = isSending
        self.onHeightChange = onHeightChange
        self.onSend = onSend
    }

    public var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            ZStack(alignment: .topLeading) {
                if draft.isEmpty {
                    Text("Message")
                        .foregroundStyle(.tertiary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 7)
                        .allowsHitTesting(false)
                }
                MultilineTextField(text: $draft, isEnabled: !isSending, onSubmit: submit)
                    .frame(height: editorHeight)
                    .onChange(of: editorHeight) { _, newValue in
                        onHeightChange?(newValue)
                    }
            }
            .background(.background)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .strokeBorder(.quaternary)
            )

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

    private var editorHeight: CGFloat {
        let newlines = draft.reduce(into: 1) { count, ch in
            if ch == "\n" { count += 1 }
        }
        let lines = min(max(newlines, 1), maxVisibleLines)
        return CGFloat(lines) * lineHeight + 14
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

#if canImport(AppKit)

    /// An AppKit-backed multiline text input. A plain Return inserts a newline;
    /// Cmd+Return invokes `onSubmit` (so it can be wired to the send action).
    private struct MultilineTextField: NSViewRepresentable {
        @Binding var text: String
        var isEnabled: Bool
        var onSubmit: () -> Void

        func makeCoordinator() -> Coordinator {
            Coordinator(text: $text)
        }

        func makeNSView(context: Context) -> NSScrollView {
            let scrollView = NSScrollView()
            scrollView.borderType = .noBorder
            scrollView.hasVerticalScroller = true
            scrollView.drawsBackground = false
            scrollView.autohidesScrollers = true

            let textView = ComposerTextView()
            textView.delegate = context.coordinator
            textView.isRichText = false
            textView.drawsBackground = false
            textView.allowsUndo = true
            textView.font = .preferredFont(forTextStyle: .body)
            textView.textContainerInset = NSSize(width: 4, height: 5)
            textView.isAutomaticQuoteSubstitutionEnabled = false
            textView.isAutomaticDashSubstitutionEnabled = false
            textView.isAutomaticSpellingCorrectionEnabled = false

            textView.minSize = NSSize(width: 0, height: 0)
            textView.maxSize = NSSize(
                width: CGFloat.greatestFiniteMagnitude,
                height: CGFloat.greatestFiniteMagnitude
            )
            textView.isVerticallyResizable = true
            textView.isHorizontallyResizable = false
            textView.autoresizingMask = [.width]
            textView.textContainer?.widthTracksTextView = true
            textView.textContainer?.containerSize = NSSize(
                width: scrollView.contentSize.width,
                height: CGFloat.greatestFiniteMagnitude
            )

            scrollView.documentView = textView
            return scrollView
        }

        func updateNSView(_ scrollView: NSScrollView, context _: Context) {
            guard let textView = scrollView.documentView as? ComposerTextView else { return }
            if textView.string != text {
                textView.string = text
            }
            textView.isEditable = isEnabled
            textView.isSelectable = isEnabled
            // Keep the closure fresh so the latest `draft`/state is captured.
            textView.onCommandReturn = onSubmit
        }

        final class Coordinator: NSObject, NSTextViewDelegate {
            @Binding var text: String

            init(text: Binding<String>) {
                _text = text
            }

            func textDidChange(_ notification: Notification) {
                guard let textView = notification.object as? NSTextView else { return }
                text = textView.string
            }
        }
    }

    /// NSTextView subclass that intercepts Cmd+Return to submit, leaving a plain
    /// Return to fall through to the default newline insertion.
    private final class ComposerTextView: NSTextView {
        var onCommandReturn: (() -> Void)?

        override func keyDown(with event: NSEvent) {
            // keyCode 36 = Return, 76 = numpad Enter.
            if event.keyCode == 36 || event.keyCode == 76,
               event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command
            {
                onCommandReturn?()
                return
            }
            super.keyDown(with: event)
        }
    }

#else

    /// SwiftUI fallback for platforms without AppKit (iOS). The system text editor
    /// already inserts a newline on Return there; Cmd+Return submission is handled
    /// by the send button's keyboard shortcut. `onSubmit` is unused on this path.
    private struct MultilineTextField: View {
        @Binding var text: String
        var isEnabled: Bool
        var onSubmit: () -> Void

        var body: some View {
            TextEditor(text: $text)
                .font(.body)
                .scrollContentBackground(.hidden)
                .disabled(!isEnabled)
        }
    }

#endif

#Preview("ChatComposer idle") {
    @Previewable @State var draft = ""
    ChatComposer(draft: $draft, isSending: false) { _ in }
        .padding()
}

#Preview("ChatComposer sending") {
    @Previewable @State var draft = ""
    ChatComposer(draft: $draft, isSending: true) { _ in }
        .padding()
}
