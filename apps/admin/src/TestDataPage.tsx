import type { AdminTestDataBatch } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { adminClient } from './api.js';

const batchesKey = ['admin', 'test-data', 'batches'] as const;
export function TestDataPage() {
  const cache = useQueryClient();
  const [label, setLabel] = useState('Manual QA');
  const [accountCount, setAccountCount] = useState(3);
  const [created, setCreated] = useState<AdminTestDataBatch>();
  const status = useQuery({ queryKey: ['admin', 'test-data', 'status'], queryFn: async () => (await adminClient.testDataStatus()).data });
  const batches = useQuery({ queryKey: batchesKey, queryFn: async () => (await adminClient.testDataBatches()).data, enabled: status.data?.enabled });
  const create = useMutation({ mutationFn: () => adminClient.createTestDataBatch({ label, accountCount }), onSuccess: ({ data }) => { setCreated(data); void cache.invalidateQueries({ queryKey: batchesKey }); } });
  const remove = useMutation({ mutationFn: (id: string) => adminClient.removeTestDataBatch(id), onSuccess: () => void cache.invalidateQueries({ queryKey: batchesKey }) });
  return <section><div><p className="eyebrow">Disposable QA fixtures</p><h2>Test accounts & data</h2><p className="muted">This module must be explicitly enabled outside production. It never creates Admin accounts or preloads wallet balances.</p></div>
    {status.data && !status.data.enabled && <div className="empty"><strong>Test-data tools are disabled.</strong><p>Set <code>ADMIN_TEST_DATA_ENABLED=true</code> only in a disposable development or test environment, then restart the API.</p></div>}
    {status.data?.enabled && <><form className="form-grid three create-panel" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate(); }}><label>Batch label<input value={label} onChange={(event) => setLabel(event.target.value)} required /></label><label>Accounts<input type="number" min={1} max={20} value={accountCount} onChange={(event) => setAccountCount(Number(event.target.value))} required /></label><button disabled={create.isPending}>Create disposable accounts</button></form>
      {created?.temporaryPassword && <article className="secret"><strong>Credentials shown once</strong><code>{created.temporaryPassword}</code><p className="muted">All accounts in this batch use this temporary password. Store it in the test handoff, never production secrets.</p></article>}
      <div className="stack">{batches.data?.map((batch) => <article className="venue-card" key={batch.id}><div className="row between"><div><h3>{batch.label}</h3><p className="muted">{batch.accountCount} accounts · {new Date(batch.createdAt).toLocaleString()}</p></div><button className="danger" disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete ${batch.label} and its ${batch.accountCount} test accounts?`)) remove.mutate(batch.id); }}>Delete batch</button></div><div className="account-grid">{batch.accounts?.map((account) => <div key={account.id}><strong>{account.displayName}</strong><code>{account.email}</code><span>@{account.username}</span></div>)}</div></article>)}</div>{(create.error || remove.error || batches.error) && <p className="error">{(create.error ?? remove.error ?? batches.error)?.message}</p>}</>}
  </section>;
}
