import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MatchListPage } from './MatchListPage.js';

const mocks = vi.hoisted(() => ({ useMatches: vi.fn() }));
vi.mock('../hooks/useMatches.js', () => ({ useMatches: mocks.useMatches }));

describe('MatchListPage', () => {
  it('uses only supported discovery filters and never requests browser location', () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    mocks.useMatches.mockReturnValue({ isPending: false, data: [], error: null });

    render(
      <MemoryRouter>
        <MatchListPage />
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText(/Maximum price/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Find nearby/i })).not.toBeInTheDocument();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(mocks.useMatches).toHaveBeenCalledWith({
      format: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      availableOnly: true,
    });
  });
});
