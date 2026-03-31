import { useState, useCallback, useRef, useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import type { Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { toErrorMessage } from '../lib/error';

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'upToDate'
  | 'error';

export interface UseAppUpdaterReturn {
  status: UpdaterStatus;
  availableVersion: string | null;
  notes: string | null;
  downloadedBytes: number;
  contentLength: number | null;
  error: string | null;
  checkForUpdates: () => Promise<void>;
  installAvailableUpdate: () => Promise<void>;
  dismiss: () => void;
}

export function useAppUpdater(): UseAppUpdaterReturn {
  const [status, setStatus] = useState<UpdaterStatus>('idle');
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [contentLength, setContentLength] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateRef = useRef<Update | null>(null);

  const checkForUpdates = useCallback(async () => {
    setStatus('checking');
    setError(null);
    try {
      const update = await check();
      if (update) {
        updateRef.current = update;
        setAvailableVersion(update.version);
        setNotes(update.body ?? null);
        setStatus('available');
      } else {
        updateRef.current = null;
        setAvailableVersion(null);
        setNotes(null);
        setStatus('upToDate');
      }
    } catch (err) {
      setStatus('error');
      setError(toErrorMessage(err));
    }
  }, []);

  const installAvailableUpdate = useCallback(async () => {
    if (!updateRef.current) return;

    const update = updateRef.current;
    setStatus('downloading');
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
          setStatus('installing');
        }
      });
      await relaunch();
    } catch (err) {
      setStatus('error');
      setError(toErrorMessage(err));
    }
  }, []);

  const dismiss = useCallback(() => {
    setStatus('idle');
    setError(null);
    setAvailableVersion(null);
    setNotes(null);
    setDownloadedBytes(0);
    setContentLength(null);
    updateRef.current = null;
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    void checkForUpdates();
  }, [checkForUpdates]);

  return {
    status,
    availableVersion,
    notes,
    downloadedBytes,
    contentLength,
    error,
    checkForUpdates,
    installAvailableUpdate,
    dismiss,
  };
}
