import 'dotenv/config';
import { assertDevMockTarget } from './dev-mock/guard.js';

assertDevMockTarget();

const [matchId, minutesText] = process.argv.slice(2);
const minutes = Number(minutesText);
if (!matchId || !/^[0-9a-f-]{36}$/i.test(matchId) || !Number.isInteger(minutes) || minutes === 0) {
  console.error('Usage: npm run dev:shift-match -- <matchId> <minutes>   (negative = earlier, e.g. -60)');
  process.exit(1);
}

const { shiftDevSeedMatch, ShiftRefusedError, devSeedMatchLink, prisma } = await import('./dev-mock/shift.js');
const local = (date: Date) => new Date(date.getTime() + 120 * 60_000).toISOString().slice(0, 16).replace('T', ' ');
try {
  const result = await shiftDevSeedMatch(matchId, minutes);
  console.log(`${result.name}: kick-off ${local(result.from)} -> ${local(result.to)} (Johannesburg).`);
  if (result.goNoGoAt) console.log(`T-30 check now at ${local(result.goNoGoAt)}.`);
  for (const job of result.jobs) console.log(`  ${job.type} now runs at ${local(new Date(job.runAt))}`);
  console.log(devSeedMatchLink(matchId));
  console.log('The running dev API (job queue and match scheduler) takes it from here.');
} catch (error) {
  console.error(error instanceof ShiftRefusedError ? `Refused: ${error.message}` : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
