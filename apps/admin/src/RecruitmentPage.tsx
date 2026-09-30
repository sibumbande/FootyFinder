import type { AdminRecruitmentItem } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { recruitmentClient } from './api.js';

const rootKey = ['admin', 'recruitment'] as const;

/**
 * Gate 9 / TKT-909: reported recruitment posts and "Looking for a team" cards. Removing one hides
 * it from the board (a removed post cannot be renewed; a removed card is switched off), resolves
 * its open reports and is audited.
 */
export function RecruitmentPage() {
  const [queue, setQueue] = useState<'reported' | 'all'>('reported');
  const [kind, setKind] = useState<'POST' | 'CARD' | undefined>();
  const items = useQuery({ queryKey: [...rootKey, queue, kind], queryFn: async () => (await recruitmentClient.adminList(kind, queue)).data });
  return (
    <section>
      <p className="eyebrow">Community</p>
      <h2>Recruitment</h2>
      <p className="muted">Team recruitment posts and players' "Looking for a team" cards. Remove anything that breaks the Terms; the owner sees that FootyFinder removed it.</p>
      <div className="row">
        {([['reported', 'Reported'], ['all', 'All']] as const).map(([key, label]) => (
          <button key={key} className={queue === key ? '' : 'ghost'} onClick={() => setQueue(key)}>{label}</button>
        ))}
        {([[undefined, 'Posts and cards'], ['POST', 'Posts'], ['CARD', 'Cards']] as const).map(([key, label]) => (
          <button key={label} className={kind === key ? '' : 'ghost'} onClick={() => setKind(key)}>{label}</button>
        ))}
      </div>
      {items.error && <p className="error">{items.error.message}</p>}
      {items.data?.length === 0 && <p className="muted">Nothing here.</p>}
      {items.data?.map((item) => <RecruitmentCard key={`${item.kind}:${item.id}`} item={item} />)}
    </section>
  );
}

function RecruitmentCard({ item }: { item: AdminRecruitmentItem }) {
  const cache = useQueryClient();
  const [reason, setReason] = useState('');
  const remove = useMutation({
    mutationFn: () => (item.kind === 'POST' ? recruitmentClient.adminRemovePost(item.id, reason) : recruitmentClient.adminRemoveCard(item.id, reason)),
    onSuccess: () => {
      setReason('');
      void cache.invalidateQueries({ queryKey: rootKey });
    },
  });
  return (
    <article className="venue-card">
      <strong>{item.title}</strong>
      <p className="muted">
        {item.kind === 'POST' ? 'Post' : 'Card'} · {item.status} · {item.openReports} open report{item.openReports === 1 ? '' : 's'} · {new Date(item.createdAt).toLocaleString()}
        {item.area ? ` · ${item.area}` : ''}
      </p>
      {item.note && <p>“{item.note}”</p>}
      {item.removedAt ? (
        <p className="muted">Removed {new Date(item.removedAt).toLocaleString()}: {item.removedReason}</p>
      ) : (
        <div className="row">
          <input aria-label="Reason" placeholder="Reason (required)" value={reason} onChange={(event) => setReason(event.target.value)} />
          <button type="button" className="danger" disabled={remove.isPending || reason.trim().length < 3} onClick={() => remove.mutate()}>Remove</button>
        </div>
      )}
      {remove.error && <p className="error">{remove.error.message}</p>}
    </article>
  );
}
