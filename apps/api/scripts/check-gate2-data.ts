import { prisma } from '../src/database/prisma.js';

type CountRow = { count: bigint };
const [publishedLegalTypes, legacyIncomplete, newIncomplete, invalidProfiles, unsupportedActiveProfiles, failedEmails] = await Promise.all([
  prisma.$queryRaw<CountRow[]>`SELECT COUNT(DISTINCT "type")::bigint AS count FROM "LegalDocument" WHERE "publishedAt" <= CURRENT_TIMESTAMP AND "effectiveAt" <= CURRENT_TIMESTAMP`,
  prisma.$queryRaw<CountRow[]>`SELECT COUNT(*)::bigint AS count FROM "User" WHERE "emailVerificationRequired" = false AND "onboardingCompletedAt" IS NULL AND "isTestAccount" = false`,
  prisma.$queryRaw<CountRow[]>`SELECT COUNT(*)::bigint AS count FROM "User" WHERE "emailVerificationRequired" = true AND "onboardingCompletedAt" IS NULL AND "isTestAccount" = false`,
  prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS count FROM "PlayerProfile"
    WHERE ("yearsExperience" IS NOT NULL AND ("yearsExperience" < 0 OR "yearsExperience" > 60))
       OR ("dateOfBirth" IS NOT NULL AND "dateOfBirth" > (CURRENT_DATE - INTERVAL '18 years')::date)
  `,
  prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS count FROM "PlayerProfile" profile
    JOIN "City" city ON city."id" = profile."cityId"
    WHERE profile."onboardingStatus" = 'COMPLETE' AND city."supportStatus" <> 'ACTIVE'
  `,
  prisma.$queryRaw<CountRow[]>`SELECT COUNT(*)::bigint AS count FROM "VerificationToken" WHERE "deliveryStatus" = 'FAILED' AND "createdAt" > CURRENT_TIMESTAMP - INTERVAL '24 hours'`,
]);

const count = (rows: CountRow[]) => Number(rows[0]?.count ?? 0n);
const report = {
  publishedLegalTypes: count(publishedLegalTypes),
  requiredLegalTypes: 5,
  legacyUsersAwaitingCompletion: count(legacyIncomplete),
  newUsersAwaitingCompletion: count(newIncomplete),
  invalidProfiles: count(invalidProfiles),
  completedProfilesInUnsupportedCities: count(unsupportedActiveProfiles),
  failedEmailDeliveriesLast24Hours: count(failedEmails),
};
console.log(JSON.stringify(report, null, 2));
await prisma.$disconnect();
if (report.publishedLegalTypes !== report.requiredLegalTypes || report.invalidProfiles || report.completedProfilesInUnsupportedCities)
  process.exitCode = 2;
