// SettingsView.swift
//
// Top-level Settings container. Renders the seher LLM routing editor, the
// chat adapter (Discord) editor, and a Logs viewer for bun-service stderr.
// All state is loaded/saved via `BunServiceProtocol`; the iOS Simulator
// preview target uses `BunServiceMock`.

import SwiftUI

// MARK: - SettingsView ----------------------------------------------------------

public struct SettingsView: View {
    public enum Tab: String, CaseIterable, Identifiable {
        case seher = "LLM routing"
        case adapters = "Chat adapters"
        case logs = "Logs"

        public var id: String {
            rawValue
        }
    }

    private let service: BunServiceProtocol
    @State private var selection: Tab = .seher

    public init(service: BunServiceProtocol) {
        self.service = service
    }

    public var body: some View {
        VStack(spacing: 0) {
            Picker("Section", selection: $selection) {
                ForEach(Tab.allCases) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(maxWidth: 360)
            .padding(.horizontal)
            .padding(.top, 12)
            .padding(.bottom, 8)

            Divider()

            switch selection {
            case .seher:
                SeherConfigEditor(service: service)
            case .adapters:
                AdapterSettings(service: service)
            case .logs:
                LogsView()
            }
        }
        .navigationTitle("Settings")
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

// MARK: - LogsView -------------------------------------------------------------

/// Tail of `SmartCrabPaths.bunServiceLog` (~/Library/Logs/SmartCrab/...) —
/// populated by `BunServiceMacOS` which tees the bun-service stderr to that
/// file. Polled every 1s while the tab is visible. We deliberately read only
/// the trailing chunk so a runaway log doesn't blow up the view, and skip the
/// read entirely when (size, mtime) match the previous poll.
private struct LogsView: View {
    private static let maxBytesToShow: Int = 200 * 1024

    @State private var content: String = ""
    @State private var lastError: String?
    @State private var lastSize: Int = -1
    @State private var lastMtime: Date?

    private var logURL: URL {
        SmartCrabPaths.bunServiceLog
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(logURL.path)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                Button("Reload") { reload(force: true) }
                Button("Clear file") { clearFile() }
                #if os(macOS)
                    Button("Reveal in Finder") {
                        NSWorkspace.shared.activateFileViewerSelecting([logURL])
                    }
                #endif
            }
            .padding(.horizontal)

            if let lastError {
                Text(lastError)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.horizontal)
            }

            ScrollViewReader { proxy in
                ScrollView {
                    Text(content.isEmpty ? "(no logs yet)" : content)
                        .font(.system(.caption, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                        .padding(8)
                        .id("logs-bottom-anchor")
                }
                .onChange(of: content) { _, _ in
                    proxy.scrollTo("logs-bottom-anchor", anchor: .bottom)
                }
            }
        }
        .onAppear { reload(force: true) }
        .task(id: "logs-poll") {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                reload(force: false)
            }
        }
    }

    private func reload(force: Bool) {
        do {
            let attrs = try FileManager.default.attributesOfItem(atPath: logURL.path)
            let size = (attrs[.size] as? NSNumber)?.intValue ?? 0
            let mtime = attrs[.modificationDate] as? Date
            if !force, size == lastSize, mtime == lastMtime {
                return
            }

            let handle = try FileHandle(forReadingFrom: logURL)
            defer { try? handle.close() }
            if size > Self.maxBytesToShow {
                try handle.seek(toOffset: UInt64(size - Self.maxBytesToShow))
            }
            let data = try handle.readToEnd() ?? Data()
            let text = String(data: data, encoding: .utf8) ?? "(non-utf8 log content)"
            content = size > Self.maxBytesToShow
                ? "… (truncated; showing last \(Self.maxBytesToShow / 1024) KB)\n" + text
                : text
            lastSize = size
            lastMtime = mtime
            lastError = nil
        } catch CocoaError.fileReadNoSuchFile {
            content = ""
            lastSize = 0
            lastMtime = nil
            lastError = nil
        } catch {
            lastError = "Log read error: \(error.localizedDescription)"
        }
    }

    private func clearFile() {
        do {
            try Data().write(to: logURL)
            reload(force: true)
        } catch {
            lastError = "Clear failed: \(error.localizedDescription)"
        }
    }
}

#Preview("Settings") {
    NavigationStack {
        SettingsView(service: StubBunService())
    }
}
