import { TEAM_CHAT_MESSAGE_MAX_LENGTH, type TeamDetail } from '@footy-finder/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { formatDate } from '@/utils/format-date.js';
import { useMarkTeamChatRead, useSendTeamChatMessage, useTeamChat } from '../hooks/useTeamChat.js';

/**
 * Gate 7 / TKT-711: the team's one permanent chat, for current members. New messages arrive live
 * through the team room (useTeamSocket). Opening the chat marks it read. Separate from match
 * lobby chat; it never sends email.
 */
export function TeamChatPanel({ team }: { team: TeamDetail }) {
  const { user } = useAuth();
  const chat = useTeamChat(team.id);
  const send = useSendTeamChatMessage(team.id);
  const markRead = useMarkTeamChatRead(team.id);
  const [draft, setDraft] = useState('');
  const messages = [...(chat.data?.pages ?? [])].reverse().flatMap((page) => page.messages);
  const newestId = messages.at(-1)?.id;
  const markReadRef = useRef(markRead.mutate);
  markReadRef.current = markRead.mutate;
  useEffect(() => {
    if (newestId !== undefined) markReadRef.current();
  }, [newestId]);
  const archived = Boolean(team.archivedAt);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    send.mutate(content, { onSuccess: () => setDraft('') });
  };
  return (
    <section className="grid gap-4" aria-labelledby="team-chat-heading">
      <div>
        <h2 id="team-chat-heading" className="text-xl font-bold text-content-strong">Team chat</h2>
        <p className="mt-1 text-sm text-content-muted">Only current members of {team.name} can read and post here.</p>
      </div>
      {chat.hasNextPage && (
        <Button variant="ghost" loading={chat.isFetchingNextPage} onClick={() => void chat.fetchNextPage()}>
          Load earlier messages
        </Button>
      )}
      {chat.isPending ? (
        <div className="h-40 animate-pulse rounded-2xl bg-surface-muted" />
      ) : chat.error ? (
        <FormError message={chat.error.message} />
      ) : messages.length === 0 ? (
        <p className="rounded-2xl bg-surface-muted p-4 text-sm text-content-muted">No messages yet. Say hello to your team.</p>
      ) : (
        <ol className="grid max-h-[28rem] gap-2 overflow-y-auto" aria-label="Team messages">
          {messages.map((message) => {
            const mine = message.senderId === user?.id;
            return (
              <li key={message.id} className={`max-w-[85%] rounded-2xl p-3 ${mine ? 'justify-self-end bg-brand-50' : 'justify-self-start bg-surface-muted'}`}>
                <p className="text-xs font-bold text-content-muted">
                  {mine ? 'You' : message.sender.displayName ?? message.sender.username} · {formatDate(message.createdAt)}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-content-strong">{message.content}</p>
              </li>
            );
          })}
        </ol>
      )}
      {archived ? (
        <p className="text-sm text-content-muted">This team has been closed, so its chat is read-only.</p>
      ) : (
        <form onSubmit={submit} className="flex gap-2">
          <label className="sr-only" htmlFor="team-chat-draft">Message your team</label>
          <input
            id="team-chat-draft"
            className="min-h-11 flex-1 rounded-xl border-2 border-line bg-canvas px-3"
            maxLength={TEAM_CHAT_MESSAGE_MAX_LENGTH}
            placeholder="Message your team"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" loading={send.isPending} disabled={!draft.trim()}>Send</Button>
        </form>
      )}
      <FormError message={send.error?.message} />
    </section>
  );
}
