import { MATCH_FORMAT_CONFIG, type AdminMatchDetail } from '@footy-finder/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { adminClient } from './api.js';
import { FreeMatchControl } from './FreeMatchControl.js';
import { GirlsOnlyControl } from './GirlsOnlyControls.js';
import { CancelPanel, InvitePanel, RefereePanel, matchesKey, rands, time, when } from './MatchActions.js';
import { MatchResultPanel } from './MatchResultPanel.js';

/**
 * CEO touch-up batch 3.5, item 5: one page with everything about a match and every admin action on it: referee,
 * free match, invite link, cancellation, result entry or correction, problem reports, players and money. Each
 * action keeps its existing rules (fresh MFA where it already applied).
 */
export function MatchPage() {
  const { matchId = '' } = useParams();
  const detail = useQuery({
    queryKey: [...matchesKey, 'detail-page', matchId],
    queryFn: async () => (await adminClient.adminMatch(matchId)).data,
    refetchInterval: 30_000,
  });
  const match = detail.data;
  return (
    <section>
      <Link to="/matches">← All matches</Link>
      {detail.error && <p className="error">{detail.error.message}</p>}
      {match && (
        <>
          <div className="stack compact-gap">
            <p className="eyebrow">{match.mode === 'TEAM_MATCH' ? 'Team match' : 'Quick match'}</p>
            <h2>{match.name}</h2>
            <p className="muted">
              {MATCH_FORMAT_CONFIG[match.format].label} · {match.venueName}{match.fieldName && !match.venueName.includes(match.fieldName) ? ` — ${match.fieldName}` : ''} · {when(match.startsAt)}–{time(match.matchEndsAt)}
            </p>
            <div className="row">
              <span className="pill" data-testid="match-status">{match.status.replaceAll('_', ' ').toLowerCase()}</span>
              <span className="pill">{match.visibility === 'PRIVATE' ? 'Private' : 'Public'}</span>
              <span className="pill">{match.hostedByFootyFinder ? 'Hosted by FootyFinder' : `Host: ${match.hostName}`}</span>
              {match.freeOnFootyFinder && <span className="pill">Free{match.firstTimersOnly ? ' · first-time players only' : ''}</span>}
              {match.girlsOnly && <span className="pill">Girls only</span>}
              {match.publicUrl && <a href={match.publicUrl} target="_blank" rel="noreferrer">Public page</a>}
            </div>
          </div>
          <article className="venue-card">
            <PlayersAndMoney match={match} />
          </article>
          <article className="venue-card">
            <RefereePanel match={match} />
          </article>
          {match.mode === 'QUICK_GAME' && !['CANCELLED', 'COMPLETED'].includes(match.status) && (
            <article className="venue-card">
              <FreeMatchControl match={match} rootKey={matchesKey} />
            </article>
          )}
          {!match.started && !['CANCELLED', 'COMPLETED'].includes(match.status) && (
            <article className="venue-card">
              <GirlsOnlyControl match={match} rootKey={matchesKey} />
            </article>
          )}
          {match.visibility === 'PRIVATE' && match.hostedByFootyFinder && !['CANCELLED', 'COMPLETED'].includes(match.status) && (
            <article className="venue-card">
              <InvitePanel match={match} />
            </article>
          )}
          {match.status !== 'CANCELLED' && (
            <article className="venue-card">
              <CancelPanel match={match} />
            </article>
          )}
          <article className="venue-card">
            {match.started ? <MatchResultPanel matchId={match.matchId} /> : (
              <>
                <h3>Result</h3>
                <p className="muted">{match.status === 'CANCELLED' ? 'This match was cancelled.' : 'The result can be entered once the match has kicked off.'}</p>
              </>
            )}
          </article>
        </>
      )}
    </section>
  );
}

function PlayersAndMoney({ match }: { match: AdminMatchDetail }) {
  const joined = match.players.filter((player) => player.status === 'JOINED');
  const left = match.players.filter((player) => player.status !== 'JOINED');
  const venue = match.money.venue;
  return (
    <div className="stack compact-gap" data-testid="players-and-money">
      <h3>Players ({match.capacity.filled}/{match.capacity.total})</h3>
      {joined.length === 0 ? <p className="muted">Nobody has joined yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Player</th><th scope="col">Side</th><th scope="col">Place</th><th scope="col">Paid</th><th scope="col">Joined</th></tr></thead>
            <tbody>
              {joined.map((player) => (
                <tr key={player.userId}>
                  <td>{player.displayName}</td>
                  <td>{player.side === 'HOME' ? 'Home' : 'Away'}</td>
                  <td>{player.position}</td>
                  <td>{rands(player.paidCents)}</td>
                  <td>{when(player.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {left.length > 0 && (
        <p className="muted">
          Left or removed: {left.map((player) => `${player.displayName}${player.refundedCents ? ` (refunded ${rands(player.refundedCents)})` : ''}`).join(', ')}
        </p>
      )}
      <h3>Money</h3>
      <dl className="account-grid">
        <div><dt className="muted">Player fees taken</dt><dd data-testid="fees-taken">{rands(match.money.feesTakenCents)}</dd></div>
        <div><dt className="muted">Refunded</dt><dd>{rands(match.money.refundedCents)}</dd></div>
        {match.freeOnFootyFinder && <div><dt className="muted">Covered by FootyFinder (free match)</dt><dd>{rands(match.money.promotionalCostCents)}</dd></div>}
        <div>
          <dt className="muted">Venue</dt>
          <dd>
            {venue.kind === 'PAYABLE' ? `${rands(venue.amountCents)} payable (${venue.payableStatus?.toLowerCase()})`
              : venue.kind === 'EXPECTED' ? `${rands(venue.amountCents)} expected once the match goes ahead`
                : 'Nothing owed'}
          </dd>
        </div>
      </dl>
      {match.money.teamMatch && <p className="muted">Team places are match tickets for named players, so they are in the fees above.</p>}
    </div>
  );
}
