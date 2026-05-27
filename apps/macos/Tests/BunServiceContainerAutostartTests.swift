// BunServiceContainerAutostartTests.swift
// Tests for BunServiceContainer.start() auto-start behavior (macOS only).
// Verifies that chat adapters with `enabled = true` and a valid Keychain token
// are automatically started via `chatStart` when the app launches.

@testable import SmartCrab
import XCTest

// MARK: - SpyBunService

/// Full BunServiceProtocol implementation that records chatStart / adapterLoad calls
/// so tests can assert on them without touching Keychain or a real bun subprocess.
@MainActor
private final class SpyBunService: BunServiceProtocol {
    private let stub = StubBunService()

    // MARK: adapterLoad spy

    var adapterLoadStub: DiscordAdapterConfig = .init()
    var adapterLoadShouldThrow: Error?
    var adapterLoadAdapterIds: [String] = []

    // MARK: chatStart spy

    var chatStartCallCount = 0
    var chatStartAdapterIds: [String] = []
    var chatStartTokens: [String?] = []
    var chatStartShouldThrow: Error?

    // MARK: BunServiceProtocol — delegate to stub for unrelated methods

    func start() async throws {
        try await stub.start()
    }

    func stop() async {
        await stub.stop()
    }

    func ping(nonce: String) async throws -> PingResponse {
        try await stub.ping(nonce: nonce)
    }

    func settingsLoad() async throws -> SeherConfig {
        try await stub.settingsLoad()
    }

    func settingsSave(_ config: SeherConfig) async throws {
        try await stub.settingsSave(config)
    }

    func adapterSave(adapterId: String, config: DiscordAdapterConfig) async throws {
        try await stub.adapterSave(adapterId: adapterId, config: config)
    }

    func chatHistory() async throws -> [ChatBubble] {
        try await stub.chatHistory()
    }

    func chatSend(_ content: String) async throws -> ChatBubble {
        try await stub.chatSend(content)
    }

    func chatStop(adapterId: String) async throws -> Bool {
        try await stub.chatStop(adapterId: adapterId)
    }

    func chatStatus(adapterId: String) async throws -> Bool {
        try await stub.chatStatus(adapterId: adapterId)
    }

    func chatPairingList(adapterId: String) async throws -> [DiscordPairingRequest] {
        try await stub.chatPairingList(adapterId: adapterId)
    }

    func chatPairingApprove(adapterId: String, code: String) async throws -> DiscordAllowlistEntry? {
        try await stub.chatPairingApprove(adapterId: adapterId, code: code)
    }

    func chatPairingReject(adapterId: String, code: String) async throws -> Bool {
        try await stub.chatPairingReject(adapterId: adapterId, code: code)
    }

    func chatPairingAllowlist(adapterId: String) async throws -> [DiscordAllowlistEntry] {
        try await stub.chatPairingAllowlist(adapterId: adapterId)
    }

    func chatPairingAllowlistRemove(adapterId: String, senderId: String) async throws -> Bool {
        try await stub.chatPairingAllowlistRemove(adapterId: adapterId, senderId: senderId)
    }

    func pipelineList() async throws -> [PipelineSummary] {
        try await stub.pipelineList()
    }

    func pipelineGet(id: String) async throws -> PipelineDetail {
        try await stub.pipelineGet(id: id)
    }

    func pipelineSave(_ detail: PipelineDetail) async throws -> PipelineDetail {
        try await stub.pipelineSave(detail)
    }

    func pipelineValidate(yaml: String) async throws -> PipelineValidation {
        try await stub.pipelineValidate(yaml: yaml)
    }

    func pipelineExecute(id: String) async throws {
        try await stub.pipelineExecute(id: id)
    }

    func pipelineAuthor(instruction: String, currentYaml: String?) async throws -> PipelineAuthorResult {
        try await stub.pipelineAuthor(instruction: instruction, currentYaml: currentYaml)
    }

    func cronList() async throws -> [CronJob] {
        try await stub.cronList()
    }

