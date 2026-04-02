import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdapterSettings } from './AdapterSettings';
import type { AdapterInfo, AdapterConfig } from '../../types';

// --- mock Tauri invoke ---

const mockInvoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

// --- helpers ---

function buildAdapterInfo(overrides: Partial<AdapterInfo> = {}): AdapterInfo {
  return {
    adapterType: 'discord',
    name: 'Discord',
    isConfigured: false,
    isActive: false,
    ...overrides,
  };
}

function buildAdapterConfig(overrides: Partial<AdapterConfig> = {}): AdapterConfig {
  return {
    adapterType: 'discord',
    configJson: { bot_token_env: '', notification_channel_id: '' },
    isActive: false,
    ...overrides,
  };
}

// ----------------------------------------------------------------
// Test suite
// ----------------------------------------------------------------

describe('AdapterSettings', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  // ----------------------------------------------------------------
  // Adapter list rendering
  // ----------------------------------------------------------------

  describe('adapter list', () => {
    it('should render adapter cards from invoke result', async () => {
      // Given: list_adapters returns a Discord adapter
      mockInvoke.mockResolvedValueOnce([
        buildAdapterInfo({ name: 'Discord', adapterType: 'discord' }),
      ]);

      // When: component mounts
      render(<AdapterSettings />);

      // Then: Discord adapter card is displayed
      await waitFor(() => {
        expect(screen.getByText('Discord')).toBeInTheDocument();
      });
    });

    it('should show "No adapters found" when list is empty', async () => {
      // Given: list_adapters returns empty
      mockInvoke.mockResolvedValueOnce([]);

      // When: component mounts
      render(<AdapterSettings />);

      // Then: empty message is displayed
      await waitFor(() => {
        expect(screen.getByText('No adapters found')).toBeInTheDocument();
      });
    });

    it('should display Running badge when adapter is active', async () => {
      // Given: adapter is active
      mockInvoke.mockResolvedValueOnce([
        buildAdapterInfo({ isActive: true }),
      ]);

      render(<AdapterSettings />);

      await waitFor(() => {
        expect(screen.getByText('Running')).toBeInTheDocument();
      });
    });

    it('should display Configured badge when adapter is configured but not active', async () => {
      // Given: adapter is configured but not active
      mockInvoke.mockResolvedValueOnce([
        buildAdapterInfo({ isConfigured: true, isActive: false }),
      ]);

      render(<AdapterSettings />);

      await waitFor(() => {
        expect(screen.getByText('Configured')).toBeInTheDocument();
      });
    });

    it('should display Not configured badge when adapter is not configured', async () => {
      // Given: adapter is not configured
      mockInvoke.mockResolvedValueOnce([
        buildAdapterInfo({ isConfigured: false, isActive: false }),
      ]);

      render(<AdapterSettings />);

      await waitFor(() => {
        expect(screen.getByText('Not configured')).toBeInTheDocument();
      });
    });

    it('should call list_adapters on mount', async () => {
      mockInvoke.mockResolvedValueOnce([]);

      render(<AdapterSettings />);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('list_adapters');
      });
    });
  });

  // ----------------------------------------------------------------
  // Config expansion and Discord-specific fields
  // ----------------------------------------------------------------

  describe('config expansion', () => {
    it('should show Discord config fields when expanded', async () => {
      // Given: Discord adapter in list
      mockInvoke.mockResolvedValueOnce([buildAdapterInfo()]);
      // get_adapter_config returns config
      mockInvoke.mockResolvedValueOnce(
        buildAdapterConfig({
          configJson: { bot_token_env: 'MY_TOKEN', notification_channel_id: '123' },
        }),
      );

      render(<AdapterSettings />);

      await waitFor(() => {
        expect(screen.getByText('Discord')).toBeInTheDocument();
      });

      // When: clicking the expand button (the last button in the card)
      const buttons = screen.getAllByRole('button');
      // The expand button is the last button in the adapter card (chevron)
      const expandBtn = buttons[buttons.length - 1];
      await userEvent.click(expandBtn);

      // Then: Discord-specific fields appear
      await waitFor(() => {
        expect(screen.getByText('Bot Token Env Var Name')).toBeInTheDocument();
        expect(screen.getByText('Notification Channel ID')).toBeInTheDocument();
      });
    });

    it('should load config via get_adapter_config when expanding', async () => {
      mockInvoke.mockResolvedValueOnce([buildAdapterInfo()]);
      mockInvoke.mockResolvedValueOnce(
        buildAdapterConfig({
          configJson: { bot_token_env: 'DISCORD_BOT_TOKEN', notification_channel_id: '999' },
        }),
      );

      render(<AdapterSettings />);

      await waitFor(() => {
        expect(screen.getByText('Discord')).toBeInTheDocument();
      });

      const buttons = screen.getAllByRole('button');
      const expandBtn = buttons[buttons.length - 1];
      await userEvent.click(expandBtn);

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('get_adapter_config', {
          adapterType: 'discord',
        });
      });
    });
  });

  // ----------------------------------------------------------------
  // Save config
  // ----------------------------------------------------------------

  describe('save config', () => {
    it('should call save_adapter_config command when saving', async () => {
      // Given: Discord adapter expanded with config loaded
      mockInvoke.mockResolvedValueOnce([buildAdapterInfo()]);
      mockInvoke.mockResolvedValueOnce(
        buildAdapterConfig({
          configJson: { bot_token_env: 'MY_TOKEN', notification_channel_id: '' },
        }),
      );
      // save_adapter_config returns void
      mockInvoke.mockResolvedValueOnce(undefined);

      render(<AdapterSettings />);

      await waitFor(() => {
        expect(screen.getByText('Discord')).toBeInTheDocument();
      });

      // Expand
      const buttons = screen.getAllByRole('button');
      const expandBtn = buttons[buttons.length - 1];
      await userEvent.click(expandBtn);

      await waitFor(() => {
        expect(screen.getByText('Save')).toBeInTheDocument();
      });

      // When: clicking Save
      const saveBtn = screen.getByText('Save');
      await userEvent.click(saveBtn);

      // Then: save_adapter_config is called with correct command name
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('save_adapter_config', {
          adapterType: 'discord',
          configJson: expect.objectContaining({
            bot_token_env: 'MY_TOKEN',
          }),
        });
      });
    });
  });

  // ----------------------------------------------------------------
  // Start / Stop toggle
  // ----------------------------------------------------------------

  describe('adapter toggle', () => {
    it('should call start_adapter when Start button is clicked', async () => {
      // Given: adapter is not active
      mockInvoke.mockResolvedValueOnce([buildAdapterInfo({ isActive: false })]);
      // start_adapter returns void
      mockInvoke.mockResolvedValueOnce(undefined);
      // After start, list_adapters returns updated state
      mockInvoke.mockResolvedValueOnce([buildAdapterInfo({ isActive: true })]);

      render(<AdapterSettings />);

      await waitFor(() => {
        expect(screen.getByText('Start')).toBeInTheDocument();
      });

      // When: clicking Start
      await userEvent.click(screen.getByText('Start'));

      // Then: start_adapter is called
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('start_adapter', {
          adapterType: 'discord',
        });
      });
    });

    it('should call stop_adapter when Stop button is clicked', async () => {
      // Given: adapter is active
      mockInvoke.mockResolvedValueOnce([buildAdapterInfo({ isActive: true })]);
      // stop_adapter returns void
      mockInvoke.mockResolvedValueOnce(undefined);
      // After stop, list_adapters returns updated state
      mockInvoke.mockResolvedValueOnce([buildAdapterInfo({ isActive: false })]);

      render(<AdapterSettings />);

      await waitFor(() => {
        expect(screen.getByText('Stop')).toBeInTheDocument();
      });

      // When: clicking Stop
      await userEvent.click(screen.getByText('Stop'));

      // Then: stop_adapter is called
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('stop_adapter', {
          adapterType: 'discord',
        });
      });
    });

    it('should refresh adapter list after toggle', async () => {
      mockInvoke.mockResolvedValueOnce([buildAdapterInfo({ isActive: false })]);
      // start_adapter returns void
      mockInvoke.mockResolvedValueOnce(undefined);
      mockInvoke.mockResolvedValueOnce([buildAdapterInfo({ isActive: true })]);

      render(<AdapterSettings />);

      await waitFor(() => {
        expect(screen.getByText('Start')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText('Start'));

      // Then: list_adapters is called again to refresh
      await waitFor(() => {
        const listCalls = mockInvoke.mock.calls.filter(
          (c: unknown[]) => c[0] === 'list_adapters'
        );
        expect(listCalls.length).toBeGreaterThanOrEqual(2);
      });
    });
  });
});
