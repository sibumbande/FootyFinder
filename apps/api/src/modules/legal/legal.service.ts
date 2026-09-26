import type { LegalDocumentSummary, LegalDocumentType } from '@footy-finder/shared';
import { AppError } from '../../errors/app-error.js';
import { OnboardingService } from '../onboarding/onboarding.service.js';

const toDto = (document: Awaited<ReturnType<OnboardingService['currentLegalDocuments']>>[number]): LegalDocumentSummary => ({
  id: document.id,
  type: document.type,
  version: document.version,
  title: document.title,
  content: document.content,
  checksum: document.checksum,
  effectiveAt: document.effectiveAt.toISOString(),
  material: document.material,
  reacceptanceRequired: document.reacceptanceRequired,
});

export class LegalService {
  constructor(private readonly onboarding = new OnboardingService()) {}
  async listCurrent() {
    return (await this.onboarding.currentLegalDocuments()).map(toDto);
  }
  async getCurrent(type: LegalDocumentType) {
    const document = (await this.onboarding.currentLegalDocuments()).find((row) => row.type === type);
    if (!document)
      throw new AppError(404, 'Approved legal content is not available yet.', 'LEGAL_DOCUMENT_NOT_AVAILABLE');
    return toDto(document);
  }
}
