import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DownloadEvent } from '@tauri-apps/plugin-updater';
import { useAppUpdater } from './useAppUpdater';

// --- Tauri plugin mocks ---

const { mockDownloadAndInstall, mockRelaunch, mockCheck, mockAsk, mockMessage } = vi.hoisted(() => ({
  mockDownloadAndInstall: vi.fn(),
  mockRelaunch: vi.fn(),
  mockCheck: vi.fn(),
  mockAsk: vi.fn(),
  mockMessage: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mockCheck,
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: mockRelaunch,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  ask: mockAsk,
  message: mockMessage,
}));

// --- helpers ---

function makeUpdateObject(version = '1.0.0', body = 'Release notes') {
  return {
    version,
    body,
    downloadAndInstall: mockDownloadAndInstall,
  };
}

// Setup helper: runs runInteractiveUpdateCheck and leaves it in 'downloading' state
// by keeping mockDownloadAndInstall unresolved.
async function setupDownloadingState(version = '1.0.0') {
  mockCheck.mockResolvedValue(makeUpdateObject(version));
  mockAsk.mockResolvedValue(true);
  let resolveDownload!: () => void;
  mockDownloadAndInstall.mockReturnValue(new Promise<void>((r) => { resolveDownload = r; }));

  const hook = renderHook(() => useAppUpdater());
  act(() => { void hook.result.current.runInteractiveUpdateCheck('manual'); });
  // Flush microtasks so check() and ask() resolve, leaving downloadAndInstall pending
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  return { ...hook, resolveDownload };
}

