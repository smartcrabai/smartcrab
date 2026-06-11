// ReadableWidth.swift
//
// Shared layout helper that keeps content columns readable on wide windows.
// Full-bleed lists, forms, and chat transcripts stretch edge-to-edge on a
// 1500pt+ window, which makes rows look sparse and lines too long to read.
// Wrapping them in `readableWidth()` caps the content width and centers it.

import SwiftUI

extension View {
    /// Caps the view to a readable column width and centers it horizontally.
    /// The view still fills all the available width up to the cap.
    func readableWidth() -> some View {
        frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
    }
}
