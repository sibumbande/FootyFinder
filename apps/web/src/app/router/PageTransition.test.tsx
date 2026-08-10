import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PageTransition } from './PageTransition.js';

describe('PageTransition', () => {
  it('remounts the animated page when the history location changes', async () => {
    let mounts = 0;
    function TestPage() {
      const navigate = useNavigate();
      useEffect(() => {
        mounts += 1;
      }, []);
      return <button onClick={() => navigate('/next')}>Next page</button>;
    }

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PageTransition>
          <TestPage />
        </PageTransition>
      </MemoryRouter>,
    );
    expect(mounts).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(mounts).toBe(2));
    expect(screen.getByRole('button', { name: 'Next page' }).parentElement).toHaveClass(
      'route-page-transition--push',
    );
  });
});
