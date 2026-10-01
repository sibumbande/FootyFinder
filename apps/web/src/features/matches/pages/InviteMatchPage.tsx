import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { matchClient } from '@/api/client.js';
import { FormError } from '@/components/ui/FormError.js';
import { JoinTeamDialog } from '../components/JoinTeamDialog.js';
export function InviteMatchPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const match = useQuery({
    queryKey: ['match-invite', token],
    queryFn: async () => (await matchClient.invite(token)).data,
    enabled: Boolean(token),
  });
  if (match.isPending) return <div className="h-72 animate-pulse rounded-3xl bg-surface" />;
  if (!match.data) return <FormError message={match.error?.message ?? 'Invitation not found.'} />;
  return (
    <section className="mx-auto max-w-xl rounded-3xl border border-line bg-surface p-8 text-center shadow-soft">
      <p className="text-sm font-bold uppercase text-brand-700">Private invitation</p>
      <h1 className="mt-3 text-3xl font-bold text-content-strong">{match.data.name}</h1>
      <p className="mt-2 text-content-muted">
        {match.data.venue.name} · {match.data.venue.city}
      </p>
      <p className="mt-5 text-content">
        Choose a team to accept this invitation. Normal payment and capacity rules still apply.
      </p>
      <JoinTeamDialog
        match={match.data}
        open
        onClose={() => navigate(`/matches/${match.data!.id}`, { replace: true })}
      />
    </section>
  );
}
