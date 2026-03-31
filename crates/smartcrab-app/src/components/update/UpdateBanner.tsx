import type { UseAppUpdaterReturn } from '../../hooks/useAppUpdater';

export interface UpdateBannerProps
  extends Pick<
    UseAppUpdaterReturn,
    'status' | 'availableVersion' | 'notes' | 'downloadedBytes' | 'contentLength' | 'error'
  > {
  onInstall: () => void;
  onDismiss: () => void;
}

export default function UpdateBanner(props: UpdateBannerProps) {
  const { status, availableVersion, notes, downloadedBytes, contentLength, error, onInstall, onDismiss } = props;

  if (status === 'idle' || status === 'upToDate' || status === 'checking' || status === 'installing') {
    return null;
  }

  if (status === 'available') {
    return (
      <div className="flex items-center justify-between px-4 py-2 bg-yellow-900/30 border-b border-yellow-700 text-yellow-200 text-sm">
        <div className="flex flex-col gap-0.5">
          <p>Version {availableVersion} is available</p>
          {notes && <p className="text-yellow-400">{notes}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={onInstall}
            className="px-3 py-1 bg-yellow-600 hover:bg-yellow-500 text-white rounded text-xs font-medium transition-colors"
          >
            Install
          </button>
          <button
            onClick={onDismiss}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs font-medium transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (status === 'downloading') {
    return (
      <div className="flex items-center justify-between px-4 py-2 bg-blue-900/30 border-b border-blue-700 text-blue-200 text-sm">
        <p>Downloading: {contentLength != null ? `${downloadedBytes} / ${contentLength} bytes` : `${downloadedBytes} bytes`}</p>
        <button
          disabled
          className="px-3 py-1 bg-blue-600 opacity-50 cursor-not-allowed text-white rounded text-xs font-medium"
        >
          Install
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-red-900/30 border-b border-red-700 text-red-400 text-sm">
      <p>{error ?? 'An unknown error occurred while updating'}</p>
      <button
        onClick={onDismiss}
        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs font-medium transition-colors shrink-0"
      >
        Dismiss
      </button>
    </div>
  );
}
