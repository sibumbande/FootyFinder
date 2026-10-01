import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionMenu, menuItemClass } from './ActionMenu.js';

afterEach(cleanup);

// CEO touch-up batch 3, item 9.
describe('ActionMenu', () => {
  it('opens a menu of items, closes after a choice, and closes on Escape', () => {
    const remove = vi.fn();
    render(
      <ActionMenu label="More actions for Thabo">
        {(close) => <button type="button" role="menuitem" className={menuItemClass} onClick={() => { close(); remove(); }}>Remove friend</button>}
      </ActionMenu>,
    );
    const trigger = screen.getByRole('button', { name: 'More actions for Thabo' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove friend' }));
    expect(remove).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
