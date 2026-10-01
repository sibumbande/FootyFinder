import { Link, useParams } from 'react-router-dom';
import { FormError } from '@/components/ui/FormError.js';
import { GuestMatchLobby } from '../components/GuestMatchLobby.js';
import { usePublicMatchById } from '../hooks/usePublic.js';

/** CEO touch-up batch 2, item 5: a guest who opens a /matches/:id link sees the match lobby layout. */
export function GuestMatchPage() {
  const { matchId = '' } = useParams();
  const preview = usePublicMatchById(matchId);
  if (preview.isPending) return <div className="h-[36rem] animate-pulse rounded-3xl bg-surface" />;
  if (!preview.data)
    return (
      <section className="mx-auto max-w-xl rounded-3xl border border-line bg-surface p-8 text-center shadow-soft">
        <h1 className="text-2xl font-black text-content-strong">Match unavailable</h1>
        <FormError message="This match is private or no longer available." />
        <Link className="button mt-5 inline-flex" to={`/login?returnTo=${encodeURIComponent(`/matches/${matchId}`)}`}>Log in</Link>
      </section>
    );
  return <GuestMatchLobby preview={preview.data} />;
}
