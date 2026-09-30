import { useState } from 'react';
import { useBlocks } from '../hooks/useSocial.js';

/**
 * Gate 9 / D10: in shared Lobby and Team chats, a message from a player you blocked is hidden
 * until you choose to show it. Nobody is removed from the chat.
 */
export function ChatMessageText({ senderId, content, className }: { senderId: string; content: string; className: string }) {
  const blocks = useBlocks();
  const [shown, setShown] = useState(false);
  const blocked = blocks.data?.some(({ id }) => id === senderId) ?? false;
  if (blocked && !shown)
    return (
      <p className="mt-1 text-sm italic text-content-muted">
        Message from a player you blocked.{' '}
        <button type="button" className="font-bold not-italic underline" onClick={() => setShown(true)}>
          Show
        </button>
      </p>
    );
  return <p className={className}>{content}</p>;
}
