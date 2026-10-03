import { describe, expect, it } from 'vitest';
import { TestEmailProvider } from '../auth/email.provider.js';
import { sendMatchCancelledEmail } from './match-cancelled-email.jobs.js';

const startsAt = new Date('2026-10-30T12:00:00.000Z');
const store = (status = 'CANCELLED', cancellationReason: string | null = 'POSITIONS_UNFILLED') => ({
  findMatch: async () => ({ status, startsAt, cancellationReason, venue: { name: 'Italian Club' } }),
  findEmail: async () => 'player@example.test',
});

describe('sendMatchCancelledEmail', () => {
  it('sends one email with the same wording as the in-app notification', async () => {
    const emails = new TestEmailProvider();
    await sendMatchCancelledEmail({ matchId: 'm1', userId: 'u1', choiceSeats: 1, choiceCents: 8000 }, emails, store());
    expect(emails.messages).toHaveLength(1);
    expect(emails.messages[0]).toMatchObject({
      to: 'player@example.test',
      subject: 'Your FootyFinder match was cancelled',
    });
    expect(emails.messages[0]!.text).toContain(
      'Your match at Italian Club on Fri 30 Oct 2026 at 14:00 was cancelled because not every position was filled 30 minutes before kickoff. You paid R80 for this match: choose 1 match credit or a full refund',
    );
    expect(emails.messages[0]!.text).toContain('/matches/m1');
  });

  it('uses the host-cancel wording', async () => {
    const emails = new TestEmailProvider();
    await sendMatchCancelledEmail(
      { matchId: 'm1', userId: 'u1', choiceSeats: 1, choiceCents: 8000 },
      emails,
      store('CANCELLED', 'ORGANISER_CANCELLED'),
    );
    expect(emails.messages[0]!.text).toContain('was cancelled by the host. You paid R80 for this match');
  });

  it('sends nothing when the match is not cancelled', async () => {
    const emails = new TestEmailProvider();
    await sendMatchCancelledEmail({ matchId: 'm1', userId: 'u1', choiceSeats: 1, choiceCents: 8000 }, emails, store('OPEN', null));
    expect(emails.messages).toHaveLength(0);
  });

  it('rejects a malformed payload so the queue records it', async () => {
    await expect(sendMatchCancelledEmail({ matchId: 'm1' }, new TestEmailProvider(), store())).rejects.toMatchObject({
      code: 'JOB_PAYLOAD_INVALID',
    });
  });
});