// Setup helper: runs runInteractiveUpdateCheck and leaves it in 'installing' state
// by sending a Finished event but keeping relaunch unresolved.
async function setupInstallingState() {
  mockCheck.mockResolvedValue(makeUpdateObject('1.0.0'));
  mockAsk.mockResolvedValue(true);
  mockDownloadAndInstall.mockImplementation(async (cb: (event: DownloadEvent) => void) => {
    cb({ event: 'Finished' });
  });
  let resolveRelaunch!: () => void;
  mockRelaunch.mockReturnValue(new Promise<void>((r) => { resolveRelaunch = r; }));

  const hook = renderHook(() => useAppUpdater());
  await act(async () => { void hook.result.current.runInteractiveUpdateCheck('manual'); });

  return { ...hook, resolveRelaunch };
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
  // runInteractiveUpdateCheck()
  // ----------------------------------------------------------------

  describe('runInteractiveUpdateCheck()', () => {
    // --- Manual source ---

    describe('manual source', () => {
      it('should check, show confirm dialog, and install when update found and user confirms', async () => {
        // Given: an update is available and the user will confirm
        mockCheck.mockResolvedValue(makeUpdateObject('2.0.0', 'Major release'));
        mockAsk.mockResolvedValue(true);
        mockDownloadAndInstall.mockResolvedValue(undefined);
        mockRelaunch.mockResolvedValue(undefined);

        const { result } = renderHook(() => useAppUpdater());

        // When: runInteractiveUpdateCheck('manual') completes
        await act(async () => {
          await result.current.runInteractiveUpdateCheck('manual');
        });

        // Then: check was called, dialog was shown with version, and install proceeded
        expect(mockCheck).toHaveBeenCalledOnce();
        expect(mockAsk).toHaveBeenCalledOnce();
        expect(mockAsk).toHaveBeenCalledWith(expect.stringContaining('2.0.0'));
        expect(mockDownloadAndInstall).toHaveBeenCalledOnce();
        expect(mockRelaunch).toHaveBeenCalledOnce();
      });

      it('should check, show confirm dialog, and dismiss when update found and user declines', async () => {
        // Given: an update is available but the user declines
        mockCheck.mockResolvedValue(makeUpdateObject('2.0.0', 'Major release'));
        mockAsk.mockResolvedValue(false);

        const { result } = renderHook(() => useAppUpdater());

        // When: runInteractiveUpdateCheck('manual') completes
        await act(async () => {
          await result.current.runInteractiveUpdateCheck('manual');
        });

        // Then: check was called, dialog was shown, but install did NOT proceed
        expect(mockCheck).toHaveBeenCalledOnce();
        expect(mockAsk).toHaveBeenCalledOnce();
        expect(mockDownloadAndInstall).not.toHaveBeenCalled();
        expect(result.current.status).toBe('idle');
      });

      it('should show informational message when no update is found', async () => {
        // Given: no update available
        mockCheck.mockResolvedValue(null);
        mockMessage.mockResolvedValue(undefined);

        const { result } = renderHook(() => useAppUpdater());

        // When: runInteractiveUpdateCheck('manual') completes
        await act(async () => {
          await result.current.runInteractiveUpdateCheck('manual');
        });

        // Then: check was called and an informational message was shown
        expect(mockCheck).toHaveBeenCalledOnce();
        expect(mockMessage).toHaveBeenCalledOnce();
        expect(result.current.status).toBe('upToDate');
      });

      it('should transition to error when check fails', async () => {
        // Given: check() throws
        mockCheck.mockRejectedValue(new Error('server unreachable'));

        const { result } = renderHook(() => useAppUpdater());

        // When: runInteractiveUpdateCheck('manual') completes
        await act(async () => {
          await result.current.runInteractiveUpdateCheck('manual');
        });

        // Then: status is error
        expect(result.current.status).toBe('error');
        expect(result.current.error).toMatch(/server unreachable/);
        expect(mockAsk).not.toHaveBeenCalled();
      });

      it('should transition through checking → available → downloading → installing states', async () => {
        // Given: update available, user confirms, download progresses
        mockCheck.mockResolvedValue(makeUpdateObject('1.2.3'));
        // ask pending so we can verify available state
        let resolveAsk!: (v: boolean) => void;
        mockAsk.mockReturnValue(new Promise((r) => { resolveAsk = r; }));
        mockDownloadAndInstall.mockImplementation(async (cb: (event: DownloadEvent) => void) => {
          cb({ event: 'Started', data: { contentLength: 1000 } });
          cb({ event: 'Progress', data: { chunkLength: 400 } });
          cb({ event: 'Progress', data: { chunkLength: 600 } });
          cb({ event: 'Finished' });
        });
        mockRelaunch.mockResolvedValue(undefined);

        const { result } = renderHook(() => useAppUpdater());

        // Start check — expect checking state immediately
        act(() => { void result.current.runInteractiveUpdateCheck('manual'); });
        expect(result.current.status).toBe('checking');

        // Let check() resolve — now waiting for user dialog (available state)
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(result.current.status).toBe('available');

        // User confirms — download + install + relaunch run to completion
        await act(async () => { resolveAsk(true); });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

        // Then: download progress was tracked
        expect(result.current.contentLength).toBe(1000);
        expect(result.current.downloadedBytes).toBe(1000);
        // Then: status ended on installing (relaunch() call follows)
        expect(result.current.status).toBe('installing');
      });

      it('should transition to error when download fails', async () => {
        // Given: update available, user confirms, but download throws
        mockCheck.mockResolvedValue(makeUpdateObject('1.0.0'));
        mockAsk.mockResolvedValue(true);
        mockDownloadAndInstall.mockRejectedValue(new Error('disk full'));

        const { result } = renderHook(() => useAppUpdater());

        await act(async () => {
          await result.current.runInteractiveUpdateCheck('manual');
        });

        expect(result.current.status).toBe('error');
        expect(result.current.error).toMatch(/disk full/);
      });
    });

    // --- Startup source ---

    describe('startup source', () => {
      it('should check, show confirm dialog, and install when update found and user confirms', async () => {
        // Given: an update is available and the user will confirm
        mockCheck.mockResolvedValue(makeUpdateObject('3.0.0', 'New features'));
        mockAsk.mockResolvedValue(true);
        mockDownloadAndInstall.mockResolvedValue(undefined);
        mockRelaunch.mockResolvedValue(undefined);

        const { result } = renderHook(() => useAppUpdater());

        await act(async () => {
          await result.current.runInteractiveUpdateCheck('startup');
        });

        expect(mockCheck).toHaveBeenCalledOnce();
        expect(mockAsk).toHaveBeenCalledOnce();
        expect(mockDownloadAndInstall).toHaveBeenCalledOnce();
      });

      it('should check, show confirm dialog, and dismiss when update found and user declines', async () => {
        // Given: an update is available but the user declines
        mockCheck.mockResolvedValue(makeUpdateObject('3.0.0'));
        mockAsk.mockResolvedValue(false);

        const { result } = renderHook(() => useAppUpdater());

        await act(async () => {
          await result.current.runInteractiveUpdateCheck('startup');
        });

        expect(mockAsk).toHaveBeenCalledOnce();
        expect(mockDownloadAndInstall).not.toHaveBeenCalled();
        expect(result.current.status).toBe('idle');
      });

      it('should NOT show informational message when no update is found', async () => {
        // Given: no update available
        mockCheck.mockResolvedValue(null);

        const { result } = renderHook(() => useAppUpdater());

        await act(async () => {
          await result.current.runInteractiveUpdateCheck('startup');
        });

        // Then: check was called but NO message dialog shown (silent for startup)
        expect(mockCheck).toHaveBeenCalledOnce();
        expect(mockMessage).not.toHaveBeenCalled();
        expect(result.current.status).toBe('upToDate');
      });

      it('should transition to error when check fails', async () => {
        // Given: check() throws
        mockCheck.mockRejectedValue(new Error('timeout'));

        const { result } = renderHook(() => useAppUpdater());

        await act(async () => {
          await result.current.runInteractiveUpdateCheck('startup');
        });

        expect(result.current.status).toBe('error');
        expect(result.current.error).toMatch(/timeout/);
      });
    });

    // --- Concurrency guards ---

    describe('concurrency guard', () => {
      it('should ignore the call when already checking', async () => {
        // Given: a check is already in progress (never resolves)
        let resolveCheck!: (v: null) => void;
        mockCheck.mockReturnValue(new Promise((r) => { resolveCheck = r; }));

        const { result } = renderHook(() => useAppUpdater());

        // Start a check
        act(() => { void result.current.runInteractiveUpdateCheck('manual'); });
        expect(result.current.status).toBe('checking');

        // When: runInteractiveUpdateCheck is called while checking
        await act(async () => {
          await result.current.runInteractiveUpdateCheck('manual');
        });

        // Then: check was only called once (the second call was ignored)
        expect(mockCheck).toHaveBeenCalledOnce();
        expect(mockAsk).not.toHaveBeenCalled();

        // cleanup
        resolveCheck(null);
      });

      it('should ignore the call when update is available (dialog open)', async () => {
        // Given: check completed and ask dialog is pending
        mockCheck.mockResolvedValue(makeUpdateObject('1.0.0'));
        let resolveAsk!: (v: boolean) => void;
        mockAsk.mockReturnValue(new Promise((r) => { resolveAsk = r; }));

        const { result } = renderHook(() => useAppUpdater());
        act(() => { void result.current.runInteractiveUpdateCheck('manual'); });
        // Flush microtasks so check() resolves, leaving ask() pending (available state)
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        expect(result.current.status).toBe('available');

        // When: runInteractiveUpdateCheck is called while dialog is open
        // The guard returns synchronously without any state changes, so act() is not needed
        void result.current.runInteractiveUpdateCheck('manual');

        // Then: status remains 'available' (guard blocked the second call) and no extra check ran
        expect(result.current.status).toBe('available');
        expect(mockCheck).toHaveBeenCalledOnce();
        expect(mockAsk).toHaveBeenCalledOnce(); // only from the original call

        // cleanup
        await act(async () => { resolveAsk(false); });
      });

      it('should ignore the call when already downloading', async () => {
        // Given: an update is available and download is in progress
        const { result, resolveDownload } = await setupDownloadingState();
        expect(result.current.status).toBe('downloading');

        // When: runInteractiveUpdateCheck is called while downloading
        await act(async () => {
          await result.current.runInteractiveUpdateCheck('manual');
        });

        // Then: no additional check was made
        expect(mockCheck).toHaveBeenCalledOnce();
        expect(mockAsk).toHaveBeenCalledOnce(); // only from the original call

        // cleanup
        resolveDownload();
      });

      it('should ignore the call when already installing', async () => {
        // Given: download finished, installing in progress
        const { result, resolveRelaunch } = await setupInstallingState();
        expect(result.current.status).toBe('installing');

        // When: runInteractiveUpdateCheck is called while installing
        await act(async () => {
          await result.current.runInteractiveUpdateCheck('manual');
        });

        // Then: no additional check was made
        expect(mockCheck).toHaveBeenCalledOnce();

        // cleanup
        resolveRelaunch();
      });
    });
  });

  // ----------------------------------------------------------------
  // dismiss()
  // ----------------------------------------------------------------

  describe('dismiss()', () => {
    it('should reset status to idle from available state', async () => {
      // Given: an update is available (ask is pending)
      mockCheck.mockResolvedValue(makeUpdateObject());
      let resolveAsk!: (v: boolean) => void;
      mockAsk.mockReturnValue(new Promise((r) => { resolveAsk = r; }));
      const { result } = renderHook(() => useAppUpdater());
      act(() => { void result.current.runInteractiveUpdateCheck('manual'); });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(result.current.status).toBe('available');

      // When: dismiss() is called
      act(() => { result.current.dismiss(); });

      // Then: status resets to idle
      expect(result.current.status).toBe('idle');

      // cleanup
      resolveAsk(false);
    });

    it('should reset status to idle from error state', async () => {
      // Given: check produced an error
      mockCheck.mockRejectedValue(new Error('timeout'));
      const { result } = renderHook(() => useAppUpdater());
      await act(async () => { await result.current.runInteractiveUpdateCheck('manual'); });
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
      await act(async () => { await result.current.runInteractiveUpdateCheck('manual'); });
      expect(result.current.error).not.toBeNull();

      // When: dismiss() is called
      act(() => { result.current.dismiss(); });

      // Then: error is cleared
      expect(result.current.error).toBeNull();
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
      // Given: non-DEV environment, no update available
      vi.stubEnv('DEV', false);
      mockCheck.mockResolvedValue(null);

      // When: hook mounts
      await act(async () => {
        renderHook(() => useAppUpdater());
        await new Promise((r) => setTimeout(r, 0));
      });

      // Then: check() is called automatically via runInteractiveUpdateCheck('startup')
      expect(mockCheck).toHaveBeenCalledOnce();
    });

    it('should show confirmation dialog on startup auto-check when update is available', async () => {
      // Given: non-DEV environment, update available, user confirms
      vi.stubEnv('DEV', false);
      mockCheck.mockResolvedValue(makeUpdateObject('2.0.0', 'New'));
      mockAsk.mockResolvedValue(true);
      mockDownloadAndInstall.mockResolvedValue(undefined);
      mockRelaunch.mockResolvedValue(undefined);

      // When: hook mounts
      await act(async () => {
        renderHook(() => useAppUpdater());
        await new Promise((r) => setTimeout(r, 0));
      });

      // Then: confirmation dialog is shown and update is installed
      expect(mockCheck).toHaveBeenCalledOnce();
      expect(mockAsk).toHaveBeenCalledOnce();
      expect(mockDownloadAndInstall).toHaveBeenCalledOnce();
    });
  });
});
