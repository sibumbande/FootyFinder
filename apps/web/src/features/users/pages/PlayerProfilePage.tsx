import { zodResolver } from '@hookform/resolvers/zod';
import {
  FOOTBALL_POSITIONS,
  updatePlayerProfileSchema,
  type UpdatePlayerProfileInput,
} from '@footy-finder/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar.js';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Input } from '@/components/ui/Input.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { useNotifications } from '@/features/notifications/NotificationProvider.js';
import { usePlayerProfile, useUpdatePlayerProfile } from '../hooks/usePlayerProfile.js';
import { TeamAvatar } from '@/features/teams/components/TeamAvatar.js';
import { useUploadPlayerPhoto } from '@/features/onboarding/hooks/useOnboarding.js';
import { useRequestEmailChange } from '@/features/auth/hooks/useAuth.js';

export function PlayerProfilePage() {
  const { userId = '' } = useParams();
  const { user } = useAuth();
  const profile = usePlayerProfile(userId);
  const update = useUpdatePlayerProfile(userId);
  const { notify } = useNotifications();
  const [editing, setEditing] = useState(false);
  const [photo, setPhoto] = useState<File>();
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const photoUpload = useUploadPlayerPhoto();
  const emailChange = useRequestEmailChange();
  const form = useForm<UpdatePlayerProfileInput>({
    resolver: zodResolver(updatePlayerProfileSchema),
    values: profile.data
      ? {
          displayName: profile.data.displayName,
          bio: profile.data.bio,
          preferredPositions: profile.data.preferredPositions,
          dominantFoot: profile.data.dominantFoot,
          homeArea: profile.data.homeArea,
        }
      : undefined,
  });
  if (profile.isPending) return <div className="h-96 animate-pulse rounded-3xl bg-surface" />;
  if (!profile.data || profile.error)
    return (
      <FormError
        message={profile.error instanceof Error ? profile.error.message : 'Player not found.'}
      />
    );
  const player = profile.data;
  const mine = user?.id === player.id;
  const submit = form.handleSubmit((input) =>
    update.mutate(input, {
      onSuccess: () => {
        setEditing(false);
        notify({
          variant: 'success',
          title: 'Profile updated',
          message: 'Your public football profile is up to date.',
        });
      },
    }),
  );
  return (
    <section className="mx-auto grid max-w-3xl gap-6">
      <div className="rounded-3xl border border-line bg-surface p-6 shadow-soft sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar user={player} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-bold text-content-strong">{player.displayName}</h1>
            <p className="text-brand-700">@{player.username}</p>
            <p className="mt-2 text-sm text-content-muted">
              {player.homeArea || 'Home area not set'} ·{' '}
              {player.dominantFoot
                ? `${player.dominantFoot.toLowerCase()} foot`
                : 'Dominant foot not set'}
            </p>
            <p className="mt-1 text-sm text-content-muted">
              {player.city?.name ?? 'City not set'} · {player.yearsExperience ?? '—'} years' experience
            </p>
          </div>
          {mine ? (
            <Button variant="secondary" onClick={() => setEditing((value) => !value)}>
              {editing ? 'Cancel editing' : 'Edit profile'}
            </Button>
          ) : (
            <Link className="button" to={`/messages/new/${player.id}`}>
              Message
            </Link>
          )}
        </div>
        <p className="mt-6 leading-7 text-content">
          {player.bio || 'This player has not added a bio yet.'}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {player.preferredPositions.length ? (
            player.preferredPositions.map((position) => (
              <span
                key={position}
                className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700"
              >
                {position.toLowerCase()}
              </span>
            ))
          ) : (
            <span className="text-sm text-content-muted">Preferred positions not set.</span>
          )}
        </div>
      </div>
      {player.statistics && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-5" aria-label="Player statistics">
          {Object.entries(player.statistics).map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-line bg-surface p-4 text-center shadow-sm">
              <strong className="block text-2xl text-content-strong">{value}</strong>
              <span className="text-xs font-bold uppercase text-content-muted">{label.replace(/([A-Z])/g, ' $1')}</span>
            </div>
          ))}
        </section>
      )}
      {player.teams && player.teams.length > 0 && (
        <section className="rounded-3xl border border-line bg-surface p-6 shadow-sm">
          <h2 className="text-xl font-bold text-content-strong">Teams</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {player.teams.map((team) => (
              <Link
                key={team.id}
                to={`/teams/${team.id}`}
                className="flex items-center gap-3 rounded-2xl border border-line p-3 hover:bg-surface-hover"
              >
                <TeamAvatar team={team} size="sm" />
                <div>
                  <p className="font-bold text-content-strong">{team.name}</p>
                  <p className="text-xs font-bold uppercase text-brand-700">{team.role}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
      {editing && (
        <form
          onSubmit={submit}
          className="grid gap-5 rounded-3xl border border-line bg-surface p-6 shadow-soft"
        >
          <Input
            label="Display name"
            error={form.formState.errors.displayName?.message}
            {...form.register('displayName')}
          />
          <div className="grid gap-2">
            <label className="text-sm font-semibold text-content" htmlFor="profile-photo">Profile photo</label>
            <input id="profile-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files?.[0])} />
            <Button type="button" variant="secondary" disabled={!photo} loading={photoUpload.isPending} onClick={() => photo && photoUpload.mutate(photo)}>Replace photo</Button>
            <FormError message={photoUpload.error?.message} />
          </div>
          <Input
            label="Home area"
            placeholder="Cape Town"
            error={form.formState.errors.homeArea?.message}
            {...form.register('homeArea')}
          />
          <label className="grid gap-2 text-sm font-semibold text-content">
            Bio
            <textarea
              className="min-h-28 rounded-xl border border-line-strong bg-surface px-3 py-2 text-content-strong"
              {...form.register('bio')}
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-content">
            Dominant foot
            <select
              className="min-h-11 rounded-xl border border-line-strong bg-surface px-3"
              {...form.register('dominantFoot')}
            >
              <option value="">Not set</option>
              <option value="LEFT">Left</option>
              <option value="RIGHT">Right</option>
              <option value="BOTH">Both</option>
            </select>
          </label>
          <fieldset>
            <legend className="text-sm font-semibold text-content">Preferred positions</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {FOOTBALL_POSITIONS.map((position) => (
                <label
                  key={position}
                  className="flex items-center gap-2 rounded-xl border border-line p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    value={position}
                    {...form.register('preferredPositions')}
                  />
                  {position.toLowerCase()}
                </label>
              ))}
            </div>
          </fieldset>
          <FormError message={update.error?.message} />
          <Button type="submit" loading={update.isPending}>
            Save public profile
          </Button>
          <Link className="text-center text-sm font-bold text-brand-700 hover:underline" to="/onboarding">
            Edit date of birth, city, experience, or position order
          </Link>
          <div className="grid gap-3 border-t border-line pt-5">
            <h3 className="font-bold text-content-strong">Change sign-in email</h3>
            <Input label="New email" type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
            <Input label="Current password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
            <Button type="button" variant="secondary" loading={emailChange.isPending} disabled={!newEmail || !currentPassword} onClick={() => emailChange.mutate({ newEmail, currentPassword })}>Send confirmation</Button>
            {emailChange.isSuccess && <p className="text-sm text-content-muted">Check the new address. Your current email remains active until confirmation.</p>}
            <FormError message={emailChange.error?.message} />
          </div>
        </form>
      )}
    </section>
  );
}
