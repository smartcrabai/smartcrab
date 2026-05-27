import SwiftUI

#if canImport(AppKit)
    import AppKit
#endif

/// YAML text editor used in the right pane of `PipelineAuthoringView`.
///
/// SwiftUI's `TextEditor` doesn't paint coloured runs, so we use an
/// `NSTextView`/`UITextView` wrapper and recolour spans whenever the text
/// changes. The tokenizer is intentionally tiny — enough to distinguish
/// keys, scalar values, comments, strings, and numbers; YAML's edge cases
/// (anchors, multiline literals) fall back to plain text.
public struct PipelineYamlView: View {
    @Binding var text: String
    public let isDisabled: Bool
    public let onSave: () -> Void

    public init(text: Binding<String>, isDisabled: Bool = false, onSave: @escaping () -> Void) {
        _text = text
        self.isDisabled = isDisabled
        self.onSave = onSave
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("YAML").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button {
                    onSave()
                } label: {
                    Label("Save", systemImage: "tray.and.arrow.down")
                }
                .disabled(isDisabled)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            Divider()
            YamlSyntaxTextView(text: $text, isEditable: !isDisabled)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

// MARK: - Tokenizer

enum YamlTokenKind {
    case key
    case string
    case number
    case comment
    case structural // `:`, `-`, `[`, `]`, `{`, `}`
    case scalar
}

struct YamlToken {
    let range: Range<String.Index>
    let kind: YamlTokenKind
}

/// Line-based YAML tokenizer. Good enough for syntax-colouring; not a parser.
enum YamlSyntaxTokenizer {
    static func tokenize(_ source: String) -> [YamlToken] {
        var tokens: [YamlToken] = []
        var lineStart = source.startIndex
        while lineStart < source.endIndex {
            let lineEnd = source[lineStart...].firstIndex(of: "\n") ?? source.endIndex
            tokenizeLine(source, lineRange: lineStart ..< lineEnd, into: &tokens)
            if lineEnd == source.endIndex { break }
            lineStart = source.index(after: lineEnd)
        }
        return tokens
    }

    private static func tokenizeLine(
        _ source: String,
        lineRange: Range<String.Index>,
        into tokens: inout [YamlToken]
    ) {
        // Skip leading whitespace.
        var cursor = lineRange.lowerBound
        while cursor < lineRange.upperBound, source[cursor].isWhitespace {
            cursor = source.index(after: cursor)
        }
        if cursor == lineRange.upperBound { return }

        // Comment line / trailing comment.
        if source[cursor] == "#" {
            tokens.append(YamlToken(range: cursor ..< lineRange.upperBound, kind: .comment))
            return
        }

        // Bullet for list item.
        if source[cursor] == "-" {
            let next = source.index(after: cursor)
            // Only colour as structural if followed by whitespace or EOL.
            if next == lineRange.upperBound || source[next].isWhitespace {
                tokens.append(YamlToken(range: cursor ..< next, kind: .structural))
                cursor = next
                while cursor < lineRange.upperBound, source[cursor].isWhitespace {
                    cursor = source.index(after: cursor)
                }
                if cursor == lineRange.upperBound { return }
            }
        }

        // Look for `key:` pattern.
        if let colon = findColon(source, range: cursor ..< lineRange.upperBound) {
            let keyRange = cursor ..< colon
            if !keyRange.isEmpty {
                tokens.append(YamlToken(range: keyRange, kind: .key))
            }
            tokens.append(YamlToken(range: colon ..< source.index(after: colon), kind: .structural))
            cursor = source.index(after: colon)
            while cursor < lineRange.upperBound, source[cursor].isWhitespace {
                cursor = source.index(after: cursor)
            }
        }

        // Trailing comment within line?
        if let hashIdx = source[cursor ..< lineRange.upperBound].firstIndex(of: "#") {
            tokenizeValue(source, range: cursor ..< hashIdx, into: &tokens)
            tokens.append(YamlToken(range: hashIdx ..< lineRange.upperBound, kind: .comment))
            return
        }

        tokenizeValue(source, range: cursor ..< lineRange.upperBound, into: &tokens)
    }

    /// Find a `:` that terminates a key (followed by space/end-of-line).
    private static func findColon(_ source: String, range: Range<String.Index>) -> String.Index? {
        var i = range.lowerBound
        var insideQuote: Character? = nil
        while i < range.upperBound {
            let ch = source[i]
            if let q = insideQuote {
                if ch == q { insideQuote = nil }
            } else if ch == "\"" || ch == "'" {
                insideQuote = ch
            } else if ch == ":" {
                let next = source.index(after: i)
                if next == range.upperBound || source[next].isWhitespace {
                    return i
                }
            }
            i = source.index(after: i)
        }
        return nil
    }

    private static func tokenizeValue(
        _ source: String,
        range: Range<String.Index>,
        into tokens: inout [YamlToken]
    ) {
        let trimmedStart = trimLeadingWhitespace(source, range: range)
        if trimmedStart >= range.upperBound { return }
        let value = source[trimmedStart ..< range.upperBound]
        if value.isEmpty { return }

        let first = source[trimmedStart]
        if first == "\"" || first == "'" {
            tokens.append(YamlToken(range: trimmedStart ..< range.upperBound, kind: .string))
            return
        }
        if isNumeric(String(value)) {
            tokens.append(YamlToken(range: trimmedStart ..< range.upperBound, kind: .number))
            return
        }
        tokens.append(YamlToken(range: trimmedStart ..< range.upperBound, kind: .scalar))
    }

    private static func trimLeadingWhitespace(_ source: String, range: Range<String.Index>) -> String.Index {
        var i = range.lowerBound
        while i < range.upperBound, source[i].isWhitespace {
            i = source.index(after: i)
        }
        return i
    }

    private static func isNumeric(_ s: String) -> Bool {
        let trimmed = s.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return false }
        return Double(trimmed) != nil
    }
}

// MARK: - Coloured text view bridge

#if canImport(AppKit)
    struct YamlSyntaxTextView: NSViewRepresentable {
        @Binding var text: String
        let isEditable: Bool

