import { describe, expect, it } from 'vitest';
import { formatKickoffTime, formatMatchDate, matchCancelledMessage } from './cancellation-message.js';

const startsAt = new Date('2026-10-30T12:00:00.000Z'); // 14:00 in Cape Town

describe('matchCancelledMessage', () => {
  it('formats the date and kickoff in South African time', () => {
    expect(formatMatchDate(startsAt)).toBe('Fri 30 Oct 2026');
    expect(formatKickoffTime(startsAt)).toBe('14:00');
  });

  it('explains a T-30 auto-cancel and asks the payer to choose a credit or a refund (DEC-021 A3)', () => {
    expect(matchCancelledMessage({ venueName: 'Italian Club', startsAt, reason: 'POSITIONS_UNFILLED', choiceSeats: 1, choiceCents: 8000 })).toBe(
      "Your match at Italian Club on Fri 30 Oct 2026 at 14:00 was cancelled because not every position was filled 30 minutes before kickoff. You paid R80 for this match: choose 1 match credit or a full refund to the card or bank account you paid with. If you don't choose within 7 days, you're refunded automatically.",
    );
  });

  it('asks a payer of several places to choose for each one', () => {
    expect(matchCancelledMessage({ venueName: 'Queens Park', startsAt, reason: 'TEAM_UNPAID', choiceSeats: 3, choiceCents: 24_000 })).toBe(
      "Your match at Queens Park on Fri 30 Oct 2026 at 14:00 was cancelled because a team wasn't fully paid 2 hours before kickoff. You paid R240 for 3 places: choose a match credit or a full refund for each one. If you don't choose within 7 days, you're refunded automatically.",
    );
  });

  it('tells a credit payer their credit came back, and says nothing about money to someone who paid nothing', () => {
    expect(matchCancelledMessage({ venueName: 'X', startsAt, reason: 'ORGANISER_CANCELLED', creditsReturned: 1 })).toBe(
      'Your match at X on Fri 30 Oct 2026 at 14:00 was cancelled by the host. Your match credit has been returned to you.',
    );
    expect(matchCancelledMessage({ venueName: 'Italian Club', startsAt, reason: 'POSITIONS_UNFILLED' })).toBe(
      'Your match at Italian Club on Fri 30 Oct 2026 at 14:00 was cancelled because not every position was filled 30 minutes before kickoff.',
    );
  });

  it('explains team-match and FootyFinder cancellations without any wallet wording', () => {
    expect(matchCancelledMessage({ venueName: 'X', startsAt, reason: 'NO_OPPONENT' })).toContain("because the other side wasn't taken in time.");
    expect(matchCancelledMessage({ venueName: 'X', startsAt, reason: 'TEAM_CANCELLED' })).toContain('cancelled by the home team.');
    const footyFinder = matchCancelledMessage({ venueName: 'Italian Club', startsAt, reason: 'FOOTYFINDER_CANCELLED', choiceSeats: 1, choiceCents: 8000 });
    expect(footyFinder).toContain('cancelled by FootyFinder because of the weather or a problem at the venue. You paid R80');
    expect(footyFinder).not.toMatch(/wallet/i);
  });
});
