import { createHash } from 'node:crypto';
import { TERMS_ACCEPTANCE_STATEMENT, type LegalAcceptanceInput, type OnboardingProfileInput } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../errors/app-error.js';
import { env } from '../../config/env.js';
import { toAuthenticatedUser } from '../users/user.mapper.js';
import { safeUserInclude } from '../users/users.repository.js';

type OnboardingUser = Prisma.UserGetPayload<{ include: typeof safeUserInclude }>;

export interface AcceptanceMetadata {
  ip?: string;
  userAgent?: string;
}

const privacyHash = (value: string | undefined) =>
  value ? createHash('sha256').update(value).digest('hex') : undefined;

export class OnboardingService {
  async status(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: safeUserInclude });
    if (!user) throw new AppError(404, 'Account not found.', 'ACCOUNT_NOT_FOUND');
    const legal = await this.legalState(
      userId,
      Boolean(user.onboardingCompletedAt),
      user.isTestAccount && env.ADMIN_TEST_DATA_ENABLED && env.NODE_ENV !== 'production',
    );
    const missing = this.profileMissing(user).concat(legal.missing);
    return {
      user: toAuthenticatedUser(user),
      missing,
      canComplete: missing.length === 0,
      legalDocumentsAvailable: legal.available,
    };
  }

  async saveProfile(userId: string, input: OnboardingProfileInput) {
    const city = await prisma.city.findUnique({ where: { id: input.cityId } });
    if (!city) throw new AppError(400, 'Choose a supported city option.', 'CITY_INVALID');
    if (city.supportStatus !== 'ACTIVE')
      throw new AppError(409, 'Footy Finder is not active in that city yet.', 'CITY_NOT_SUPPORTED');
    await prisma.user.update({
      where: { id: userId },
      data: {
        profile: {
          update: {
            dateOfBirth: new Date(`${input.dateOfBirth}T00:00:00.000Z`),
            yearsExperience: input.yearsExperience,
            cityId: input.cityId,
            onboardingStatus: 'IN_PROGRESS',
            preferredPositions: {
              deleteMany: {},
              create: input.preferredPositions.map((position, sortOrder) => ({ position, sortOrder })),
            },
          },
        },
      },
    });
    return this.status(userId);
  }

  async acceptLegal(userId: string, input: LegalAcceptanceInput, metadata: AcceptanceMetadata) {
    const current = await this.currentLegalDocuments();
    if (!current.length)
      throw new AppError(503, 'Approved legal documents are not yet available.', 'LEGAL_DOCUMENTS_UNAVAILABLE');
    const expected = new Set(current.map(({ id }) => id));
    const supplied = new Set(input.documentIds);
    if (expected.size !== supplied.size || [...expected].some((id) => !supplied.has(id)))
      throw new AppError(409, 'Accept the current Terms of Service.', 'LEGAL_VERSION_MISMATCH');
    await prisma.legalAcceptance.createMany({
      data: current.map((document) => ({
        userId,
        legalDocumentId: document.id,
        source: input.source,
        ipHash: privacyHash(metadata.ip),
        userAgentHash: privacyHash(metadata.userAgent),
        evidence: {
          documentType: document.type,
          version: document.version,
          checksum: document.checksum,
          effectiveAt: document.effectiveAt.toISOString(),
          statement: TERMS_ACCEPTANCE_STATEMENT,
        },
      })),
      skipDuplicates: true,
    });
    return this.status(userId);
  }

  async complete(userId: string) {
    const state = await this.status(userId);
    if (state.missing.length)
      throw new AppError(409, 'Complete every onboarding requirement first.', 'ONBOARDING_INCOMPLETE', {
        missing: state.missing,
      });
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        onboardingCompletedAt: new Date(),
        profile: { update: { onboardingStatus: 'COMPLETE' } },
      },
      include: safeUserInclude,
    });
    return toAuthenticatedUser(user);
  }

  async assertProductAccess(userId: string) {
    const state = await this.status(userId);
    if (!state.user.onboardingComplete || state.missing.length)
      throw new AppError(403, 'Complete your player profile before using this action.', 'ONBOARDING_REQUIRED', {
        missing: state.missing,
      });
  }

  /**
   * CEO Q1: only the Terms of Service (which include the Privacy Notice and the Participation
   * Agreement) are published and required: the latest effective TERMS version, or nothing. Retired
   * document types stay in the database as history and are never returned.
   */
  async currentLegalDocuments() {
    const current = await prisma.legalDocument.findFirst({
      where: { type: 'TERMS', publishedAt: { not: null, lte: new Date() }, effectiveAt: { lte: new Date() } },
      orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
    });
    return current ? [{ ...current, type: 'TERMS' as const }] : [];
  }

  private profileMissing(typed: OnboardingUser) {
    return [
      ...(typed.emailVerificationRequired && !typed.emailVerifiedAt ? ['EMAIL_VERIFICATION'] : []),
      ...(!typed.profile?.dateOfBirth ? ['DATE_OF_BIRTH'] : []),
      ...(typed.profile?.yearsExperience === null || typed.profile?.yearsExperience === undefined ? ['EXPERIENCE'] : []),
      ...(typed.profile?.city?.supportStatus !== 'ACTIVE' ? ['CITY'] : []),
      ...(!typed.profile?.preferredPositions.length ? ['POSITIONS'] : []),
      ...(!typed.profile?.photo || typed.profile.photo.hiddenAt ? ['PHOTO'] : []),
    ];
  }

  private async legalState(userId: string, completed: boolean, disposableTestBypass = false) {
    if (disposableTestBypass) return { available: true, missing: [] as string[] };
    const current = await this.currentLegalDocuments();
    if (!current.length) return { available: false, missing: ['LEGAL_DOCUMENTS'] };
    const required = completed ? current.filter((document) => document.reacceptanceRequired) : current;
    const accepted = await prisma.legalAcceptance.findMany({
      where: { userId, legalDocumentId: { in: required.map(({ id }) => id) } },
      select: { legalDocumentId: true },
    });
    const ids = new Set(accepted.map(({ legalDocumentId }) => legalDocumentId));
    return {
      available: true,
      missing: required.some(({ id }) => !ids.has(id)) ? ['LEGAL_ACCEPTANCE'] : [],
    };
  }
}
