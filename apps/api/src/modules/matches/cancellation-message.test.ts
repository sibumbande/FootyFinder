import { describe, expect, it } from 'vitest';
import { formatKickoffTime, formatMatchDate, matchCancelledMessage } from './cancellation-message.js';

const startsAt = new Date('2026-10-30T12:00:00.000Z'); // 14:00 in Cape Town

describe('matchCancelledMessage', () => {
  it('formats the date and kickoff in South African time', () => {
    expect(formatMatchDate(startsAt)).toBe('Fri 30 Oct 2026');
    expect(formatKickoffTime(startsAt)).toBe('14:00');
  });

  it('explains a T-30 auto-cancel and the refund', () => {
    expect(
      matchCancelledMessage({ venueName: 'Italian Club', startsAt, reason: 'POSITIONS_UNFILLED', refundedCents: 8000 }),
    ).toBe(
      'Your match at Italian Club on Fri 30 Oct 2026 at 14:00 was cancelled because not every position was filled 30 minutes before kickoff. Your R80 has been refunded to your FootyFinder wallet.',
    );
  });

  it('explains a host cancellation and the refund', () => {
    expect(
      matchCancelledMessage({ venueName: 'Queens Park', startsAt, reason: 'ORGANISER_CANCELLED', refundedCents: 8000 }),
    ).toBe(
      'Your match at Queens Park on Fri 30 Oct 2026 at 14:00 was cancelled by the host. Your R80 has been refunded to your FootyFinder wallet.',
    );
  });

  it('leaves out the refund sentence for someone who paid nothing, like a host who did not play', () => {
    expect(
      matchCancelledMessage({ venueName: 'Italian Club', startsAt, reason: 'POSITIONS_UNFILLED', refundedCents: 0 }),
    ).toBe(
      'Your match at Italian Club on Fri 30 Oct 2026 at 14:00 was cancelled because not every position was filled 30 minutes before kickoff.',
    );
  });

  it('shows cents only when a legacy fee needs them', () => {
    expect(
      matchCancelledMessage({ venueName: 'X', startsAt, reason: 'ORGANISER_CANCELLED', refundedCents: 4550 }),
    ).toContain('Your R45.50 has been refunded');
  });
});
