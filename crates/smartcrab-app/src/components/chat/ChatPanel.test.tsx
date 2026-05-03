import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatPanel } from './ChatPanel';

const mockInvoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

describe('ChatPanel', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe('send message', () => {
    it('should call chat_create_pipeline with prompt when user sends message', async () => {
      mockInvoke.mockResolvedValueOnce({ message: 'Pipeline created!' });

      render(<ChatPanel />);

      const textarea = screen.getByRole('textbox');
      await userEvent.type(textarea, 'Check API every 5 minutes');
      await userEvent.keyboard('{Enter}');

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('chat_create_pipeline', {
          prompt: 'Check API every 5 minutes',
        });
      });
    });

    it('should show user message in the chat', async () => {
      mockInvoke.mockResolvedValueOnce({ message: 'Pipeline created!' });

      render(<ChatPanel />);

      const textarea = screen.getByRole('textbox');
      await userEvent.type(textarea, 'Check API every 5 minutes');
      await userEvent.keyboard('{Enter}');

      await waitFor(() => {
        expect(screen.getByText('Check API every 5 minutes')).toBeInTheDocument();
      });
    });

    it('should show assistant response message', async () => {
      mockInvoke.mockResolvedValueOnce({ message: 'Here is your pipeline YAML' });

      render(<ChatPanel />);

      const textarea = screen.getByRole('textbox');
      await userEvent.type(textarea, 'Create a pipeline');
      await userEvent.keyboard('{Enter}');

      await waitFor(() => {
        expect(screen.getByText('Here is your pipeline YAML')).toBeInTheDocument();
      });
    });

    it('should show yaml content when provided', async () => {
      mockInvoke.mockResolvedValueOnce({ message: 'Done', yaml_content: 'api:\n  url: https://example.com\n  interval: 300' });

      render(<ChatPanel />);

      const textarea = screen.getByRole('textbox');
      await userEvent.type(textarea, 'Create a pipeline');
      await userEvent.keyboard('{Enter}');

      await waitFor(() => {
        expect(screen.getByText(/url: https:\/\/example.com/)).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('should disable input while loading', async () => {
      let resolve: (value: { message: string }) => void;
      mockInvoke.mockImplementationOnce(
        () =>
          new Promise(r => {
            resolve = r;
          })
      );

      render(<ChatPanel />);

      const textarea = screen.getByRole('textbox');
      await userEvent.type(textarea, 'Slow request');
      await userEvent.keyboard('{Enter}');

      await waitFor(() => {
        expect(textarea).toBeDisabled();
      });

      resolve!({ message: 'Done' });

      await waitFor(() => {
        expect(textarea).not.toBeDisabled();
      });
    });

    it('should show loading indicator while waiting for response', async () => {
      let resolve: (value: { message: string }) => void;
      mockInvoke.mockImplementationOnce(
        () =>
          new Promise(r => {
            resolve = r;
          })
      );

      render(<ChatPanel />);

      const textarea = screen.getByRole('textbox');
      await userEvent.type(textarea, 'Slow request');
      await userEvent.keyboard('{Enter}');

      await waitFor(() => {
        expect(screen.getByText(/Claude is thinking/)).toBeInTheDocument();
      });

      resolve!({ message: 'Done' });

      await waitFor(() => {
        expect(screen.queryByText(/Claude is thinking/)).not.toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('should show error message when invoke fails', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('AI service unavailable'));

      render(<ChatPanel />);

      const textarea = screen.getByRole('textbox');
      await userEvent.type(textarea, 'Create a pipeline');
      await userEvent.keyboard('{Enter}');

      await waitFor(() => {
        expect(screen.getByText(/AI service unavailable/)).toBeInTheDocument();
      });
    });

    it('should convert non-Error to string in error message', async () => {
      mockInvoke.mockRejectedValueOnce('Something went wrong');

      render(<ChatPanel />);

      const textarea = screen.getByRole('textbox');
      await userEvent.type(textarea, 'Create a pipeline');
      await userEvent.keyboard('{Enter}');

      await waitFor(() => {
        expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('should show placeholder message when no messages', () => {
      render(<ChatPanel />);

      expect(screen.getByText(/Describe your pipeline in natural language/)).toBeInTheDocument();
      expect(screen.getByText(/e.g. "Check API every 5 minutes and notify Discord on error"/)).toBeInTheDocument();
    });

    it('should not show placeholder after sending message', async () => {
      mockInvoke.mockResolvedValueOnce({ message: 'Done' });

      render(<ChatPanel />);

      const textarea = screen.getByRole('textbox');
      await userEvent.type(textarea, 'Create a pipeline');
      await userEvent.keyboard('{Enter}');

      await waitFor(() => {
        expect(screen.queryByText(/Describe your pipeline in natural language/)).not.toBeInTheDocument();
      });
    });
  });
});
