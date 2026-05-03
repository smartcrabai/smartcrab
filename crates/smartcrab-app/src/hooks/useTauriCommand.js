import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
export function useTauriCommand(command) {
    const [data, setData] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const execute = useCallback(async (args) => {
        setIsLoading(true);
        setError(null);
        try {
            const result = await invoke(command, args ?? {});
            setData(result);
            return result;
        }
        catch (e) {
            setError(String(e));
            return null;
        }
        finally {
            setIsLoading(false);
        }
    }, [command]);
    return { data, isLoading, error, execute };
}
