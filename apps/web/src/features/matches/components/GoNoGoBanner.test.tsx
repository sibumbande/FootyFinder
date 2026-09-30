import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formatGoNoGoTime, GoNoGoBanner } from './GoNoGoBanner.js';

afterEach(cleanup);

// Kickoff 30 Oct 2026 14:00 SAST -> go/no-go at 13:30 SAST (11:30Z).
const goNoGoAt = '2026-10-30T11:30:00.000Z';
const kickoff = '2026-10-30T12:00:00.000Z';
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
      "This match goes ahead only if all positions are filled and a FootyFinder referee is assigned by 13:30 on 30 Oct 2026. Otherwise it's cancelled and your R80 is refunded to your wallet.",
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

  it('explains the automatic cancellation with venue, date and kickoff, as in the alert', () => {
    render(
      <GoNoGoBanner
        facts={{ goNoGoAt, cancellationReason: 'POSITIONS_UNFILLED' }}
        status="CANCELLED"
        feeCents={8_000}
        filled={8}
        total={10}
        venueName="Italian Club"
        startsAt={kickoff}
        viewerJoined
        now={after}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Cancelled: not every position was filled');
    expect(screen.getByRole('status')).toHaveTextContent(
      'This match at Italian Club on Fri 30 Oct 2026 at 14:00 was cancelled because not every position was filled 30 minutes before kickoff. Your R80 has been refunded to your FootyFinder wallet.',
    );
  });

  it('explains a Gate 8 cancellation because no referee was available', () => {
    render(
      <GoNoGoBanner
        facts={{ goNoGoAt, cancellationReason: 'NO_REFEREE' }}
        status="CANCELLED"
        feeCents={8_000}
        filled={10}
        total={10}
        venueName="Queens Park"
        startsAt={kickoff}
        viewerJoined
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Cancelled: no referee was available');
    expect(screen.getByRole('status')).toHaveTextContent(
      'This match at Queens Park on Fri 30 Oct 2026 at 14:00 was cancelled because no FootyFinder referee was available. Your R80 has been refunded to your FootyFinder wallet.',
    );
  });

  it('explains a host cancellation, including to viewers who did not join', () => {
    render(
      <GoNoGoBanner
        facts={{ goNoGoAt, cancellationReason: 'ORGANISER_CANCELLED' }}
        status="CANCELLED"
        feeCents={8_000}
        filled={2}
        total={10}
        venueName="Queens Park"
        startsAt={kickoff}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Cancelled by the host');
    expect(screen.getByRole('status')).toHaveTextContent(
      "This match at Queens Park on Fri 30 Oct 2026 at 14:00 was cancelled by the host. Every player's R80 has been refunded to their FootyFinder wallet.",
    );
  });

  it('explains a host cancellation of a legacy match without a go/no-go time', () => {
    render(
      <GoNoGoBanner
        facts={{ cancellationReason: 'ORGANISER_CANCELLED' }}
        status="CANCELLED"
        feeCents={4_550}
        filled={0}
        total={10}
        venueName="Queens Park"
        startsAt={kickoff}
        viewerJoined
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('was cancelled by the host. Your R45.50 has been refunded');
  });

  it('renders nothing for an open legacy match', () => {
    const { container } = render(
      <GoNoGoBanner facts={{}} status="OPEN" feeCents={2_000} filled={0} total={10} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
