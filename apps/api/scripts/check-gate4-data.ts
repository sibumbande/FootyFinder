import { prisma } from '../src/database/prisma.js';

interface CountRow {
  count: bigint;
}

const [missingOrInvalidPublic, exposedPrivate, duplicates] = await Promise.all([
  prisma.$queryRaw<CountRow[]>`
    SELECT count(*)::bigint AS count
    FROM "Match"
    WHERE "visibility" = 'PUBLIC'
      AND ("publicSlug" IS NULL OR "publicSlug" !~ '^m-[a-f0-9]{24}$')
  `,
  prisma.$queryRaw<CountRow[]>`
    SELECT count(*)::bigint AS count
    FROM "Match"
    WHERE "visibility" = 'PRIVATE' AND "publicSlug" IS NOT NULL
  `,
  prisma.$queryRaw<CountRow[]>`
    SELECT count(*)::bigint AS count
    FROM (
      SELECT "publicSlug"
      FROM "Match"
      WHERE "publicSlug" IS NOT NULL
      GROUP BY "publicSlug"
      HAVING count(*) > 1
    ) duplicate_slugs
  `,
]);

const report = {
  checkedAt: new Date().toISOString(),
  publicMissingOrInvalid: Number(missingOrInvalidPublic[0]?.count ?? 0),
  privateWithPublicSlug: Number(exposedPrivate[0]?.count ?? 0),
  duplicatePublicSlugs: Number(duplicates[0]?.count ?? 0),
};

console.log(JSON.stringify(report, null, 2));
await prisma.$disconnect();

if (Object.values(report).some((value) => typeof value === 'number' && value > 0)) {
  console.error('Gate 4 public identifier invariants are not release-ready.');
  process.exitCode = 2;
}
