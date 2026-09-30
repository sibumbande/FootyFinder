import { Link } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar.js';
import { FormError } from '@/components/ui/FormError.js';
import { useConversations } from '@/features/messaging/hooks/useMessaging.js';
import { SocialEmpty } from './SocialEmpty.js';

/** DMs: the existing direct-message conversations, unchanged (they open at /messages/:id). */
export function DmsTab({ query }: { query: string }) {
  const conversations = useConversations();
  const needle = query.toLowerCase();
  const visible = (conversations.data ?? []).filter(({ otherParticipant }) =>
    !needle || otherParticipant.displayName.toLowerCase().includes(needle) || otherParticipant.username.toLowerCase().includes(needle));
  return (
    <div className="grid gap-3">
      <FormError message={conversations.error?.message} />
      {conversations.isPending && <div className="h-20 animate-pulse rounded-2xl bg-surface-muted" />}
      {conversations.data && visible.length === 0 && (
        <SocialEmpty message={query ? 'No conversations found.' : 'No messages yet.'}>
          <p className="max-w-sm text-sm text-content-muted">Open a player's profile and choose Message to start a conversation.</p>
        </SocialEmpty>
      )}
      {visible.map((conversation) => (
        <Link
          key={conversation.id}
          to={`/messages/${conversation.id}`}
          className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 hover:bg-surface-hover"
        >
          <Avatar user={conversation.otherParticipant} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-black text-content-strong">{conversation.otherParticipant.displayName}</span>
            <span className="block truncate text-sm text-content-muted">
              {conversation.canMessage === false ? "You can't message this player." : conversation.latestMessage?.content ?? 'No messages yet'}
            </span>
          </span>
          {conversation.unread && <span className="size-2.5 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
        </Link>
      ))}
    </div>
  );
}
