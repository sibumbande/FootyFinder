import type { SupportTicketCategory } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supportClient } from '@/api/client.js';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';

const ticketsKey = ['support', 'tickets'] as const;
const categories: SupportTicketCategory[] = ['GENERAL', 'ACCOUNT', 'MATCH', 'TEAM', 'PAYMENT', 'SAFETY'];

export function SupportPage() {
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<SupportTicketCategory>('GENERAL');
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState('');
  const tickets = useQuery({ queryKey: ticketsKey, queryFn: async () => (await supportClient.list()).data });
  const detail = useQuery({ queryKey: ['support', 'ticket', ticketId], queryFn: async () => (await supportClient.get(ticketId!)).data, enabled: Boolean(ticketId) });
  const create = useMutation({
    mutationFn: () => supportClient.create({ subject, category, message }),
    onSuccess: ({ data }) => {
      void cache.invalidateQueries({ queryKey: ticketsKey });
      setSubject(''); setMessage(''); navigate(`/support/${data.id}`);
    },
  });
  const send = useMutation({
    mutationFn: () => supportClient.reply(ticketId!, { content: reply }),
    onSuccess: ({ data }) => {
      cache.setQueryData(['support', 'ticket', ticketId], data);
      void cache.invalidateQueries({ queryKey: ticketsKey }); setReply('');
    },
  });
  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <aside className="space-y-4 rounded-2xl border border-line bg-surface p-4">
        <div><p className="text-xs font-bold uppercase tracking-wider text-brand-700">Help centre</p><h1 className="text-2xl font-bold text-content-strong">Support</h1></div>
        <Link className="block rounded-xl bg-brand-600 px-4 py-3 text-center font-bold text-white" to="/support">New ticket</Link>
        <div className="space-y-2">
          {tickets.data?.map((ticket) => <Link key={ticket.id} to={`/support/${ticket.id}`} className={`block rounded-xl border p-3 ${ticketId === ticket.id ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface-raised'}`}><strong className="block text-sm text-content-strong">{ticket.subject}</strong><span className="text-xs text-content-muted">{ticket.referenceCode} · {ticket.status.replaceAll('_', ' ')}</span></Link>)}
          {!tickets.isPending && tickets.data?.length === 0 && <p className="text-sm text-content-muted">You have no support tickets.</p>}
        </div>
      </aside>
      {!ticketId ? (
        <form className="space-y-5 rounded-2xl border border-line bg-surface p-6" onSubmit={(event: FormEvent) => { event.preventDefault(); create.mutate(); }}>
          <div><h2 className="text-xl font-bold text-content-strong">How can we help?</h2><p className="text-sm text-content-muted">This creates a private conversation with Footy Finder support—not a player DM.</p></div>
          <Input label="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} required minLength={5} />
          <label className="grid gap-2 text-sm font-semibold text-content"><span>Category</span><select className="rounded-xl border border-line bg-canvas px-3 py-3" value={category} onChange={(event) => setCategory(event.target.value as SupportTicketCategory)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="grid gap-2 text-sm font-semibold text-content"><span>Message</span><textarea className="min-h-40 rounded-xl border border-line bg-canvas p-3" value={message} onChange={(event) => setMessage(event.target.value)} required minLength={5} maxLength={5000} /></label>
          {create.error && <p className="text-sm text-danger-700">{create.error.message}</p>}
          <Button type="submit" loading={create.isPending}>Send to support</Button>
        </form>
      ) : (
        <section className="space-y-5 rounded-2xl border border-line bg-surface p-6">
          {detail.isPending && <p>Loading ticket…</p>}
          {detail.error && <p className="text-danger-700">{detail.error.message}</p>}
          {detail.data && <>
            <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold text-content-strong">{detail.data.subject}</h2><span className="rounded-full bg-brand-50 px-2 py-1 text-xs font-bold text-brand-700">{detail.data.status.replaceAll('_', ' ')}</span></div><p className="text-sm text-content-muted">{detail.data.referenceCode} · {detail.data.category}</p></div>
            <div className="space-y-3">{detail.data.messages?.map((item) => <article key={item.id} className={`rounded-xl p-4 ${item.authorRole === 'ADMIN' ? 'bg-brand-50' : 'bg-surface-raised'}`}><div className="mb-2 flex justify-between gap-3 text-xs text-content-muted"><strong>{item.authorRole === 'ADMIN' ? 'Footy Finder Support' : item.author.displayName}</strong><span>{new Date(item.createdAt).toLocaleString()}</span></div><p className="whitespace-pre-wrap text-content">{item.content}</p></article>)}</div>
            {detail.data.status !== 'CLOSED' ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); send.mutate(); }}><label className="grid gap-2 text-sm font-semibold text-content"><span>Reply</span><textarea className="min-h-28 rounded-xl border border-line bg-canvas p-3" value={reply} onChange={(event) => setReply(event.target.value)} required maxLength={5000} /></label>{send.error && <p className="text-danger-700">{send.error.message}</p>}<Button loading={send.isPending}>Send reply</Button></form> : <p className="rounded-xl bg-surface-raised p-4 text-sm text-content-muted">This ticket is closed. Create a new ticket if you need more help.</p>}
          </>}
        </section>
      )}
    </div>
  );
}
