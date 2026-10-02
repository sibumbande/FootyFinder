import { KIT_COLOURS } from '@footy-finder/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { KitColourPicker } from './KitColourPicker.js';

function Harness({ initial = '#1E8E3E' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <KitColourPicker label="Main kit colour" value={value} onChange={setValue} preview={<span>mini preview</span>} />
      <output data-testid="value">{value}</output>
    </>
  );
}

afterEach(cleanup);

describe('KitColourPicker (batch 5 brief, B1)', () => {
  it('opens a sheet of named swatches with no text input, ticks the selected one and picks by tapping', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Main kit colour: Green. Change' }));
    const sheet = screen.getByRole('dialog', { name: 'Main kit colour' });
    expect(within(sheet).queryAllByRole('textbox')).toHaveLength(0);
    expect(sheet.querySelector('input')).toBeNull();
    const swatches = within(sheet).getAllByRole('radio');
    expect(swatches.map((swatch) => swatch.getAttribute('aria-label'))).toEqual(KIT_COLOURS.map(({ name }) => name));
    expect(within(sheet).getByRole('radio', { name: 'Green' })).toHaveAttribute('aria-checked', 'true');
    expect(within(sheet).getByText('mini preview')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Navy' }));
    expect(screen.getByTestId('value')).toHaveTextContent('#14213D');
    expect(within(sheet).getByRole('radio', { name: 'Navy' })).toHaveAttribute('aria-checked', 'true');
  });

  it('moves with the arrow keys and closes with Escape, returning focus to the button', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /Main kit colour/ });
    fireEvent.click(trigger);
    const sheet = screen.getByRole('dialog');
    expect(document.activeElement).toBe(within(sheet).getByRole('radio', { name: 'Green' }));
    fireEvent.keyDown(sheet, { key: 'ArrowRight' });
    expect(screen.getByTestId('value')).toHaveTextContent('#0B5D2A');
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('shows a colour saved before the list by its nearest kit colour name', () => {
    render(<Harness initial="#1D4ED8" />);
    expect(screen.getByRole('button', { name: 'Main kit colour: Royal blue. Change' })).toBeInTheDocument();
  });
});
