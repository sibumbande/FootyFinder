import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nameVariants } from '@/utils/short-name.js';
import { PlayerName } from './PlayerName.js';

// CEO touch-up batch 4, item 5: names always fit their box.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Pretends the box is `room` characters wide: a name overflows when it has more characters than that. */
const boxFits = (room: number) => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => room * 10);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return (this.textContent ?? '').length * 10;
  });
};

describe('player names in tight spaces', () => {
  it('offers the full name, then first name + surname initial, then the first name', () => {
    expect(nameVariants('Sibulele Obakhe  Mbande')).toEqual(['Sibulele Obakhe Mbande', 'Sibulele M.', 'Sibulele']);
    expect(nameVariants('Lungelo Extraordinarily-Longsurname')).toEqual(['Lungelo Extraordinarily-Longsurname', 'Lungelo E.', 'Lungelo']);
    expect(nameVariants('Neo')).toEqual(['Neo']);
  });

  it('shows the full name when it fits', () => {
    boxFits(40);
    render(<PlayerName name="Sibulele Mbande" />);
    expect(screen.getByTestId('player-name')).toHaveTextContent('Sibulele Mbande');
    expect(screen.getByTestId('player-name').parentElement).not.toHaveAttribute('title');
  });

  it('falls back to "First L." and keeps the full name for hover, screen readers and tap', () => {
    boxFits(12);
    render(<PlayerName name="Sibulele Obakhe Mbande" revealOnTap />);
    const name = screen.getByTestId('player-name');
    expect(name.parentElement).toHaveAttribute('title', 'Sibulele Obakhe Mbande');
    expect(name).toHaveAttribute('aria-hidden', 'true');
    expect(name).toHaveTextContent('Sibulele M.');
    expect(name.parentElement!.querySelector('.sr-only')).toHaveTextContent('Sibulele Obakhe Mbande');
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sibulele Obakhe Mbande');
  });

  it('uses the first name alone when even the initial does not fit', () => {
    boxFits(9);
    render(<PlayerName name="Sibulele Obakhe Mbande" />);
    expect(screen.getByTestId('player-name')).toHaveTextContent(/^Sibulele$/);
  });
});
