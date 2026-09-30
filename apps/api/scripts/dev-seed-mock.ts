import 'dotenv/config';
import { assertDevMockTarget } from './dev-mock/guard.js';

// The safety lock runs before anything that can reach the database is loaded.
assertDevMockTarget();

const args = process.argv.slice(2);
const meIndex = args.indexOf('--me');
const me = meIndex >= 0 ? args[meIndex + 1] : undefined;
if (meIndex >= 0 && (!me || me.startsWith('--'))) {
  console.error('Usage: npm run dev:seed-mock -- [--me <your email>] [--reset-mock]');
  process.exit(1);
}

const { seed, resetMock } = await import('./dev-mock/seed.js');
const { prisma } = await import('../src/database/prisma.js');
try {
  if (args.includes('--reset-mock')) await resetMock(me);
  else await seed(me);
} catch (error) {
  console.error(`\nDEV SEED stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
