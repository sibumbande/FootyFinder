import { prisma } from '../src/database/prisma.js';

type CountRow = { count: bigint };

const [futureNinetyMinuteMatches, invalidTeamCodes, duplicateTeamCodes, persistedFullMatches] =
  await Promise.all([
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Match"
      WHERE "durationMinutes" = 90
        AND "startsAt" > CURRENT_TIMESTAMP
        AND "status"::text IN ('DRAFT', 'OPEN', 'READY', 'FULL')
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Team"
      WHERE "shortName" IS NOT NULL
        AND (
          UPPER("shortName") !~ '^[A-Z0-9]{1,4}$'
          OR "shortName" <> UPPER("shortName")
        )
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT UPPER("shortName")
        FROM "Team"
        WHERE "shortName" IS NOT NULL
        GROUP BY UPPER("shortName")
        HAVING COUNT(*) > 1
      ) duplicates
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Match"
      WHERE "status"::text = 'FULL'
    `,
  ]);

const report = {
  futureNinetyMinuteMatches: Number(futureNinetyMinuteMatches[0]?.count ?? 0n),
  invalidTeamCodes: Number(invalidTeamCodes[0]?.count ?? 0n),
  duplicateTeamCodes: Number(duplicateTeamCodes[0]?.count ?? 0n),
  persistedFullMatches: Number(persistedFullMatches[0]?.count ?? 0n),
};

console.log(JSON.stringify(report, null, 2));
await prisma.$disconnect();

if (
  report.futureNinetyMinuteMatches ||
  report.invalidTeamCodes ||
  report.duplicateTeamCodes ||
  report.persistedFullMatches
) {
  console.error('Gate 1 data remediation is required before the final constraints are active.');
  process.exitCode = 2;
}
