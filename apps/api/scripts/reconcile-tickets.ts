import { prisma } from '../src/database/prisma.js';
import { TicketReconciliationService } from '../src/modules/tickets/ticket-reconciliation.service.js';

/** DEC-021 A6: prints the ticket reconciliation report; exits 1 when it finds issues. Read-only. */
const report = await new TicketReconciliationService().report();
console.log(JSON.stringify(report, null, 2));
await prisma.$disconnect();
if (report.issueCount) process.exitCode = 1;
