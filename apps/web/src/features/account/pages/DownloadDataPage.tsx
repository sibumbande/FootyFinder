import type { PersonalDataExport } from '@footy-finder/shared';
import { ApiError } from '@footy-finder/api-client';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Input } from '@/components/ui/Input.js';
import { formatWhen } from '../format.js';
import { useDownloadData } from '../hooks/useAccount.js';

const saveJson = (data: PersonalDataExport) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `footyfinder-my-data-${data.generatedAt.slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-lg font-bold text-content-strong">{title}</h2>
      <div className="mt-2 grid gap-1 text-sm text-content">{children}</div>
    </section>
  );
}
const Row = ({ label, value }: { label: string; value: ReactNode }) => (
  <p>
    <span className="text-content-muted">{label}: </span>
    {value ?? '—'}
  </p>
);
const count = (items: unknown[], one: string, many: string) => `${items.length} ${items.length === 1 ? one : many}`;

/** The readable summary of the JSON (print it, or save it as a PDF from the print dialog). */
function Summary({ data }: { data: PersonalDataExport }) {
  const { account, profile } = data;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-content-muted">{data.about} Created {formatWhen(data.generatedAt)}.</p>
      <Block title="Account">
        <Row label="Email" value={account.email} />
        <Row label="Username" value={`@${account.username}`} />
        <Row label="Joined" value={formatWhen(account.createdAt)} />
        <Row label="Incoming friend requests" value={account.friendRequestsEnabled ? 'On' : 'Off'} />
      </Block>
      <Block title="Profile">
        <Row label="Display name" value={profile.displayName} />
        <Row label="Date of birth" value={profile.dateOfBirth} />
        <Row label="Gender" value={profile.gender?.toLowerCase()} />
        <Row label="City" value={profile.city} />
        <Row label="Home area" value={profile.homeArea} />
        <Row label="Preferred positions" value={profile.preferredPositions.map((p) => p.toLowerCase()).join(', ') || null} />
        <Row label="Preferred foot" value={profile.dominantFoot?.toLowerCase()} />
        <Row label="Years of experience" value={profile.yearsExperience} />
        <Row label="Bio" value={profile.bio} />
        <Row label="Profile photo" value={profile.photo ? `uploaded ${formatWhen(profile.photo.uploadedAt)}` : 'none'} />
      </Block>
      <Block title="Matches and results">
        <Row label="Matches joined" value={data.matches.length} />
        <Row label="Played" value={`${data.statistics.matchesPlayed} (${data.statistics.wins} won, ${data.statistics.draws} drawn, ${data.statistics.losses} lost)`} />
        <Row label="Goals and assists" value={`${data.statistics.goals} goals, ${data.statistics.assists} assists`} />
        {data.matches.slice(-10).map((match) => (
          <p key={`${match.matchId}-${match.joinedAt}`} className="text-content-muted">
            {formatWhen(match.startsAt)} · {match.name} · {match.yourStatus.toLowerCase()}
          </p>
        ))}
      </Block>
      <Block title="Tickets and payments">
        <Row label="Match tickets" value={count(data.tickets, 'ticket', 'tickets')} />
        <Row label="Match credits" value={count(data.matchCredits, 'credit', 'credits')} />
        <Row label="Payments" value={count(data.payments, 'payment', 'payments')} />
        {(data.earlierPaymentRecords.walletEntries.length > 0 || data.earlierPaymentRecords.topUps.length > 0 || data.earlierPaymentRecords.teamWalletEntries.length > 0) && (
          <Row
            label="Earlier payment records"
            value={count([...data.earlierPaymentRecords.walletEntries, ...data.earlierPaymentRecords.topUps, ...data.earlierPaymentRecords.teamWalletEntries], 'record', 'records')}
          />
        )}
      </Block>
      <Block title="Teams and people">
        <Row label="Teams" value={data.teams.map((team) => `${team.name} (${team.role.toLowerCase()})`).join(', ') || 'none'} />
        <Row label="Friends" value={data.friends.map((friend) => friend.displayName).join(', ') || 'none'} />
        <Row label="Friend requests" value={data.friendRequests.length} />
        <Row label="Players you blocked" value={data.blockedPlayers.length} />
        <Row label="Team reviews you wrote" value={data.teamReviews.length} />
      </Block>
      <Block title="Messages you sent">
        <Row label="Direct messages" value={data.messagesSent.direct.length} />
        <Row label="Lobby chat" value={data.messagesSent.lobbyChat.length} />
        <Row label="Team chat" value={data.messagesSent.teamChat.length} />
        <p className="text-content-muted">The full text of each message is in the JSON file.</p>
      </Block>
      <Block title="Consents and Terms">
        {data.termsAcceptances.map((item) => (
          <Row key={`${item.type}-${item.version}`} label={`${item.document} v${item.version}`} value={`accepted ${formatWhen(item.acceptedAt)}`} />
        ))}
        {data.consents.cityWaitingList.map((item) => (
          <Row key={item.city} label={`Waiting list: ${item.city}`} value={item.unsubscribedAt ? 'unsubscribed' : `since ${formatWhen(item.consentedAt)}`} />
        ))}
      </Block>
    </div>
  );
}

/** CEO batch 5, item 5: "Download my data" (POPIA right of access; ToS 8.7 and 8.13). */
export function DownloadDataPage() {
  const download = useDownloadData();
  const [password, setPassword] = useState('');
  const [data, setData] = useState<PersonalDataExport>();
  const limited = download.error instanceof ApiError && download.error.code === 'DATA_EXPORT_RATE_LIMITED';
  const availableAt = limited ? (download.error as ApiError).details as { availableAt?: string } | undefined : undefined;
  return (
    <section className="mx-auto grid max-w-3xl gap-4">
      <div className="print:hidden">
        <h1 className="text-3xl font-bold text-content-strong">Download my data</h1>
        <p className="mt-1 text-content-muted">
          Get a copy of the personal data FootyFinder holds about you: your profile, matches, results, tickets and payments,
          teams, friends, the messages you sent, your consents and your Terms acceptances. You can do this once every
          24 hours.
        </p>
      </div>
      {!data && (
        <form
          className="grid gap-3 rounded-2xl border border-line bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            download.mutate({ password }, {
              onSuccess: ({ data: result }) => {
                setData(result);
                setPassword('');
                saveJson(result);
              },
            });
          }}
        >
          <Input label="Your password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <FormError
            message={
              limited
                ? `You can download your data once every 24 hours.${availableAt?.availableAt ? ` Try again after ${formatWhen(availableAt.availableAt)}.` : ''}`
                : download.error?.message
            }
          />
          <Button type="submit" loading={download.isPending} disabled={!password}>
            Download my data
          </Button>
        </form>
      )}
      {data && (
        <>
          <div className="flex flex-wrap gap-3 print:hidden">
            <Button onClick={() => saveJson(data)}>Save the JSON file again</Button>
            <Button variant="secondary" onClick={() => window.print()}>
              Print or save as PDF
            </Button>
          </div>
          <Summary data={data} />
        </>
      )}
    </section>
  );
}