        func makeCoordinator() -> Coordinator {
            Coordinator(self)
        }

        func makeNSView(context: Context) -> NSScrollView {
            let scroll = NSTextView.scrollableTextView()
            let textView = scroll.documentView as! NSTextView
            textView.delegate = context.coordinator
            textView.isEditable = isEditable
            textView.isRichText = false
            textView.autoresizingMask = [.width]
            textView.allowsUndo = true
            textView.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
            textView.textColor = .labelColor
            textView.backgroundColor = NSColor(white: 0.08, alpha: 1.0)
            textView.drawsBackground = true
            textView.insertionPointColor = .white
            textView.string = text
            context.coordinator.recolour(textView)
            return scroll
        }

        func updateNSView(_ scroll: NSScrollView, context: Context) {
            guard let textView = scroll.documentView as? NSTextView else { return }
            if textView.string != text {
                let selectedRanges = textView.selectedRanges
                textView.string = text
                textView.selectedRanges = selectedRanges
                context.coordinator.recolour(textView)
            }
            textView.isEditable = isEditable
        }

        final class Coordinator: NSObject, NSTextViewDelegate {
            var parent: YamlSyntaxTextView
            init(_ parent: YamlSyntaxTextView) {
                self.parent = parent
            }

            func textDidChange(_ notification: Notification) {
                guard let textView = notification.object as? NSTextView else { return }
                parent.text = textView.string
                recolour(textView)
            }

            func recolour(_ textView: NSTextView) {
                let source = textView.string
                let storage = textView.textStorage
                let full = NSRange(location: 0, length: (source as NSString).length)
                storage?.beginEditing()
                storage?.setAttributes([
                    .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .regular),
                    .foregroundColor: NSColor.labelColor,
                ], range: full)
                for token in YamlSyntaxTokenizer.tokenize(source) {
                    let nsRange = NSRange(token.range, in: source)
                    storage?.setAttributes([
                        .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .regular),
                        .foregroundColor: colour(for: token.kind),
                    ], range: nsRange)
                }
                storage?.endEditing()
            }

            private func colour(for kind: YamlTokenKind) -> NSColor {
                switch kind {
                case .key: return NSColor.systemTeal
                case .string: return NSColor.systemOrange
                case .number: return NSColor.systemPurple
                case .comment: return NSColor.gray
                case .structural: return NSColor.systemGray
                case .scalar: return NSColor.labelColor
                }
            }
        }
    }
#else
    /// iOS / preview fallback: monospaced TextEditor without colour spans.
    struct YamlSyntaxTextView: View {
        @Binding var text: String
        let isEditable: Bool
        var body: some View {
            TextEditor(text: $text)
                .font(.system(.body, design: .monospaced))
                .disabled(!isEditable)
                .padding(8)
        }
    }
#endif

#Preview {
    @Previewable @State var text = """
    name: example
    description: hello
    version: "1.0"
    trigger:
      type: cron
      schedule: "0 9 * * *"
    nodes:
      - id: start
        name: Start
        action:
          type: llm_call
          provider: anthropic
          prompt: "summarise"
          timeout_secs: 30
    """
    return PipelineYamlView(text: $text) {}
        .frame(width: 480, height: 320)
}
