import { Link } from 'react-router-dom';
import { useFriendAction, useRelationship } from '../hooks/useSocial.js';
import { FriendButton } from './FriendButton.js';
import { useConfirm } from '@/components/ui/ConfirmDialog.js';

/** Gate 9: Add friend, Message and Block/Unblock on another player's profile. */
export function PlayerSocialActions({ userId, displayName }: { userId: string; displayName: string }) {
  const relationship = useRelationship(userId);
  const action = useFriendAction();
  const { confirm, confirmDialog } = useConfirm();
  const blockedByYou = relationship.data?.blockedByYou === true;
  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      {confirmDialog}
      <div className="flex flex-wrap items-center gap-2">
        <FriendButton userId={userId} />
        {!blockedByYou && (
          <Link className="button" to={`/messages/new/${userId}`}>
            Message
          </Link>
        )}
      </div>
      {/* CEO touch-up batch 3, item 11: 44 px tap targets. */}
      <div className="flex flex-wrap gap-x-4 text-xs font-black uppercase tracking-[0.06em] text-content-muted [&>*]:inline-flex [&>*]:min-h-11 [&>*]:items-center [&>*]:uppercase">
        {relationship.data?.state === 'FRIENDS' && (
          <button type="button" className="hover:text-content-strong" onClick={() => void confirm({
            title: `Remove ${displayName} from your friends?`,
            message: <p>They won't be told.</p>,
            confirmLabel: 'Remove friend',
            cancelLabel: 'Keep friend',
            destructive: true,
            action: () => action.mutateAsync({ kind: 'remove', userId }),
          })}>
            Remove friend
          </button>
        )}
        {blockedByYou ? (
          <button type="button" className="hover:text-content-strong" onClick={() => action.mutate({ kind: 'unblock', userId })}>
            Unblock
          </button>
        ) : (
          <button
            type="button"
            className="hover:text-danger-700"
            onClick={() => void confirm({
              title: `Block ${displayName}?`,
              message: <p>You won't be able to message, add or invite each other, and you'll stop seeing each other in Social. They won't be told.</p>,
              confirmLabel: 'Block',
              cancelLabel: 'Cancel',
              destructive: true,
              action: () => action.mutateAsync({ kind: 'block', userId }),
            })}
          >
            Block
          </button>
        )}
        <Link className="hover:text-content-strong" to={`/report/USER/${userId}`}>Report</Link>
      </div>
    </div>
  );
}
