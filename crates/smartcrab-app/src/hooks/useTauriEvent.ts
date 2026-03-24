import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

export function useTauriEvent<T>(event: string, handler: (payload: T) => void) {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listen<T>(event, (e) => handler(e.payload)).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [event, handler]);
}
