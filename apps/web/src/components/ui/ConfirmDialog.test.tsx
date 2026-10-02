import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConfirm, type ConfirmRequest, type ConfirmResult } from './ConfirmDialog.js';

let result: ConfirmResult | undefined;
function Harness(request: ConfirmRequest) {
  const { confirm, confirmDialog } = useConfirm();
  return (
    <>
      <button type="button" onClick={async () => { result = await confirm(request); }}>Open</button>
      {confirmDialog}
    </>
  );
}
const open = (request: Partial<ConfirmRequest> = {}) => {
  render(<Harness title="Cancel this match?" message={<p>Everyone is told.</p>} confirmLabel="Cancel match" cancelLabel="Keep match" destructive {...request} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  return screen.getByTestId('confirm-dialog');
};

afterEach(() => {
  cleanup();
  result = undefined;
});

describe('ConfirmDialog (batch 5 brief, B2)', () => {
  it('shows the title and consequences, focuses the safe button and resolves on the choice', async () => {
    const dialog = open();
    expect(dialog).toHaveAttribute('role', 'alertdialog');
    expect(screen.getByRole('alertdialog', { name: 'Cancel this match?' })).toHaveAccessibleDescription('Everyone is told.');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep match' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel match' })));
    expect(result).toEqual({ confirmed: true, reason: '' });
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('closes with Escape and with the back button, as a "no"', async () => {
    let dialog = open();
    await act(async () => fireEvent.keyDown(dialog, { key: 'Escape' }));
    expect(result).toEqual({ confirmed: false, reason: '' });
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    cleanup();
    result = undefined;
    dialog = open();
    await act(async () => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(result).toEqual({ confirmed: false, reason: '' });
  });

  it('keeps Tab inside the dialog', () => {
    const dialog = open();
    const keep = screen.getByRole('button', { name: 'Keep match' });
    const go = screen.getByRole('button', { name: 'Cancel match' });
    go.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(keep);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(go);
  });

  it('shows a loading state while the action runs and its error inline, staying open', async () => {
    let fail: (error: Error) => void = () => undefined;
    const action = vi.fn(() => new Promise((_, reject) => { fail = reject; }));
    open({ action });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel match' }));
    expect(screen.getByRole('button', { name: 'Cancel match' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep match' })).toBeDisabled();
    await act(async () => fail(new Error('The lobby is locked.')));
    expect(screen.getByRole('alert')).toHaveTextContent('The lobby is locked.');
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    expect(result).toBeUndefined();
  });

  it('asks for a reason when needed and passes it to the action', async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    open({ reason: { label: 'Why?', required: true }, action });
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel match' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Why? is required.');
    expect(action).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Why?'), { target: { value: ' Injured ' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel match' })));
    expect(action).toHaveBeenCalledWith('Injured');
    expect(result).toEqual({ confirmed: true, reason: 'Injured' });
  });
});
