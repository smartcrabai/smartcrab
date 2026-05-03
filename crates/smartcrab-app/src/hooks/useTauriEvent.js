import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
export function useTauriEvent(event, handler) {
    useEffect(() => {
        let cancelled = false;
        let unlisten;
        listen(event, (e) => handler(e.payload)).then((fn) => {
            if (cancelled) {
                fn();
            }
            else {
                unlisten = fn;
            }
        });
        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, [event, handler]);
}
