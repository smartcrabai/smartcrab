import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DownloadEvent } from '@tauri-apps/plugin-updater';
import { useAppUpdater } from './useAppUpdater';

// --- Tauri plugin mocks ---

const { mockDownloadAndInstall, mockRelaunch, mockCheck } = vi.hoisted(() => ({
  mockDownloadAndInstall: vi.fn(),
  mockRelaunch: vi.fn(),
  mockCheck: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mockCheck,
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: mockRelaunch,
}));

// --- helpers ---

function makeUpdateObject(version = '1.0.0', body = 'Release notes') {
  return {
    version,
    body,
    downloadAndInstall: mockDownloadAndInstall,
  };
}

// --- tests ---

describe('useAppUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DEV', true); // prevent auto-check from interfering with explicit test calls
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ----------------------------------------------------------------
  // Initial state
  // ----------------------------------------------------------------

  describe('initial state', () => {
    it('should start in idle status', () => {
      // Given: a fresh hook with no prior checks
      // When: the hook renders
      const { result } = renderHook(() => useAppUpdater());
      // Then: status is idle
      expect(result.current.status).toBe('idle');
    });

    it('should have null availableVersion initially', () => {
      const { result } = renderHook(() => useAppUpdater());
      expect(result.current.availableVersion).toBeNull();
    });

    it('should have null notes initially', () => {
      const { result } = renderHook(() => useAppUpdater());
      expect(result.current.notes).toBeNull();
    });

    it('should have null error initially', () => {
      const { result } = renderHook(() => useAppUpdater());
      expect(result.current.error).toBeNull();
    });

    it('should have zero downloadedBytes initially', () => {
      const { result } = renderHook(() => useAppUpdater());
      expect(result.current.downloadedBytes).toBe(0);
    });

    it('should have null contentLength initially', () => {
      const { result } = renderHook(() => useAppUpdater());
      expect(result.current.contentLength).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // checkForUpdates()
  // ----------------------------------------------------------------

  describe('checkForUpdates()', () => {
    it('should transition to checking while the check is in progress', async () => {
      // Given: check() never settles (hangs)
      let resolve!: (v: null) => void;
      mockCheck.mockReturnValue(new Promise((r) => { resolve = r; }));

      const { result } = renderHook(() => useAppUpdater());

      // When: checkForUpdates() is called
      act(() => { void result.current.checkForUpdates(); });

      // Then: status is checking
      expect(result.current.status).toBe('checking');

      // cleanup
      resolve(null);
    });

    it('should transition to available when an update is found', async () => {
      // Given: check() resolves with an update object
      mockCheck.mockResolvedValue(makeUpdateObject('1.2.3', 'What is new'));

      const { result } = renderHook(() => useAppUpdater());

      // When: checkForUpdates() completes
      await act(async () => { await result.current.checkForUpdates(); });

      // Then: status is available and version/notes are populated
      expect(result.current.status).toBe('available');
      expect(result.current.availableVersion).toBe('1.2.3');
      expect(result.current.notes).toBe('What is new');
    });

    it('should transition to upToDate when no update is found', async () => {
      // Given: check() returns null (no update)
      mockCheck.mockResolvedValue(null);

      const { result } = renderHook(() => useAppUpdater());

      // When: checkForUpdates() completes
      await act(async () => { await result.current.checkForUpdates(); });

      // Then: status is upToDate
      expect(result.current.status).toBe('upToDate');
      expect(result.current.availableVersion).toBeNull();
    });

    it('should transition to error when check() throws', async () => {
      // Given: check() rejects
      mockCheck.mockRejectedValue(new Error('network failure'));

      const { result } = renderHook(() => useAppUpdater());

      // When: checkForUpdates() completes
      await act(async () => { await result.current.checkForUpdates(); });

      // Then: status is error and error message is captured
      expect(result.current.status).toBe('error');
      expect(result.current.error).toMatch(/network failure/);
    });

    it('should capture the available version and release notes', async () => {
      // Given: update with specific version and notes
      mockCheck.mockResolvedValue(makeUpdateObject('2.0.0', 'Major release notes here'));

      const { result } = renderHook(() => useAppUpdater());

      await act(async () => { await result.current.checkForUpdates(); });

      expect(result.current.availableVersion).toBe('2.0.0');
      expect(result.current.notes).toBe('Major release notes here');
    });
  });

  // ----------------------------------------------------------------
  // installAvailableUpdate()
  // ----------------------------------------------------------------

  describe('installAvailableUpdate()', () => {
    async function setupAvailableState(version = '1.0.0') {
      mockCheck.mockResolvedValue(makeUpdateObject(version));
      const hook = renderHook(() => useAppUpdater());
      await act(async () => { await hook.result.current.checkForUpdates(); });
      return hook;
    }

    it('should transition to downloading state at the start of download', async () => {
      // Given: an update is available; downloadAndInstall hangs
      let resolveInstall!: () => void;
      mockDownloadAndInstall.mockReturnValue(new Promise<void>((r) => { resolveInstall = r; }));

      const { result } = await setupAvailableState();

      // When: installAvailableUpdate() is called
      act(() => { void result.current.installAvailableUpdate(); });

      // Then: status is downloading
      expect(result.current.status).toBe('downloading');

      // cleanup
      resolveInstall();
    });

    it('should update downloadedBytes and contentLength via progress events', async () => {
      // Given: downloadAndInstall calls the progress callback with Started then Progress
      mockDownloadAndInstall.mockImplementation(async (
        cb: (event: DownloadEvent) => void
      ) => {
        cb({ event: 'Started', data: { contentLength: 1000 } });
        cb({ event: 'Progress', data: { chunkLength: 400 } });
        cb({ event: 'Progress', data: { chunkLength: 600 } });
        cb({ event: 'Finished' });
      });
      mockRelaunch.mockResolvedValue(undefined);

      const { result } = await setupAvailableState();

      await act(async () => { await result.current.installAvailableUpdate(); });

      expect(result.current.contentLength).toBe(1000);
      expect(result.current.downloadedBytes).toBe(1000);
    });

    it('should transition to installing after download completes', async () => {
      // Given: downloadAndInstall sends a Finished event
      mockDownloadAndInstall.mockImplementation(async (
        cb: (event: DownloadEvent) => void
      ) => {
        cb({ event: 'Finished' });
      });
      mockRelaunch.mockResolvedValue(undefined);

      const { result } = await setupAvailableState();

      await act(async () => { await result.current.installAvailableUpdate(); });

      expect(result.current.status).toBe('installing');
    });

    it('should call relaunch() after installation completes', async () => {
      // Given: full happy path
      mockDownloadAndInstall.mockResolvedValue(undefined);
      mockRelaunch.mockResolvedValue(undefined);

      const { result } = await setupAvailableState();

      await act(async () => { await result.current.installAvailableUpdate(); });

      expect(mockRelaunch).toHaveBeenCalledOnce();
    });

    it('should transition to error when downloadAndInstall throws', async () => {
      // Given: downloadAndInstall rejects
      mockDownloadAndInstall.mockRejectedValue(new Error('disk full'));

      const { result } = await setupAvailableState();

      await act(async () => { await result.current.installAvailableUpdate(); });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toMatch(/disk full/);
    });

    it('should not call downloadAndInstall when called from non-available state', async () => {
      // Given: hook is in idle state (no prior check)
      const { result } = renderHook(() => useAppUpdater());
      expect(result.current.status).toBe('idle');

      // When: installAvailableUpdate() is called without a prior check
      await act(async () => { await result.current.installAvailableUpdate(); });

      // Then: downloadAndInstall is never invoked
      expect(mockDownloadAndInstall).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // dismiss()
  // ----------------------------------------------------------------

  describe('dismiss()', () => {
    it('should reset status to idle from available state', async () => {
      // Given: an update is available
      mockCheck.mockResolvedValue(makeUpdateObject());
      const { result } = renderHook(() => useAppUpdater());
      await act(async () => { await result.current.checkForUpdates(); });
      expect(result.current.status).toBe('available');

      // When: dismiss() is called
      act(() => { result.current.dismiss(); });

      // Then: status resets to idle
      expect(result.current.status).toBe('idle');
    });

    it('should reset status to idle from error state', async () => {
      // Given: check produced an error
      mockCheck.mockRejectedValue(new Error('timeout'));
      const { result } = renderHook(() => useAppUpdater());
      await act(async () => { await result.current.checkForUpdates(); });
      expect(result.current.status).toBe('error');

      // When: dismiss() is called
      act(() => { result.current.dismiss(); });

      // Then: status resets to idle
      expect(result.current.status).toBe('idle');
    });

    it('should clear error message on dismiss', async () => {
      // Given: hook is in error state with a message
      mockCheck.mockRejectedValue(new Error('something went wrong'));
      const { result } = renderHook(() => useAppUpdater());
      await act(async () => { await result.current.checkForUpdates(); });
      expect(result.current.error).not.toBeNull();

      // When: dismiss() is called
      act(() => { result.current.dismiss(); });

      // Then: error is cleared
      expect(result.current.error).toBeNull();
    });

    it('should clear availableVersion on dismiss', async () => {
      // Given: an update is available with a version
      mockCheck.mockResolvedValue(makeUpdateObject('9.9.9'));
      const { result } = renderHook(() => useAppUpdater());
      await act(async () => { await result.current.checkForUpdates(); });
      expect(result.current.availableVersion).toBe('9.9.9');

      // When: dismiss() is called
      act(() => { result.current.dismiss(); });

      // Then: availableVersion is cleared
      expect(result.current.availableVersion).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // Auto-check on mount behavior
  // ----------------------------------------------------------------

  describe('auto-check on mount', () => {
    it('should not auto-check on mount when running in DEV mode', async () => {
      // Given: DEV environment (already stubbed true in beforeEach)
      // When: hook mounts
      renderHook(() => useAppUpdater());

      // Then: check() is never called automatically
      await act(async () => {
        // flush any pending microtasks
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(mockCheck).not.toHaveBeenCalled();
    });

    it('should auto-check on mount when not in DEV mode', async () => {
      // Given: non-DEV environment
      vi.stubEnv('DEV', false);
      mockCheck.mockResolvedValue(null);

      // When: hook mounts
      await act(async () => {
        renderHook(() => useAppUpdater());
        await new Promise((r) => setTimeout(r, 0));
      });

      // Then: check() is called automatically
      expect(mockCheck).toHaveBeenCalledOnce();
    });
  });
});
