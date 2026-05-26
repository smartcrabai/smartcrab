// SidebarTabTests.swift
// Tests for SidebarTab enum — display labels, SF Symbol names,
// shortcut numbers, and ordering that the sidebar and Cmd+1..6 depend on.

import AppKit
@testable import SmartCrab
import SwiftUI
import XCTest

final class SidebarTabTests: XCTestCase {
    // MARK: allCases

    /// Given the SidebarTab enum,
    /// When listing all cases,
    /// Then there are exactly 6 tabs in the declared order.
    func test_allCases_hasExactlySixTabsInOrder() {
        let expected: [SidebarTab] = [.chat, .pipelines, .cron, .skills, .history, .settings]
        XCTAssertEqual(SidebarTab.allCases, expected)
    }

    // MARK: rawValue (display label)

    /// Given each SidebarTab case,
    /// When reading rawValue,
    /// Then it returns the expected display label shown in the sidebar.
    func test_rawValue_matchesExpectedDisplayLabels() {
        XCTAssertEqual(SidebarTab.chat.rawValue, "Chat")
        XCTAssertEqual(SidebarTab.pipelines.rawValue, "Pipelines")
        XCTAssertEqual(SidebarTab.cron.rawValue, "Cron")
        XCTAssertEqual(SidebarTab.skills.rawValue, "Skills")
        XCTAssertEqual(SidebarTab.history.rawValue, "History")
        XCTAssertEqual(SidebarTab.settings.rawValue, "Settings")
    }

    // MARK: Identifiable

    /// Given each SidebarTab case,
    /// When reading id,
    /// Then it equals rawValue (Identifiable contract).
    func test_id_equalsRawValue() {
        for tab in SidebarTab.allCases {
            XCTAssertEqual(tab.id, tab.rawValue, "id mismatch for \(tab)")
        }
    }

    // MARK: systemImage

    /// Given each SidebarTab case,
    /// When reading systemImage,
    /// Then it returns a non-empty string that resolves to a real SF Symbol.
    /// NSImage returns nil for unknown symbol names, catching typos that a
    /// non-empty check would miss.
    func test_systemImage_isValidSFSymbolForAllTabs() {
        for tab in SidebarTab.allCases {
            XCTAssertFalse(tab.systemImage.isEmpty, "systemImage is empty for \(tab)")
            let image = NSImage(systemSymbolName: tab.systemImage, accessibilityDescription: nil)
            XCTAssertNotNil(image, "'\(tab.systemImage)' is not a valid SF Symbol for \(tab)")
        }
    }

    // MARK: shortcutNumber (Cmd+1..6)

    /// Given each SidebarTab case,
    /// When reading shortcutNumber,
    /// Then it returns a 1-based index matching allCases order.
    /// shortcutNumber drives the Cmd+1..6 keyboard shortcuts in AppRoot;
    /// a mismatch would silently mis-map a shortcut after case reordering.
    func test_shortcutNumber_isOneBased_matchingAllCasesOrder() {
        for (index, tab) in SidebarTab.allCases.enumerated() {
            XCTAssertEqual(tab.shortcutNumber, index + 1,
                           "shortcutNumber mismatch for \(tab) at index \(index)")
        }
    }

    /// Given all cases,
    /// When reading shortcutNumbers,
    /// Then all values are distinct — no two tabs share a Cmd+N shortcut.
    func test_shortcutNumber_allValuesAreDistinct() {
        let numbers = SidebarTab.allCases.map { $0.shortcutNumber }
        XCTAssertEqual(numbers.count, Set(numbers).count,
                       "Duplicate shortcutNumbers found: \(numbers)")
    }

    // MARK: shortcutKey (KeyEquivalent)

    /// Given each SidebarTab case,
    /// When reading shortcutKey,
    /// Then it is a single-digit character matching shortcutNumber.
    func test_shortcutKey_isSingleDigitMatchingShortcutNumber() {
        for tab in SidebarTab.allCases {
            let n = tab.shortcutNumber
            XCTAssertEqual(tab.shortcutKey, KeyEquivalent(Character(String(n))),
                           "shortcutKey mismatch for \(tab)")
        }
    }
}
