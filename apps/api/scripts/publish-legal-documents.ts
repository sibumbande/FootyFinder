import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LEGAL_DOCUMENT_TYPES } from '@footy-finder/shared';
import { z } from 'zod';
import { prisma } from '../src/database/prisma.js';

const inputSchema = z.array(z.object({
  type: z.enum(LEGAL_DOCUMENT_TYPES),
  version: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1),
  effectiveAt: z.string().datetime(),
  material: z.boolean(),
  reacceptanceRequired: z.boolean(),
})).length(LEGAL_DOCUMENT_TYPES.length).refine(
  (rows) => new Set(rows.map(({ type }) => type)).size === LEGAL_DOCUMENT_TYPES.length,
  'Supply exactly one document for every legal document type',
);

const fileIndex = process.argv.indexOf('--file');
if (fileIndex < 0 || !process.argv[fileIndex + 1])
  throw new Error('Usage: npm run legal:publish --workspace=@footy-finder/api -- --file <approved-documents.json>');

const rows = inputSchema.parse(JSON.parse(await readFile(resolve(process.argv[fileIndex + 1]!), 'utf8')));
for (const row of rows) {
  const checksum = createHash('sha256').update(row.content, 'utf8').digest('hex');
  const existing = await prisma.legalDocument.findUnique({
    where: { type_version: { type: row.type, version: row.version } },
  });
  if (existing) {
    if (existing.checksum !== checksum) throw new Error(`Published ${row.type} ${row.version} has a different checksum`);
    continue;
  }
  await prisma.legalDocument.create({
    data: { ...row, checksum, effectiveAt: new Date(row.effectiveAt), publishedAt: new Date() },
  });
}
await prisma.$disconnect();
console.log(`Published ${rows.length} immutable legal document versions.`);
