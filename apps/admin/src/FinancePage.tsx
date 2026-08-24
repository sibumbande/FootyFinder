import { useQuery } from '@tanstack/react-query';
import { adminClient } from './api.js';

export function FinancePage() {
  const report = useQuery({ queryKey: ['admin', 'finance', 'reconciliation'], queryFn: async () => (await adminClient.walletReconciliation()).data });
  return <section><div><p className="eyebrow">Read-only integrity</p><h2>Finance & reconciliation</h2><p className="muted">This report compares settled ledger totals, wallet balances, active holds, and Match payments. It never repairs or mutates data.</p></div>
    {report.isPending && <p>Running reconciliation…</p>}
    {report.error && <p className="error">{report.error.message}</p>}
    {report.data && <><div className="module-grid"><article><strong>{report.data.walletCount}</strong><span>Wallets checked</span></article><article><strong>{report.data.transactionCount}</strong><span>Ledger rows checked</span></article><article><strong>{report.data.activeHoldCount}</strong><span>Active holds</span></article><article><strong>{report.data.issueCount}</strong><span>Integrity issues</span></article></div>
      {report.data.issueCount === 0 ? <div className="secret"><strong>Reconciliation passed</strong><span>Generated {new Date(report.data.generatedAt).toLocaleString()}</span></div> : <div className="audit-list">{report.data.issues.map((issue, index) => <article key={`${issue.code}-${issue.referenceId ?? issue.walletAccountId}-${index}`}><strong>{issue.code}</strong><code>{issue.walletAccountId ?? issue.referenceId}</code><span>Expected {issue.expectedCents ?? 'n/a'} cents · actual {issue.actualCents ?? 'n/a'} cents</span></article>)}</div>}
    </>}
  </section>;
}
