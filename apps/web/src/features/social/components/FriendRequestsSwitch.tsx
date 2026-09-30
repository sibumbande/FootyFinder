import { useSocialSettings, useUpdateSocialSettings } from '../hooks/useSocial.js';

/** Gate 9 / D5: turn incoming friend requests on or off (on by default). */
export function FriendRequestsSwitch() {
  const settings = useSocialSettings();
  const update = useUpdateSocialSettings();
  const enabled = settings.data?.friendRequestsEnabled ?? true;
  return (
    <label className="flex items-center justify-between gap-4 rounded-2xl border border-line p-4">
      <span>
        <span className="block text-sm font-black text-content-strong">Accept friend requests</span>
        <span className="block text-xs text-content-muted">When this is off, nobody can send you a friend request. Your friends stay your friends.</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className="size-5 accent-brand-600"
        checked={enabled}
        disabled={settings.isPending || update.isPending}
        onChange={(event) => update.mutate(event.target.checked)}
        data-testid="friend-requests-switch"
      />
    </label>
  );
}
