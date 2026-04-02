import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import UpdateBanner, { type UpdateBannerProps } from './UpdateBanner';
import type { UpdaterStatus } from '../../hooks/useAppUpdater';

// --- helpers ---

function buildProps(overrides: Partial<UpdateBannerProps> = {}): UpdateBannerProps {
  return {
    status: 'idle',
    downloadedBytes: 0,
    contentLength: null,
    error: null,
    onDismiss: vi.fn(),
    ...overrides,
  };
}

// States that should render nothing
// Note: 'available' is now silent because the confirmation dialog handles update approval
const SILENT_STATES: UpdaterStatus[] = ['idle', 'upToDate', 'checking', 'available', 'installing'];

// States that should render a visible banner
const VISIBLE_STATES: UpdaterStatus[] = ['downloading', 'error'];

// ----------------------------------------------------------------
// Visibility
// ----------------------------------------------------------------

describe('UpdateBanner', () => {
  describe('visibility', () => {
    it.each(SILENT_STATES)('should render nothing in %s state', (status) => {
      // Given: status is a non-visible state
      // When: component renders
      const { container } = render(<UpdateBanner {...buildProps({ status })} />);
      // Then: nothing is shown
      expect(container.firstChild).toBeNull();
    });

    it.each(VISIBLE_STATES)('should render a banner in %s state', (status) => {
      // Given: status is a visible state
      const props = buildProps({
        status,
        error: status === 'error' ? 'update failed' : null,
      });
      // When: component renders
      const { container } = render(<UpdateBanner {...props} />);
      // Then: banner is visible
      expect(container.firstChild).not.toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // available state (silent — confirmation handled by native dialog)
  // ----------------------------------------------------------------

  describe('available state', () => {
    it('should render nothing in available state because dialog handles confirmation', () => {
      // Given: status is available (no version or notes needed)
      const props = buildProps({
        status: 'available',
      });
      // When: component renders
      const { container } = render(<UpdateBanner {...props} />);
      // Then: nothing is shown (confirmation is handled by native dialog, not banner)
      expect(container.firstChild).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // downloading state
  // ----------------------------------------------------------------

  describe('downloading state', () => {
    const downloadingProps = buildProps({
      status: 'downloading',
      downloadedBytes: 512,
      contentLength: 1024,
    });

    it('should show download progress text', () => {
      // Given: status is downloading with progress data
      render(<UpdateBanner {...downloadingProps} />);
      // Then: some form of download progress text is visible
      expect(screen.getByText(/512|download/i)).toBeInTheDocument();
    });

    it('should show the total content length', () => {
      // Given: status is downloading with a content length
      render(<UpdateBanner {...downloadingProps} />);
      // Then: total size appears in the UI
      expect(screen.getByText(/1024/)).toBeInTheDocument();
    });

  });

  // ----------------------------------------------------------------
  // error state
  // ----------------------------------------------------------------

  describe('error state', () => {
    const errorProps = buildProps({
      status: 'error',
      error: 'Connection timed out',
    });

    it('should display the error message', () => {
      // Given: status is error with a message
      render(<UpdateBanner {...errorProps} />);
      // Then: error message is visible
      expect(screen.getByText(/Connection timed out/)).toBeInTheDocument();
    });

    it('should show a dismiss button', () => {
      // Given: status is error
      render(<UpdateBanner {...errorProps} />);
      // Then: a dismiss button is present to let the user clear the error
      const dismissBtn = screen.getByRole('button', { name: /dismiss|later|close/i });
      expect(dismissBtn).toBeInTheDocument();
    });

    it('should call onDismiss when the dismiss button is clicked in error state', async () => {
      // Given: status is error
      const onDismiss = vi.fn();
      render(<UpdateBanner {...errorProps} onDismiss={onDismiss} />);

      // When: dismiss is clicked
      await userEvent.click(screen.getByRole('button', { name: /dismiss|later|close/i }));

      // Then: onDismiss fires
      expect(onDismiss).toHaveBeenCalledOnce();
    });
  });
});
