import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import UpdateBanner, { type UpdateBannerProps } from './UpdateBanner';
import type { UpdaterStatus } from '../../hooks/useAppUpdater';

// --- helpers ---

function buildProps(overrides: Partial<UpdateBannerProps> = {}): UpdateBannerProps {
  return {
    status: 'idle',
    availableVersion: null,
    notes: null,
    downloadedBytes: 0,
    contentLength: null,
    error: null,
    onInstall: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
}

// States that should render nothing
const SILENT_STATES: UpdaterStatus[] = ['idle', 'upToDate', 'checking', 'installing'];

// States that should render a visible banner
const VISIBLE_STATES: UpdaterStatus[] = ['available', 'downloading', 'error'];

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
        availableVersion: status !== 'error' ? '1.0.0' : null,
        error: status === 'error' ? 'update failed' : null,
      });
      // When: component renders
      const { container } = render(<UpdateBanner {...props} />);
      // Then: banner is visible
      expect(container.firstChild).not.toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // available state
  // ----------------------------------------------------------------

  describe('available state', () => {
    const availableProps = buildProps({
      status: 'available',
      availableVersion: '2.3.4',
      notes: 'Bug fixes and improvements',
    });

    it('should display the available version', () => {
      // Given: status is available with a version
      render(<UpdateBanner {...availableProps} />);
      // Then: version is shown
      expect(screen.getByText(/2\.3\.4/)).toBeInTheDocument();
    });

    it('should display the release notes', () => {
      // Given: status is available with notes
      render(<UpdateBanner {...availableProps} />);
      // Then: notes are shown
      expect(screen.getByText(/Bug fixes and improvements/)).toBeInTheDocument();
    });

    it('should show an install button', () => {
      // Given: status is available
      render(<UpdateBanner {...availableProps} />);
      // Then: an install button is present
      const installBtn = screen.getByRole('button', { name: /install/i });
      expect(installBtn).toBeInTheDocument();
    });

    it('should call onInstall when the install button is clicked', async () => {
      // Given: status is available with an onInstall callback
      const onInstall = vi.fn();
      render(<UpdateBanner {...availableProps} onInstall={onInstall} />);

      // When: the install button is clicked
      await userEvent.click(screen.getByRole('button', { name: /install/i }));

      // Then: onInstall is called once
      expect(onInstall).toHaveBeenCalledOnce();
    });

    it('should show a dismiss button', () => {
      // Given: status is available
      render(<UpdateBanner {...availableProps} />);
      // Then: a dismiss button is present
      const dismissBtn = screen.getByRole('button', { name: /dismiss|later|close/i });
      expect(dismissBtn).toBeInTheDocument();
    });

    it('should call onDismiss when the dismiss button is clicked', async () => {
      // Given: status is available with an onDismiss callback
      const onDismiss = vi.fn();
      render(<UpdateBanner {...availableProps} onDismiss={onDismiss} />);

      // When: the dismiss button is clicked
      await userEvent.click(screen.getByRole('button', { name: /dismiss|later|close/i }));

      // Then: onDismiss is called once
      expect(onDismiss).toHaveBeenCalledOnce();
    });
  });

  // ----------------------------------------------------------------
  // downloading state
  // ----------------------------------------------------------------

  describe('downloading state', () => {
    const downloadingProps = buildProps({
      status: 'downloading',
      availableVersion: '2.3.4',
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

    it('should render the install button as disabled', () => {
      // Given: status is downloading
      render(<UpdateBanner {...downloadingProps} />);
      // Then: the install button is disabled
      const installBtn = screen.getByRole('button', { name: /install/i });
      expect(installBtn).toBeDisabled();
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
