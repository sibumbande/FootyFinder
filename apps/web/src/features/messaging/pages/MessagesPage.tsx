import { SocketEvents } from '@footy-finder/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { messagingClient } from '@/api/client.js';
import { Avatar } from '@/components/ui/Avatar.js';
import { FriendButton } from '@/features/social/components/FriendButton.js';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { ensureSocketConnected } from '@/socket/socket.js';
import { formatDate } from '@/utils/format-date.js';
import {
  useConversation,
  useConversations,
  useSendDirectMessage,
  useStartConversation,
} from '../hooks/useMessaging.js';
export function MessagesPage() {
  const { conversationId, userId } = useParams();
  const navigate = useNavigate();
  const start = useStartConversation();
  useEffect(() => {
    if (userId)
      start.mutate(userId, {
        onSuccess: ({ data }) => navigate(`/messages/${data.id}`, { replace: true }),
      });
  }, [userId]);
  if (userId)
    return (
      <div className="grid min-h-64 place-items-center text-content-muted">
        Opening conversation…
      </div>
    );
  return <MessagesWorkspace conversationId={conversationId} />;
}
function MessagesWorkspace({ conversationId }: { conversationId?: string }) {
  const conversations = useConversations();
  const conversation = useConversation(conversationId);
  const send = useSendDirectMessage(conversationId ?? '');
  const { user } = useAuth();
  const [content, setContent] = useState('');
  useEffect(() => {
    const socket = ensureSocketConnected();
    const refresh = () => {
      void conversations.refetch();
      if (conversationId) void conversation.refetch();
    };
    socket.on(SocketEvents.directMessageCreated, refresh);
    return () => {
      socket.off(SocketEvents.directMessageCreated, refresh);
    };
  }, [conversationId]);
  useEffect(() => {
    if (conversationId) void messagingClient.markRead(conversationId);
  }, [conversationId, conversation.data?.messages?.length]);
  const submit = () => {
    if (!content.trim() || !conversationId) return;
    send.mutate(content, { onSuccess: () => setContent('') });
  };
  return (
    <section className="anime-panel grid min-h-[70vh] md:grid-cols-[20rem_1fr]">
      <aside className={`${conversationId ? 'hidden md:block' : 'block'} border-r border-line`}>
        <div className="border-b border-line p-5">
          <p className="anime-kicker">Team radio</p>
          <h1 className="mt-2 text-3xl font-black uppercase text-content-strong">Messages</h1>
        </div>
        <div>
          {conversations.data?.map((item) => (
            <Link
              key={item.id}
              to={`/messages/${item.id}`}
              className={`flex gap-3 border-b border-line p-4 hover:bg-surface-hover ${item.id === conversationId ? 'bg-brand-50' : ''}`}
            >
              <Avatar user={item.otherParticipant} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex justify-between">
                  <strong className="truncate text-sm text-content-strong">
                    {item.otherParticipant.displayName}
                  </strong>
                  {item.unread && <span className="size-2 rounded-full bg-brand-600" />}
                </div>
                <p className="truncate text-xs text-content-muted">
                  {item.latestMessage?.content ?? 'Start the conversation'}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </aside>
      <main className={`${conversationId ? 'flex' : 'hidden md:flex'} min-w-0 flex-col`}>
        {!conversationId ? (
          <div className="grid flex-1 place-items-center p-8 text-center text-content-muted">
            Choose a conversation or message a player from their profile.
          </div>
        ) : conversation.isPending ? (
          <div className="grid flex-1 place-items-center text-content-muted">Loading messages…</div>
        ) : conversation.data ? (
          <>
            <header className="flex items-center gap-3 border-b border-line p-4">
              <Link className="md:hidden" to="/social?tab=dms">
                ←
              </Link>
              <Avatar user={conversation.data.otherParticipant} size="sm" />
              <div>
                <strong className="text-content-strong">
                  {conversation.data.otherParticipant.displayName}
                </strong>
                <p className="text-xs text-content-muted">
                  @{conversation.data.otherParticipant.username}
                </p>
              </div>
              <FriendButton userId={conversation.data.otherParticipant.id} className="ml-auto" />
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto bg-surface-muted p-4">
              {conversation.data.messages?.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[80%] rounded-2xl px-4 py-3 ${message.senderId === user?.id ? 'ml-auto bg-brand-600 text-content-inverse' : 'bg-surface text-content'}`}
                >
                  <p className="text-sm">{message.content}</p>
                  <p className="mt-1 text-[10px] opacity-70">{formatDate(message.createdAt)}</p>
                  {message.senderId !== user?.id && (
                    <Link
                      className="mt-1 block text-[10px] opacity-70 hover:opacity-100"
                      to={`/report/DIRECT_MESSAGE/${message.id}`}
                    >
                      Report message
                    </Link>
                  )}
                </div>
              ))}
            </div>
            <FormError message={send.error?.message} />
            {conversation.data.canMessage === false ? (
              <p className="border-t border-line p-4 text-sm font-semibold text-content-muted">You can't message this player.</p>
            ) : (
            <div className="flex gap-2 border-t border-line p-4">
              <input
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submit();
                }}
                placeholder="Write a private message"
              />
              <Button onClick={submit} loading={send.isPending}>
                Send
              </Button>
            </div>
            )}
          </>
        ) : (
          <FormError message={conversation.error?.message} />
        )}
      </main>
    </section>
  );
}
