import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { LEGAL_DOCUMENT_TYPES } from '@footy-finder/shared';
import { z } from 'zod';
import { prisma } from '../src/database/prisma.js';

/**
 * Publishes the legal document set (CEO Q1: exactly one TERMS document, which includes the Privacy
 * Notice and the Participation Agreement). Each row gives its text either inline (`content`) or as
 * `contentFile`, a path relative to the JSON file (e.g. docs/legal/legal-launch.json points at
 * TERMS_OF_SERVICE.md). `effectiveAt` is an ISO date-time, or "on-publish" for "effective the moment
 * it is published". Versions are immutable: re-running with the same text is a no-op, and different
 * text for a published version is refused.
 */
const rowSchema = z
  .object({
    type: z.enum(LEGAL_DOCUMENT_TYPES),
    version: z.string().trim().min(1).max(50),
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).optional(),
    contentFile: z.string().trim().min(1).optional(),
    effectiveAt: z.union([z.string().datetime(), z.literal('on-publish')]),
    material: z.boolean(),
    reacceptanceRequired: z.boolean(),
  })
  .refine((row) => Boolean(row.content) !== Boolean(row.contentFile), 'Give either content or contentFile');
const inputSchema = z.array(rowSchema).length(LEGAL_DOCUMENT_TYPES.length).refine(
  (rows) => new Set(rows.map(({ type }) => type)).size === LEGAL_DOCUMENT_TYPES.length,
  'Supply exactly one document for every legal document type',
);

const fileIndex = process.argv.indexOf('--file');
if (fileIndex < 0 || !process.argv[fileIndex + 1])
  throw new Error('Usage: npm run legal:publish --workspace=@footy-finder/api -- --file <approved-documents.json>');

const file = resolve(process.argv[fileIndex + 1]!);
const rows = inputSchema.parse(JSON.parse(await readFile(file, 'utf8')));
for (const { contentFile, content: inline, effectiveAt, ...row } of rows) {
  const content = (inline ?? (await readFile(resolve(dirname(file), contentFile!), 'utf8'))).trim();
  const checksum = createHash('sha256').update(content, 'utf8').digest('hex');
  const existing = await prisma.legalDocument.findUnique({
    where: { type_version: { type: row.type, version: row.version } },
  });
  if (existing) {
    if (existing.checksum !== checksum) throw new Error(`Published ${row.type} ${row.version} has a different checksum`);
    continue;
  }
  const publishedAt = new Date();
  await prisma.legalDocument.create({
    data: { ...row, content, checksum, effectiveAt: effectiveAt === 'on-publish' ? publishedAt : new Date(effectiveAt), publishedAt },
  });
}
await prisma.$disconnect();
console.log(`Published ${rows.length} immutable legal document version(s).`);
