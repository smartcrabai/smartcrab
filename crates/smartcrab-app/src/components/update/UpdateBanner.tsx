import type { UseAppUpdaterReturn } from '../../hooks/useAppUpdater';

export interface UpdateBannerProps
  extends Pick<
    UseAppUpdaterReturn,
    'status' | 'downloadedBytes' | 'contentLength' | 'error'
  > {
  onDismiss: () => void;
}

export default function UpdateBanner(props: UpdateBannerProps) {
  const { status, downloadedBytes, contentLength, error, onDismiss } = props;

  if (status === 'idle' || status === 'upToDate' || status === 'checking' || status === 'available' || status === 'installing') {
    return null;
  }

  if (status === 'downloading') {
    return (
      <div className="px-4 py-2 bg-blue-900/30 border-b border-blue-700 text-blue-200 text-sm">
        <p>Downloading: {contentLength != null ? `${downloadedBytes} / ${contentLength} bytes` : `${downloadedBytes} bytes`}</p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-red-900/30 border-b border-red-700 text-red-400 text-sm">
      <p>{error}</p>
      <button
        onClick={onDismiss}
        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs font-medium transition-colors shrink-0"
      >
        Dismiss
      </button>
    </div>
  );
}
