import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar.js';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { formatDate } from '@/utils/format-date.js';
import { useLobbyMessages, useSendLobbyMessage } from '@/features/matches/hooks/useMatches.js';
export function ChatPanel({ matchId, enabled = true }: { matchId: string; enabled?: boolean }) {
  const [content, setContent] = useState('');
  const messages = useLobbyMessages(matchId, enabled);
  const send = useSendLobbyMessage(matchId);
  const submit = () => {
    if (!content.trim()) return;
    send.mutate(content, { onSuccess: () => setContent('') });
  };
  return (
    <section className="flex min-h-[32rem] flex-col rounded-3xl border border-line bg-surface p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-content-strong">Lobby chat</h2>
        <p className="text-sm text-content-muted">
          Organiser and active players · closes after the post-match window
        </p>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl bg-surface-muted p-3">
        {messages.isPending && <p className="text-sm text-content-muted">Loading messages…</p>}
        {messages.data?.length === 0 && (
          <p className="grid h-full place-items-center text-sm text-content-subtle">
            No messages yet. Start the team talk.
          </p>
        )}
        {messages.data?.map((message) => (
          <div key={message.id} className="flex gap-2 rounded-xl bg-surface p-3">
            <Avatar user={message.sender!} size="sm" />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <strong className="truncate text-sm text-content-strong">
                  {message.sender?.displayName}
                </strong>
                <span className="text-[10px] text-content-subtle">
                  {formatDate(message.createdAt)}
                </span>
              </div>
              <p className="mt-1 break-words text-sm text-content">{message.content}</p>
            </div>
          </div>
        ))}
      </div>
      <FormError message={messages.error?.message ?? send.error?.message} />
      <div className="mt-4 flex gap-2">
        <input
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 text-content-strong"
          placeholder="Write a message"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          disabled={!enabled || send.isPending}
        />
        <Button onClick={submit} loading={send.isPending} disabled={!enabled || !content.trim()}>
          Send
        </Button>
      </div>
    </section>
  );
}
