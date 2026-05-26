// BunServiceISO8601ParsingTests.swift
// Tests for BunServiceMacOS.parseISO8601(_:) — verifies that the helper can parse
// both millisecond-bearing timestamps (Bun's Date.toISOString() format) and
// plain second-precision timestamps, and returns nil for invalid input.

@testable import SmartCrab
import XCTest

#if os(macOS)
    @MainActor
    final class BunServiceISO8601ParsingTests: XCTestCase {
        // MARK: - Millisecond timestamps (server's toISOString() format)

        /// Given an ISO8601 string with milliseconds (e.g. "2026-05-26T11:15:20.123Z"),
        /// When parsed with parseISO8601,
        /// Then a non-nil Date is returned.
        func test_parseISO8601_withMillisecondTimestamp_returnsNonNilDate() {
            // Given
            let input = "2026-05-26T11:15:20.123Z"

            // When
            let result = BunServiceMacOS.parseISO8601(input)

            // Then
            XCTAssertNotNil(result, "Millisecond-bearing ISO8601 string should parse successfully")
        }

        /// Given an ISO8601 string with milliseconds,
        /// When parsed with parseISO8601,
        /// Then the returned Date matches the exact point in time encoded in the string.
        func test_parseISO8601_withMillisecondTimestamp_returnsCorrectDate() {
            // Given — known timestamp: 2026-05-26 11:15:20.123 UTC
            let input = "2026-05-26T11:15:20.123Z"
            var components = DateComponents()
            components.year = 2026
            components.month = 5
            components.day = 26
            components.hour = 11
            components.minute = 15
            components.second = 20
            components.nanosecond = 123_000_000
            components.timeZone = TimeZone(identifier: "UTC")
            let expected = Calendar(identifier: .iso8601).date(from: components)!

            // When
            let result = BunServiceMacOS.parseISO8601(input)

            // Then — allow 1 ms tolerance for floating-point rounding
            XCTAssertNotNil(result, "Millisecond-bearing ISO8601 string should parse to a valid Date")
            let tolerance = 0.001
            XCTAssertEqual(result?.timeIntervalSince1970 ?? 0,
                           expected.timeIntervalSince1970,
                           accuracy: tolerance)
        }

        /// Given an ISO8601 string with three-digit milliseconds set to zero (.000),
        /// When parsed with parseISO8601,
        /// Then a non-nil Date is returned.
        func test_parseISO8601_withZeroMilliseconds_returnsNonNilDate() {
            // Given
            let input = "2026-05-26T00:00:00.000Z"

            // When
            let result = BunServiceMacOS.parseISO8601(input)

            // Then
            XCTAssertNotNil(result)
        }

        // MARK: - Plain timestamps without milliseconds (fallback)

        /// Given a plain ISO8601 string without milliseconds (e.g. "2026-05-26T11:15:20Z"),
        /// When parsed with parseISO8601,
        /// Then a non-nil Date is returned via the fallback formatter.
        func test_parseISO8601_withPlainTimestamp_returnsNonNilDate() {
            // Given
            let input = "2026-05-26T11:15:20Z"

            // When
            let result = BunServiceMacOS.parseISO8601(input)

            // Then
            XCTAssertNotNil(result, "Plain ISO8601 string (no milliseconds) should parse via fallback")
        }

        /// Given a plain ISO8601 string without milliseconds,
        /// When parsed with parseISO8601,
        /// Then the returned Date matches the expected point in time.
        func test_parseISO8601_withPlainTimestamp_returnsCorrectDate() {
            // Given — known timestamp: 2026-05-26 11:15:20 UTC
            let input = "2026-05-26T11:15:20Z"
            let reference = ISO8601DateFormatter()
            let expected = reference.date(from: input)!

            // When
            let result = BunServiceMacOS.parseISO8601(input)

            // Then
            XCTAssertEqual(result, expected)
        }

        // MARK: - Invalid / unsupported input

        /// Given an empty string,
        /// When parsed with parseISO8601,
        /// Then nil is returned.
        func test_parseISO8601_withEmptyString_returnsNil() {
            // Given
            let input = ""

            // When
            let result = BunServiceMacOS.parseISO8601(input)

            // Then
            XCTAssertNil(result)
        }

        /// Given a completely invalid (non-date) string,
        /// When parsed with parseISO8601,
        /// Then nil is returned.
        func test_parseISO8601_withGarbageString_returnsNil() {
            // Given
            let input = "not-a-date"

            // When
            let result = BunServiceMacOS.parseISO8601(input)

            // Then
            XCTAssertNil(result)
        }

        /// Given a date-only string without a time component (not ISO8601 datetime),
        /// When parsed with parseISO8601,
        /// Then nil is returned.
        func test_parseISO8601_withDateOnlyString_returnsNil() {
            // Given
            let input = "2026-05-26"

            // When
            let result = BunServiceMacOS.parseISO8601(input)

            // Then
            XCTAssertNil(result)
        }

        // MARK: - Millisecond format is tried first

        /// Given a millisecond timestamp that the plain formatter would reject,
        /// When parsed with parseISO8601,
        /// Then the result is non-nil — proving the ms-capable formatter runs before the plain one.
        func test_parseISO8601_millisecondFormatterTriedBeforePlain() {
            // Given — a timestamp whose millisecond portion is non-zero;
            // the plain ISO8601DateFormatter() fails on this input.
            let input = "2026-01-01T00:00:00.999Z"
            let plainOnly = ISO8601DateFormatter()
            XCTAssertNil(plainOnly.date(from: input),
                         "Precondition: plain formatter must reject millisecond strings for this test to be meaningful")

            // When
            let result = BunServiceMacOS.parseISO8601(input)

            // Then
            XCTAssertNotNil(result, "parseISO8601 must succeed where the plain formatter fails")
        }
    }
#endif
