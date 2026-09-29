import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formatGoNoGoTime, GoNoGoBanner } from './GoNoGoBanner.js';

afterEach(cleanup);

// Kickoff 30 Oct 2026 14:00 SAST -> go/no-go at 13:30 SAST (11:30Z).
const goNoGoAt = '2026-10-30T11:30:00.000Z';
const before = new Date('2026-10-30T09:00:00.000Z');
const after = new Date('2026-10-30T11:45:00.000Z');

describe('GoNoGoBanner (DEC-018)', () => {
  it('formats the go/no-go time in South African time', () => {
    expect(formatGoNoGoTime(goNoGoAt)).toBe('13:30 on 30 Oct 2026');
  });

  it('explains the rule and shows the live position count before T-30', () => {
    render(
      <GoNoGoBanner facts={{ goNoGoAt }} status="OPEN" feeCents={8_000} filled={7} total={10} now={before} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      "This match goes ahead only if all positions are filled by 13:30 on 30 Oct 2026. Otherwise it's cancelled and your R80 is refunded to your wallet.",
    );
    expect(screen.getByTestId('positions-filled')).toHaveTextContent('7 of 10 positions filled');
    expect(screen.queryByText(/lineup is locked/)).not.toBeInTheDocument();
  });

  it('says the lineup is locked while the T-30 decision is pending', () => {
    render(
      <GoNoGoBanner facts={{ goNoGoAt }} status="OPEN" feeCents={8_000} filled={9} total={10} now={after} />,
    );
    expect(screen.getByText(/lineup is locked while positions are checked/)).toBeInTheDocument();
  });

  it('shows the confirmed outcome', () => {
    render(
      <GoNoGoBanner
        facts={{ goNoGoAt, confirmedAt: goNoGoAt }}
        status="OPEN"
        feeCents={8_000}
        filled={10}
        total={10}
        now={after}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Confirmed: all positions filled');
    expect(screen.getByTestId('positions-filled')).toHaveTextContent('10 of 10 positions filled');
  });

  it('shows the automatic cancellation and refund', () => {
    render(
      <GoNoGoBanner
        facts={{ goNoGoAt, cancellationReason: 'POSITIONS_UNFILLED' }}
        status="CANCELLED"
        feeCents={8_000}
        filled={8}
        total={10}
        now={after}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Not every position was filled by 13:30 on 30 Oct 2026, so this match was cancelled. Your R80 was refunded to your wallet.',
    );
  });

  it('renders nothing for legacy matches or an organiser cancellation', () => {
    const { container, rerender } = render(
      <GoNoGoBanner facts={{}} status="OPEN" feeCents={2_000} filled={0} total={10} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <GoNoGoBanner
        facts={{ goNoGoAt, cancellationReason: 'ORGANISER_CANCELLED' }}
        status="CANCELLED"
        feeCents={8_000}
        filled={0}
        total={10}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
