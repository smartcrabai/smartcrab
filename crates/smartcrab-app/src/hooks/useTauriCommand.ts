import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function useTauriCommand<T, A = Record<string, unknown>>(command: string) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (args?: A) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await invoke<T>(command, args ?? {});
        setData(result);
        return result;
      } catch (e) {
        setError(String(e));
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [command],
  );

  return { data, isLoading, error, execute };
}
