import { prisma } from '../src/database/prisma.js';
import { WalletReconciliationService } from '../src/modules/wallet/wallet-reconciliation.service.js';

const report = await new WalletReconciliationService().report();
console.log(JSON.stringify(report, null, 2));
await prisma.$disconnect();
if (report.issueCount) process.exitCode = 1;
