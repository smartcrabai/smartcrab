import { useState, useCallback, useRef, useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import type { Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { toErrorMessage } from '../lib/error';

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'upToDate'
  | 'error';

export type UpdateCheckSource = 'startup' | 'manual';

export interface UseAppUpdaterReturn {
  status: UpdaterStatus;
  downloadedBytes: number;
  contentLength: number | null;
  error: string | null;
  runInteractiveUpdateCheck: (source: UpdateCheckSource) => Promise<void>;
  dismiss: () => void;
}

export function useAppUpdater(): UseAppUpdaterReturn {
  const [status, setStatus] = useState<UpdaterStatus>('idle');
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [contentLength, setContentLength] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateRef = useRef<Update | null>(null);
  // statusRef mirrors the status state synchronously so that concurrency guards
  // in async callbacks can read the latest value without stale closure issues.
  const statusRef = useRef<UpdaterStatus>('idle');

  const setStatusSync = useCallback((s: UpdaterStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const checkForUpdates = useCallback(async () => {
    setStatusSync('checking');
    setError(null);
    try {
      const update = await check();
      if (update) {
        updateRef.current = update;
        setStatusSync('available');
      } else {
        updateRef.current = null;
        setStatusSync('upToDate');
      }
    } catch (err) {
      setStatusSync('error');
      setError(toErrorMessage(err));
    }
  }, [setStatusSync]);

  const installAvailableUpdate = useCallback(async () => {
    if (!updateRef.current) return;

    const update = updateRef.current;
    setStatusSync('downloading');
    setError(null);
    setDownloadedBytes(0);
    setContentLength(null);

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          setContentLength(event.data.contentLength ?? null);
        } else if (event.event === 'Progress') {
          setDownloadedBytes((prev) => prev + event.data.chunkLength);
        } else if (event.event === 'Finished') {
          setStatusSync('installing');
        }
      });
      await relaunch();
    } catch (err) {
      setStatusSync('error');
      setError(toErrorMessage(err));
    }
  }, [setStatusSync]);

  const dismiss = useCallback(() => {
    setStatusSync('idle');
    setError(null);
    setDownloadedBytes(0);
    setContentLength(null);
    updateRef.current = null;
  }, [setStatusSync]);

  const runInteractiveUpdateCheck = useCallback(async (source: UpdateCheckSource) => {
    // Guard against concurrent checks/downloads/installs using the synchronous ref.
    if (statusRef.current === 'checking' || statusRef.current === 'available' || statusRef.current === 'downloading' || statusRef.current === 'installing') return;

    await checkForUpdates();

    // Cast to reset TypeScript's control-flow narrowing applied by the early-return
    // guard above — statusRef.current may now be 'available' after checkForUpdates().
    const postCheckStatus = statusRef.current as UpdaterStatus;
    if (postCheckStatus === 'available') {
      const confirmed = await ask(
        `A new version ${updateRef.current!.version} is available. Do you want to install it?`,
      );
      if (confirmed) {
        await installAvailableUpdate();
      } else {
        dismiss();
      }
    } else if (postCheckStatus === 'upToDate' && source === 'manual') {
      await message('You are already running the latest version.');
    }
  }, [checkForUpdates, installAvailableUpdate, dismiss]);

  useEffect(() => {
    // Use bracket notation so vi.stubEnv('DEV', ...) can override this at runtime
    // in tests. Dot-notation import.meta.env.DEV may be inlined as a literal by
    // Vite/Vitest transforms, making runtime stubs ineffective.
    if (import.meta.env['DEV']) return;
    void runInteractiveUpdateCheck('startup');
  }, [runInteractiveUpdateCheck]);

  return {
    status,
    downloadedBytes,
    contentLength,
    error,
    runInteractiveUpdateCheck,
    dismiss,
  };
}
