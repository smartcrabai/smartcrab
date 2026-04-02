import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Header from './Header';

describe('Header', () => {
  describe('discord status indicator', () => {
    it('should show "Discord: Active" when discordActive is true', () => {
      // Given: discordActive is true
      // When: Header renders
      render(<Header title="Pipelines" discordActive={true} />);
      // Then: active status is displayed
      expect(screen.getByText(/Discord: Active/)).toBeInTheDocument();
    });

    it('should show "Discord: Inactive" when discordActive is false', () => {
      // Given: discordActive is false
      render(<Header title="Pipelines" discordActive={false} />);
      // Then: inactive status is displayed
      expect(screen.getByText(/Discord: Inactive/)).toBeInTheDocument();
    });

    it('should show "Discord: Inactive" when discordActive is undefined', () => {
      // Given: discordActive is not provided
      render(<Header title="Pipelines" />);
      // Then: inactive status is displayed (default)
      expect(screen.getByText(/Discord: Inactive/)).toBeInTheDocument();
    });
  });

  describe('title display', () => {
    it('should display the provided title', () => {
      render(<Header title="Settings" />);
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('should display different titles correctly', () => {
      render(<Header title="Execution History" />);
      expect(screen.getByText('Execution History')).toBeInTheDocument();
    });
  });
});
