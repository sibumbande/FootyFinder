import { TERMS_ACCEPTANCE_STATEMENT } from '@footy-finder/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const terms = {
  id: '00000000-0000-4000-8000-000000000001',
  type: 'TERMS',
  version: '2.4',
  title: 'Master Terms of Service, Privacy Notice and Participation Agreement',
  content: 'Terms',
  checksum: 'abc',
  effectiveAt: new Date('2026-10-01T00:00:00.000Z'),
  material: true,
  reacceptanceRequired: true,
  publishedAt: new Date('2026-10-01T00:00:00.000Z'),
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
};
const db = vi.hoisted(() => ({
  current: null as unknown,
  findFirst: vi.fn(),
  createMany: vi.fn(),
}));
vi.mock('../../database/prisma.js', () => ({
  prisma: {
    legalDocument: { findFirst: db.findFirst },
    legalAcceptance: { createMany: db.createMany },
  },
}));

const { OnboardingService } = await import('./onboarding.service.js');

beforeEach(() => {
  db.findFirst.mockReset().mockImplementation(async () => db.current);
  db.createMany.mockReset().mockResolvedValue({ count: 1 });
  db.current = terms;
});

describe('single Terms document (CEO ToS review Q1)', () => {
  it('only ever reads the latest effective TERMS document; retired types are ignored', async () => {
    expect(await new OnboardingService().currentLegalDocuments()).toEqual([terms]);
    expect(db.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ type: 'TERMS' }) }));
    db.current = null;
    expect(await new OnboardingService().currentLegalDocuments()).toEqual([]);
  });

  it('records one acceptance with the version, checksum, checkbox statement and hashed IP and device', async () => {
    const service = new OnboardingService();
    vi.spyOn(service, 'status').mockResolvedValue({} as never);
    await service.acceptLegal('user-1', { documentIds: [terms.id], source: 'PROFILE_COMPLETION' }, { ip: '198.51.100.7', userAgent: 'Browser/1' });
    const [row] = db.createMany.mock.calls[0]![0].data;
    expect(row).toMatchObject({
      userId: 'user-1',
      legalDocumentId: terms.id,
      evidence: { documentType: 'TERMS', version: '2.4', checksum: 'abc', statement: TERMS_ACCEPTANCE_STATEMENT },
    });
    expect(row.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.ipHash).not.toContain('198.51');
    expect(row.userAgentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuses an acceptance that is not for the current Terms', async () => {
    await expect(
      new OnboardingService().acceptLegal('user-1', { documentIds: ['00000000-0000-4000-8000-000000000009'], source: 'REACCEPTANCE' }, {}),
    ).rejects.toMatchObject({ code: 'LEGAL_VERSION_MISMATCH' });
    expect(db.createMany).not.toHaveBeenCalled();
  });
});