    func cronCreate(pipelineId: String, schedule: String) async throws -> CronJob {
        try await stub.cronCreate(pipelineId: pipelineId, schedule: schedule)
    }

    func cronUpdate(id: String, schedule: String?, isActive: Bool?) async throws -> CronJob {
        try await stub.cronUpdate(id: id, schedule: schedule, isActive: isActive)
    }

    func cronDelete(id: String) async throws {
        try await stub.cronDelete(id: id)
    }

    func skillList() async throws -> [SkillInfo] {
        try await stub.skillList()
    }

    func skillAutoGenerate(pipelineId: String) async throws -> SkillInfo {
        try await stub.skillAutoGenerate(pipelineId: pipelineId)
    }

    func skillInvoke(skillId: String, input: String) async throws -> SkillInvocationResult {
        try await stub.skillInvoke(skillId: skillId, input: input)
    }

    func skillDelete(id: String) async throws {
        try await stub.skillDelete(id: id)
    }

    func executionHistory(limit: Int, offset: Int, statusFilter: String?) async throws -> [ExecutionSummary] {
        try await stub.executionHistory(limit: limit, offset: offset, statusFilter: statusFilter)
    }

    func executionDetail(id: String) async throws -> ExecutionDetail {
        try await stub.executionDetail(id: id)
    }

    // MARK: Spied methods

    func adapterLoad(adapterId: String) async throws -> DiscordAdapterConfig {
        adapterLoadAdapterIds.append(adapterId)
        if let error = adapterLoadShouldThrow { throw error }
        return adapterLoadStub
    }

    func chatStart(adapterId: String, token: String?) async throws -> Bool {
        if let error = chatStartShouldThrow { throw error }
        chatStartCallCount += 1
        chatStartAdapterIds.append(adapterId)
        chatStartTokens.append(token)
        return true
    }
}

// MARK: - BunServiceContainerAutostartTests

@MainActor
final class BunServiceContainerAutostartTests: XCTestCase {
    // MARK: Happy path

    /// Given an enabled adapter and a valid Keychain token,
    /// When the app starts,
    /// Then chatStart is called once with the adapter ID and trimmed token.
    func test_start_whenAdapterEnabledAndTokenPresent_callsChatStart() async {
        // Given
        let spy = SpyBunService()
        spy.adapterLoadStub = DiscordAdapterConfig(enabled: true)
        let container = BunServiceContainer(service: spy, keychainProvider: { "bot-token-123" })

        // When
        await container.start()

        // Then
        XCTAssertEqual(spy.chatStartCallCount, 1)
        XCTAssertEqual(spy.chatStartAdapterIds, ["discord"])
        XCTAssertEqual(spy.chatStartTokens.first ?? nil, "bot-token-123")
    }

    /// Given an enabled adapter and a valid Keychain token with surrounding whitespace,
    /// When the app starts,
    /// Then chatStart receives the trimmed token.
    func test_start_passesTrimmmedTokenToChatStart() async {
        // Given
        let spy = SpyBunService()
        spy.adapterLoadStub = DiscordAdapterConfig(enabled: true)
        let container = BunServiceContainer(service: spy, keychainProvider: { "  tok456  \n" })

        // When
        await container.start()

        // Then
        XCTAssertEqual(spy.chatStartTokens.first ?? nil, "tok456")
    }

    /// Given a disabled adapter,
    /// When the app starts,
    /// Then chatStart is never called.
    func test_start_whenAdapterDisabled_doesNotCallChatStart() async {
        // Given
        let spy = SpyBunService()
        spy.adapterLoadStub = DiscordAdapterConfig(enabled: false)
        let container = BunServiceContainer(service: spy, keychainProvider: { "bot-token-123" })

        // When
        await container.start()

        // Then
        XCTAssertEqual(spy.chatStartCallCount, 0)
    }

    // MARK: Missing or empty token

