import 'dotenv/config';
import { assertDevMockTarget } from './dev-mock/guard.js';

// The safety lock runs before anything that can reach the database is loaded.
assertDevMockTarget();

const args = process.argv.slice(2);
const meIndex = args.indexOf('--me');
const me = meIndex >= 0 ? args[meIndex + 1] : undefined;
if (meIndex >= 0 && (!me || me.startsWith('--'))) {
  console.error('Usage: npm run dev:tickets-cutover -- [--me <your email>]');
  process.exit(1);
}

const { ticketsCutover } = await import('./dev-mock/tickets-cutover.js');
const { prisma } = await import('../src/database/prisma.js');
try {
  await ticketsCutover(me);
} catch (error) {
  console.error(`\nDEV ticketing cutover stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
