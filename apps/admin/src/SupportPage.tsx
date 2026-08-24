import type { SupportTicketPriority, SupportTicketStatus } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { adminClient } from './api.js';

const rootKey = ['admin', 'support'] as const;
export function SupportPage() {
  const cache = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [statusFilter, setStatusFilter] = useState<SupportTicketStatus | ''>('');
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const list = useQuery({ queryKey: [...rootKey, statusFilter], queryFn: async () => (await adminClient.supportTickets(statusFilter ? { status: statusFilter } : {})).data });
  const detail = useQuery({ queryKey: [...rootKey, 'ticket', selectedId], queryFn: async () => (await adminClient.supportTicket(selectedId!)).data, enabled: Boolean(selectedId) });
  const refresh = () => { void cache.invalidateQueries({ queryKey: rootKey }); };
  const send = useMutation({ mutationFn: () => adminClient.replySupportTicket(selectedId!, { content: reply, internal }), onSuccess: ({ data }) => { cache.setQueryData([...rootKey, 'ticket', selectedId], data); refresh(); setReply(''); } });
  const update = useMutation({ mutationFn: (input: { status?: SupportTicketStatus; priority?: SupportTicketPriority }) => adminClient.updateSupportTicket(selectedId!, input), onSuccess: ({ data }) => { cache.setQueryData([...rootKey, 'ticket', selectedId], data); refresh(); } });
  return <section><div><p className="eyebrow">Private customer care</p><h2>Support inbox</h2><p className="muted">Player tickets are isolated from direct messages. Internal notes are never shown to players.</p></div>
    <label className="compact">Status filter<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as SupportTicketStatus | '')}><option value="">All statuses</option>{['OPEN','IN_PROGRESS','WAITING_ON_USER','RESOLVED','CLOSED'].map((item) => <option key={item}>{item}</option>)}</select></label>
    <div className="support-layout"><div className="ticket-list">{list.data?.map((ticket) => <button className={selectedId === ticket.id ? 'ticket active-ticket' : 'ticket'} key={ticket.id} onClick={() => setSelectedId(ticket.id)}><strong>{ticket.subject}</strong><span>{ticket.referenceCode} · {ticket.status.replaceAll('_', ' ')}</span><small>{ticket.createdBy.displayName} · {new Date(ticket.lastMessageAt).toLocaleString()}</small></button>)}</div>
      <div>{!selectedId && <p className="empty">Select a support ticket.</p>}{detail.data && <article className="venue-card"><header><h3>{detail.data.subject}</h3><p className="muted">{detail.data.referenceCode} · {detail.data.createdBy.displayName} · {detail.data.category}</p></header><div className="row"><label>Status<select value={detail.data.status} onChange={(event) => update.mutate({ status: event.target.value as SupportTicketStatus })}>{['OPEN','IN_PROGRESS','WAITING_ON_USER','RESOLVED','CLOSED'].map((item) => <option key={item}>{item}</option>)}</select></label><label>Priority<select value={detail.data.priority} onChange={(event) => update.mutate({ priority: event.target.value as SupportTicketPriority })}>{['NORMAL','HIGH','URGENT'].map((item) => <option key={item}>{item}</option>)}</select></label></div><div className="stack">{detail.data.messages?.map((item) => <div key={item.id} className={item.internal ? 'support-message internal' : 'support-message'}><div className="row between"><strong>{item.authorRole === 'ADMIN' ? item.author.displayName : detail.data.createdBy.displayName}</strong><small>{item.internal ? 'INTERNAL NOTE · ' : ''}{new Date(item.createdAt).toLocaleString()}</small></div><p>{item.content}</p></div>)}</div>{detail.data.status !== 'CLOSED' && <form className="stack" onSubmit={(event: FormEvent) => { event.preventDefault(); send.mutate(); }}><label>Reply<textarea value={reply} onChange={(event) => setReply(event.target.value)} required maxLength={5000} /></label><label className="check"><input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} />Internal note (never visible to player)</label><button disabled={send.isPending}>{internal ? 'Add internal note' : 'Reply to player'}</button></form>}{(send.error || update.error) && <p className="error">{(send.error ?? update.error)?.message}</p>}</article>}</div></div>
  </section>;
}
