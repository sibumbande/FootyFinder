BEGIN;

CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE');
CREATE TYPE "CitySupportStatus" AS ENUM ('ACTIVE', 'WAITLIST');
CREATE TYPE "LegalDocumentType" AS ENUM ('TERMS', 'PRIVACY', 'PARTICIPATION', 'CODE_OF_CONDUCT', 'COMPANY_DISCLOSURE');
CREATE TYPE "VerificationPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'EMAIL_CHANGE');
CREATE TYPE "VerificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
CREATE TYPE "ResultOutcomeType" AS ENUM ('PLAYED', 'FORFEIT');

ALTER TABLE "MatchResult"
  ADD COLUMN "outcomeType" "ResultOutcomeType" NOT NULL DEFAULT 'PLAYED',
  ADD COLUMN "forfeitWinner" "TeamSide";
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_forfeit_consistency_check"
  CHECK (("outcomeType" = 'PLAYED' AND "forfeitWinner" IS NULL) OR ("outcomeType" = 'FORFEIT' AND "forfeitWinner" IS NOT NULL));

ALTER TABLE "User"
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "emailVerificationRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3),
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
ALTER TABLE "User" ALTER COLUMN "emailVerificationRequired" SET DEFAULT true;

ALTER TABLE "PlayerProfile"
  ADD COLUMN "dateOfBirth" DATE,
  ADD COLUMN "yearsExperience" INTEGER,
  ADD COLUMN "cityId" UUID,
  ADD COLUMN "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED';

ALTER TABLE "PlayerProfile"
  ADD CONSTRAINT "PlayerProfile_yearsExperience_check"
  CHECK ("yearsExperience" IS NULL OR "yearsExperience" BETWEEN 0 AND 60);

ALTER TABLE "PlayerPreferredPosition" ADD COLUMN "sortOrder" INTEGER;
WITH ordered AS (
  SELECT "profileId", "position",
         ROW_NUMBER() OVER (PARTITION BY "profileId" ORDER BY "position"::text) - 1 AS position_order
  FROM "PlayerPreferredPosition"
)
UPDATE "PlayerPreferredPosition" target
SET "sortOrder" = ordered.position_order
FROM ordered
WHERE target."profileId" = ordered."profileId"
  AND target."position" = ordered."position";
ALTER TABLE "PlayerPreferredPosition" ALTER COLUMN "sortOrder" SET NOT NULL;
ALTER TABLE "PlayerPreferredPosition" ADD CONSTRAINT "PlayerPreferredPosition_sortOrder_check"
  CHECK ("sortOrder" BETWEEN 0 AND 3);
CREATE UNIQUE INDEX "PlayerPreferredPosition_profileId_sortOrder_key"
  ON "PlayerPreferredPosition"("profileId", "sortOrder");

CREATE TABLE "City" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL DEFAULT 'ZA',
  "timezone" TEXT NOT NULL,
  "supportStatus" "CitySupportStatus" NOT NULL DEFAULT 'WAITLIST',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "City_code_key" ON "City"("code");
CREATE INDEX "City_supportStatus_name_idx" ON "City"("supportStatus", "name");