    /// Given an enabled adapter and no Keychain entry (nil),
    /// When the app starts,
    /// Then chatStart is not called (no token means the adapter cannot start).
    func test_start_whenKeychainReturnsNil_doesNotCallChatStart() async {
        // Given
        let spy = SpyBunService()
        spy.adapterLoadStub = DiscordAdapterConfig(enabled: true)
        let container = BunServiceContainer(service: spy, keychainProvider: { nil })

        // When
        await container.start()

        // Then
        XCTAssertEqual(spy.chatStartCallCount, 0)
    }

    /// Given an enabled adapter and an empty Keychain entry,
    /// When the app starts,
    /// Then chatStart is not called.
    func test_start_whenKeychainReturnsEmptyString_doesNotCallChatStart() async {
        // Given
        let spy = SpyBunService()
        spy.adapterLoadStub = DiscordAdapterConfig(enabled: true)
        let container = BunServiceContainer(service: spy, keychainProvider: { "" })

        // When
        await container.start()

        // Then
        XCTAssertEqual(spy.chatStartCallCount, 0)
    }

    /// Given an enabled adapter and a whitespace-only Keychain entry,
    /// When the app starts,
    /// Then chatStart is not called (trimmed result is empty).
    func test_start_whenKeychainReturnsWhitespaceOnly_doesNotCallChatStart() async {
        // Given
        let spy = SpyBunService()
        spy.adapterLoadStub = DiscordAdapterConfig(enabled: true)
        let container = BunServiceContainer(service: spy, keychainProvider: { "   \t\n  " })

        // When
        await container.start()

        // Then
        XCTAssertEqual(spy.chatStartCallCount, 0)
    }

    // MARK: Error resilience

    /// Given that adapterLoad throws,
    /// When the app starts,
    /// Then chatStart is never called and the app does not crash.
    func test_start_whenAdapterLoadThrows_doesNotCallChatStart_andDoesNotCrash() async {
        // Given
        enum TestError: Error { case stubFailure }
        let spy = SpyBunService()
        spy.adapterLoadShouldThrow = TestError.stubFailure
        let container = BunServiceContainer(service: spy, keychainProvider: { "bot-token-123" })

        // When — must not crash or propagate
        await container.start()

        // Then
        XCTAssertEqual(spy.chatStartCallCount, 0)
    }

    /// Given that the Keychain lookup throws,
    /// When the app starts,
    /// Then chatStart is never called and the app does not crash.
    func test_start_whenKeychainThrows_doesNotCallChatStart_andDoesNotCrash() async {
        // Given
        enum TestError: Error { case keychainFailure }
        let spy = SpyBunService()
        spy.adapterLoadStub = DiscordAdapterConfig(enabled: true)
        let container = BunServiceContainer(service: spy, keychainProvider: { throw TestError.keychainFailure })

        // When
        await container.start()

        // Then
        XCTAssertEqual(spy.chatStartCallCount, 0)
    }

    /// Given that chatStart throws (e.g., Discord auth rejected),
    /// When the app starts,
    /// Then the container does not crash or propagate the error.
    func test_start_whenChatStartThrows_doesNotCrash() async {
        // Given
        enum TestError: Error { case discordAuthFailed }
        let spy = SpyBunService()
        spy.adapterLoadStub = DiscordAdapterConfig(enabled: true)
        spy.chatStartShouldThrow = TestError.discordAuthFailed
        let container = BunServiceContainer(service: spy, keychainProvider: { "bot-token-123" })

        // When — must survive without crashing
        await container.start()

        // No assertion: the test passes if execution reaches here.
    }

    // MARK: Adapter ID

    /// Given a standard start,
    /// When the app starts,
    /// Then adapterLoad is called with the well-known "discord" adapter ID.
    func test_start_callsAdapterLoadWithDiscordId() async {
        // Given
        let spy = SpyBunService()
        spy.adapterLoadStub = DiscordAdapterConfig(enabled: false)
        let container = BunServiceContainer(service: spy, keychainProvider: { nil })

        // When
        await container.start()

        // Then
        XCTAssertEqual(spy.adapterLoadAdapterIds, ["discord"])
    }
}
