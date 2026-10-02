import { kitColourByHex, nearestKitColour } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { appendAdminAudit } from '../src/modules/admin/admin-audit.js';

/**
 * Batch 5 brief, B1 (CEO D17): a one-off move of every team's saved kit colours onto the kit colour list, each to its
 * nearest swatch (perceptual distance). A dry run by default; `--apply` writes the change and one audit entry per
 * team (TEAM_KIT_COLOURS_MAPPED, with the old and new colours). Colour snapshots of past matches are history and are
 * left as they are. Safe to run again: teams already on the list are skipped.
 *
 *   npm run teams:map-kit-colours            # dry run: lists what would change
 *   npm run teams:map-kit-colours -- --apply # writes it
 */
const apply = process.argv.includes('--apply');
const teams = await prisma.team.findMany({ select: { id: true, name: true, primaryColor: true, secondaryColor: true }, orderBy: { createdAt: 'asc' } });
// Already a list colour, stored exactly as the list writes it (capitals).
const onList = (value: string | null) => value === null || kitColourByHex(value)?.hex === value;
const changes = teams
  .filter((team) => !onList(team.primaryColor) || !onList(team.secondaryColor))
  .map((team) => ({
    ...team,
    newPrimary: team.primaryColor === null ? null : nearestKitColour(team.primaryColor).hex,
    newSecondary: team.secondaryColor === null ? null : nearestKitColour(team.secondaryColor).hex,
  }));

for (const change of changes) {
  const name = (hex: string | null) => (hex ? `${nearestKitColour(hex).name} ${hex}` : 'none');
  console.log(`${change.name}: ${change.primaryColor ?? 'none'} / ${change.secondaryColor ?? 'none'} -> ${name(change.newPrimary)} / ${name(change.newSecondary)}`);
  if (!apply) continue;
  await prisma.$transaction(async (tx) => {
    await tx.team.update({ where: { id: change.id }, data: { primaryColor: change.newPrimary, secondaryColor: change.newSecondary } });
    await appendAdminAudit(tx, {
      action: 'TEAM_KIT_COLOURS_MAPPED',
      entityType: 'TEAM',
      entityId: change.id,
      metadata: { from: [change.primaryColor, change.secondaryColor], to: [change.newPrimary, change.newSecondary] },
    });
  });
}
console.log(`${changes.length} of ${teams.length} teams ${apply ? 'moved onto' : 'would move onto'} the kit colour list.${apply || !changes.length ? '' : ' Run again with --apply to write it.'}`);
await prisma.$disconnect();