INSERT INTO "City" ("id", "code", "name", "timezone", "supportStatus", "updatedAt") VALUES
  ('10000000-0000-4000-8000-000000000001', 'CAPE_TOWN', 'Cape Town', 'Africa/Johannesburg', 'ACTIVE', CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000002', 'JOHANNESBURG', 'Johannesburg', 'Africa/Johannesburg', 'WAITLIST', CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000003', 'DURBAN', 'Durban', 'Africa/Johannesburg', 'WAITLIST', CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000004', 'PRETORIA', 'Pretoria', 'Africa/Johannesburg', 'WAITLIST', CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000005', 'GQEBERHA', 'Gqeberha', 'Africa/Johannesburg', 'WAITLIST', CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000006', 'BLOEMFONTEIN', 'Bloemfontein', 'Africa/Johannesburg', 'WAITLIST', CURRENT_TIMESTAMP);

ALTER TABLE "PlayerProfile"
  ADD CONSTRAINT "PlayerProfile_cityId_fkey"
  FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "PlayerProfile_cityId_onboardingStatus_idx"
  ON "PlayerProfile"("cityId", "onboardingStatus");

CREATE TABLE "CityInterest" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cityId" UUID NOT NULL,
  "userId" UUID,
  "email" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "manageTokenHash" TEXT NOT NULL,
  "consentedAt" TIMESTAMP(3) NOT NULL,
  "source" TEXT NOT NULL,
  "unsubscribedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CityInterest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CityInterest_dedupeKey_key" ON "CityInterest"("dedupeKey");
CREATE UNIQUE INDEX "CityInterest_manageTokenHash_key" ON "CityInterest"("manageTokenHash");
CREATE INDEX "CityInterest_cityId_consentedAt_idx" ON "CityInterest"("cityId", "consentedAt");
CREATE INDEX "CityInterest_userId_createdAt_idx" ON "CityInterest"("userId", "createdAt");
ALTER TABLE "CityInterest" ADD CONSTRAINT "CityInterest_cityId_fkey"
  FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CityInterest" ADD CONSTRAINT "CityInterest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LegalDocument" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "type" "LegalDocumentType" NOT NULL,
  "version" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "material" BOOLEAN NOT NULL DEFAULT true,
  "reacceptanceRequired" BOOLEAN NOT NULL DEFAULT true,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegalDocument_type_version_key" ON "LegalDocument"("type", "version");
CREATE INDEX "LegalDocument_type_publishedAt_effectiveAt_idx"
  ON "LegalDocument"("type", "publishedAt", "effectiveAt");

CREATE TABLE "LegalAcceptance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "legalDocumentId" UUID NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL,
  "ipHash" TEXT,
  "userAgentHash" TEXT,
  "evidence" JSONB NOT NULL,
  CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegalAcceptance_userId_legalDocumentId_key"
  ON "LegalAcceptance"("userId", "legalDocumentId");
CREATE INDEX "LegalAcceptance_userId_acceptedAt_idx"
  ON "LegalAcceptance"("userId", "acceptedAt");
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_legalDocumentId_fkey"
  FOREIGN KEY ("legalDocumentId") REFERENCES "LegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_legal_acceptance_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LegalAcceptance is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "LegalAcceptance_append_only"
BEFORE UPDATE OR DELETE ON "LegalAcceptance"
FOR EACH ROW EXECUTE FUNCTION "reject_legal_acceptance_mutation"();

CREATE FUNCTION "reject_published_legal_document_mutation"() RETURNS trigger AS $$
BEGIN
  IF OLD."publishedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Published LegalDocument versions are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "LegalDocument_published_immutable"
BEFORE UPDATE OR DELETE ON "LegalDocument"
FOR EACH ROW EXECUTE FUNCTION "reject_published_legal_document_mutation"();

CREATE TABLE "VerificationToken" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "purpose" "VerificationPurpose" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "targetEmail" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "deliveryStatus" "VerificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "deliveryError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VerificationToken_tokenHash_key" ON "VerificationToken"("tokenHash");
CREATE INDEX "VerificationToken_userId_purpose_createdAt_idx"
  ON "VerificationToken"("userId", "purpose", "createdAt");
CREATE INDEX "VerificationToken_email_purpose_createdAt_idx"
  ON "VerificationToken"("email", "purpose", "createdAt");
CREATE INDEX "VerificationToken_expiresAt_usedAt_idx"
  ON "VerificationToken"("expiresAt", "usedAt");
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PlayerPhoto" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "profileId" UUID NOT NULL,
  "fileKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "hiddenAt" TIMESTAMP(3),
  "hiddenReason" TEXT,
  "moderatedByUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlayerPhoto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlayerPhoto_dimensions_check" CHECK ("width" >= 256 AND "height" >= 256),
  CONSTRAINT "PlayerPhoto_byteSize_check" CHECK ("byteSize" > 0 AND "byteSize" <= 5242880)
);
CREATE UNIQUE INDEX "PlayerPhoto_profileId_key" ON "PlayerPhoto"("profileId");
CREATE UNIQUE INDEX "PlayerPhoto_fileKey_key" ON "PlayerPhoto"("fileKey");
CREATE INDEX "PlayerPhoto_hiddenAt_idx" ON "PlayerPhoto"("hiddenAt");
ALTER TABLE "PlayerPhoto" ADD CONSTRAINT "PlayerPhoto_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "PlayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerPhoto" ADD CONSTRAINT "PlayerPhoto_moderatedByUserId_fkey"
  FOREIGN KEY ("moderatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
