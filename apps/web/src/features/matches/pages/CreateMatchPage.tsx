import {
  DEFAULT_SUBSTITUTE_CAPACITY_PER_TEAM,
  formatRandAmount,
  formatTeamFeeBreakdown,
  getGoNoGoAt,
  getMaxMatchParticipants,
  getTeamFee,
  MATCH_FORMAT_CONFIG,
  MATCH_FORMATS,
  MATCH_RULE_CONFIG,
  MATCH_RULES,
  MAX_SUBSTITUTES_PER_TEAM,
  MATCH_FEE_CENTS,
  TEAM_MATCH_UNMATCHED_CANCEL_HOURS,
  type MatchFormat,
  type MatchRule,
  type MatchVisibility,
  type TeamMatchOtherSideMode,
} from '@footy-finder/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Input } from '@/components/ui/Input.js';
import { formatRands } from '@/utils/format-currency.js';
import { useMyTeams } from '@/features/teams/hooks/useTeams.js';
import { useTeamWalletSummary } from '@/features/teams/hooks/useTeamWallet.js';
import { useCreateMatch } from '../hooks/useMatches.js';
import { useVenue } from '@/features/venues/hooks/useVenues.js';
import { formatClock, rands } from '../utils/go-no-go-format.js';
import { VenueSlotPicker } from '../components/VenueSlotPicker.js';

/**
 * Everything entered in the wizard is kept for this browser tab (sessionStorage), so a refresh or
 * arriving from a venue page's slot never loses it. It is cleared once the match is published.
 */
export const CREATE_MATCH_DRAFT_KEY = 'ff:create-match-draft';
type Draft = {
  playAs: string; step: number; format: MatchFormat; substituteCapacityPerTeam: number; rollingSubstitutes: boolean; rules: MatchRule[];
  visibility: MatchVisibility; name: string; description: string; otherSideMode: TeamMatchOtherSideMode | null; teamSubs: number;
};
const readDraft = (): Partial<Draft> => {
  try {
    return JSON.parse(sessionStorage.getItem(CREATE_MATCH_DRAFT_KEY) ?? '{}') as Partial<Draft>;
  } catch {
    return {};
  }
};
const clearDraft = () => {
  try {
    sessionStorage.removeItem(CREATE_MATCH_DRAFT_KEY);
  } catch {
    // Storage can be unavailable (private mode); the wizard still works without a draft.
  }
};

/**
 * DEC-018 / DEC-020: tell the host, before they confirm, that a match without every position filled
 * and a FootyFinder referee assigned is cancelled at T-30.
 */
function GoNoGoNotice({ startsAt }: { startsAt: string }) {
  if (!startsAt || Number.isNaN(new Date(startsAt).getTime())) return null;
  return (
    <p
      data-testid="go-no-go-notice"
      className="rounded-2xl border border-warning-300 bg-warning-50 p-4 text-sm font-semibold text-content"
    >
      Heads up: this match goes ahead only if every position is filled and a FootyFinder referee is
      assigned 30 minutes before kickoff ({formatClock(getGoNoGoAt(startsAt).toISOString())}). If not,
      it&apos;s cancelled automatically and every player gets their {rands(MATCH_FEE_CENTS)} refunded
      to their wallet.
    </p>
  );
}

/** Gate 7 / DEC-019: the go/no-go rule for a team match, in the words the Terms use. */
export function TeamGoNoGoNotice({ startsAt, mode }: { startsAt: string; mode: TeamMatchOtherSideMode | null }) {
  if (!startsAt || Number.isNaN(new Date(startsAt).getTime()) || !mode) return null;
  const at = formatClock(getGoNoGoAt(startsAt).toISOString());
  return (
    <p data-testid="team-go-no-go-notice" className="rounded-2xl border border-warning-300 bg-warning-50 p-4 text-sm font-semibold text-content">
      {mode === 'TEAMS_ONLY'
        ? `Heads up: this match goes ahead only if both teams' fill meters are full by ${at} (30 minutes before kickoff). Otherwise it's cancelled and all held money goes back to each team wallet. If no team has taken the other side ${TEAM_MATCH_UNMATCHED_CANCEL_HOURS} hours before kickoff, it's cancelled then. A FootyFinder referee must also be assigned by ${at}.`
        : `Heads up: this match goes ahead only if, by ${at} (30 minutes before kickoff), your team's fill meter is full and the other side is ready: either the other team's meter is full, or players have claimed every starting position. Otherwise it's cancelled, held money goes back to each team wallet and every player's ${rands(MATCH_FEE_CENTS)} is refunded. A FootyFinder referee must also be assigned by ${at}.`}
    </p>
  );
}

type StepKey = 'playAs' | 'format' | 'squad' | 'visibility' | 'details' | 'venue' | 'schedule' | 'otherSide' | 'subs' | 'review';
const STEP_LABEL: Record<StepKey, string> = {
  playAs: 'Play as',
  format: 'Format',
  squad: 'Squad rules',
  visibility: 'Visibility',
  details: 'Details',
  venue: 'Venue',
  schedule: 'Schedule',
  otherSide: 'Other side',
  subs: 'Subs and fee',
  review: 'Finalise',
};
const QUICK_STEPS: StepKey[] = ['format', 'squad', 'visibility', 'details', 'venue', 'schedule', 'review'];
const TEAM_STEPS: StepKey[] = ['details', 'venue', 'schedule', 'otherSide', 'subs', 'review'];

/**
 * One wizard for Quick Matches and (Gate 7 / DEC-019) team matches. A team owner or captain can
 * start it from their team page (play-as locked to that team) or here, by choosing "Play as".
 */
export function CreateMatchPage() {
  const [search, setSearch] = useSearchParams();
  const [draft] = useState(readDraft);
  // The saved step only applies to the same "Play as" choice (quick and team matches have different steps).
  const [step, setStep] = useState(draft.playAs === (search.get('playAs') ?? '') ? (draft.step ?? 0) : 0);
  const [format, setFormat] = useState<MatchFormat>(draft.format ?? 'FIVE_A_SIDE');
  const [substituteCapacityPerTeam, setSubstituteCapacityPerTeam] = useState(
    draft.substituteCapacityPerTeam ?? DEFAULT_SUBSTITUTE_CAPACITY_PER_TEAM,
  );
  const [rollingSubstitutes, setRollingSubstitutes] = useState(draft.rollingSubstitutes ?? false);
  const [rules, setRules] = useState<MatchRule[]>(draft.rules ?? []);
  const [visibility, setVisibility] = useState<MatchVisibility>(draft.visibility ?? 'PUBLIC');
  const [name, setName] = useState(draft.name ?? '');
  const [description, setDescription] = useState(draft.description ?? '');
  const [otherSideMode, setOtherSideMode] = useState<TeamMatchOtherSideMode | null>(draft.otherSideMode ?? null);
  const [teamSubs, setTeamSubs] = useState(draft.teamSubs ?? 3);
  useEffect(() => {
    try {
      sessionStorage.setItem(CREATE_MATCH_DRAFT_KEY, JSON.stringify({ playAs: search.get('playAs') ?? '', step, format, substituteCapacityPerTeam, rollingSubstitutes, rules, visibility, name, description, otherSideMode, teamSubs } satisfies Draft));
    } catch {
      // Storage can be unavailable (private mode); the wizard still works without a draft.
    }
  }, [search, step, format, substituteCapacityPerTeam, rollingSubstitutes, rules, visibility, name, description, otherSideMode, teamSubs]);
  const venueSlug = search.get('venue') ?? '';
  const fieldId = search.get('field') ?? '';
  const startsAt = search.get('startsAt') ?? '';
  const selectedFormat = search.get('format') as MatchFormat | null;
  const playAsParam = search.get('playAs') ?? '';
  const playAsTeamId = playAsParam.startsWith('team:') ? playAsParam.slice(5) : null;
  const playAsLocked = search.get('lock') === '1' && Boolean(playAsTeamId);
  const myTeams = useMyTeams();
  const manageableTeams = (myTeams.data ?? []).filter(
    (team) => (team.viewerRole === 'OWNER' || team.viewerRole === 'CAPTAIN') && !team.archivedAt,
  );
  const playAsTeam = manageableTeams.find((team) => team.id === playAsTeamId) ?? null;
  const teamMode = Boolean(playAsTeamId);
  const venueQuery = useVenue(venueSlug);
  const selectedField = venueQuery.data?.venue.fields.find((item) => item.id === fieldId);
  const navigate = useNavigate();
  const creation = useCreateMatch();
  const teamWallet = useTeamWalletSummary(playAsTeamId ?? '', teamMode);
  const matchFormat = teamMode ? (selectedFormat ?? 'FIVE_A_SIDE') : format;
  const config = MATCH_FORMAT_CONFIG[matchFormat];
  const teamFee = getTeamFee(matchFormat, teamSubs);
  const walletShort = teamMode && teamWallet.data ? teamWallet.data.availableCents < teamFee.totalCents : false;
  const showPlayAs = !playAsLocked && manageableTeams.length > 0;
  const steps: StepKey[] = [...(showPlayAs ? (['playAs'] as const) : []), ...(teamMode ? TEAM_STEPS : QUICK_STEPS)];
  const current = steps[Math.min(step, steps.length - 1)]!;
  // Re-check the team wallet each time the review opens (members may have just topped it up).
  const refetchTeamWallet = teamWallet.refetch;
  useEffect(() => {
    if (teamMode && current === 'review') void refetchTeamWallet();
  }, [current, teamMode, refetchTeamWallet]);
  const pickSlot = (slot: { venue: string; fieldId: string; format: MatchFormat; startsAt: string }) => {
    const next = new URLSearchParams(search);
    next.set('venue', slot.venue);
    next.set('field', slot.fieldId);
    next.set('format', slot.format);
    next.set('startsAt', slot.startsAt);
    setSearch(next, { replace: true });
    setStep(steps.indexOf('venue') + 1);
  };
  const choosePlayAs = (teamId: string | null) => {
    const next = new URLSearchParams(search);
    if (teamId) next.set('playAs', `team:${teamId}`);
    else next.delete('playAs');
    setSearch(next, { replace: true });
  };
  const valid: Record<StepKey, boolean> = {
    playAs: !teamMode || Boolean(playAsTeam),
    format: true,
    squad: substituteCapacityPerTeam >= 0 && substituteCapacityPerTeam <= MAX_SUBSTITUTES_PER_TEAM,
    visibility: true,
    details: name.trim().length >= 3,
    venue: Boolean(selectedField && startsAt && (teamMode ? selectedFormat : selectedFormat === format)),
    schedule: Boolean(startsAt),
    otherSide: Boolean(otherSideMode),
    subs: teamSubs >= 0 && teamSubs <= MAX_SUBSTITUTES_PER_TEAM,
    review: true,
  };
  // A restored draft never lands past a step that still needs filling in (no name or no slot yet).
  const missingStep = steps.findIndex((key) => (key === 'details' && !valid.details) || (key === 'venue' && !startsAt));
  useEffect(() => {
    if (missingStep >= 0) setStep((value) => Math.min(value, missingStep));
  }, [missingStep]);
  const submit = () => {
    if (!selectedField || !startsAt) return;
    const base = { name, description, rollingSubstitutes, rules, startsAt, managedFieldId: selectedField.id };
    const input = teamMode && playAsTeamId && otherSideMode
      ? { ...base, format: matchFormat, substituteCapacityPerTeam: teamSubs, visibility: 'PUBLIC' as const, playAsTeamId, otherSideMode, teamSubstituteCount: teamSubs }
      : { ...base, format, substituteCapacityPerTeam, visibility };
    // After publishing, open the new match at its formation (quick match) or lineup (team match).
    creation.mutate(input, {
      onSuccess: ({ data }) => {
        clearDraft();
        navigate(`/matches/${data.id}#formation`, { replace: true });
      },
    });
  };
  return (
    <section className="mx-auto grid max-w-5xl gap-7">
      <div>
        <p className="anime-kicker">{teamMode ? 'Create a team match' : 'Create a match'}</p>
        <h1 className="mt-3 text-4xl font-black uppercase leading-none text-content-strong">
          {teamMode ? `Put ${playAsTeam?.name ?? 'your team'} on the pitch.` : 'Build your next football lobby.'}
        </h1>
        <p className="mt-2 text-content-muted">
          {teamMode
            ? 'Team matches are always public. Your team pays R80 for every starting position plus every sub you bring, from the team wallet.'
            : 'Choose the format, squad rules, privacy, venue and schedule. Every player pays a fixed R80 to join.'}
        </p>
      </div>
      <div>
        <div className="mb-3 flex justify-between text-xs font-bold uppercase tracking-wide text-content-muted">
          <span>
            Step {step + 1} of {steps.length}
          </span>
          <span>{STEP_LABEL[current]}</span>
        </div>
        <div className="h-3 -skew-x-12 overflow-hidden rounded-sm border border-line-strong bg-line">
          <div
            className="h-full bg-danger-600 shadow-[inset_0_-3px_0_rgb(var(--theme-accent-gold)/0.5)] transition-all"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>
      <div className="anime-panel p-5 sm:p-8">
        {current === 'playAs' && (
          <Step title="Play as" detail="Play as yourself in a quick match, or put one of your teams on the pitch.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Choice selected={!teamMode} onClick={() => choosePlayAs(null)}>
                <strong className="text-lg text-content-strong">Myself (quick match)</strong>
                <span className="mt-2 block text-sm text-content-muted">Every player pays R80 to join.</span>
              </Choice>
              {manageableTeams.map((team) => (
                <Choice key={team.id} selected={playAsTeamId === team.id} onClick={() => choosePlayAs(team.id)}>
                  <strong className="text-lg text-content-strong">My team {team.name}</strong>
                  <span className="mt-2 block text-sm text-content-muted">A public team match paid from the team wallet.</span>
                </Choice>
              ))}
            </div>
          </Step>
        )}
        {current === 'format' && (
          <Step
            title="Choose a match format"
            detail="Format controls the starter count and formation slots."
          >
            <div className="grid gap-4 md:grid-cols-3">
              {MATCH_FORMATS.map((item) => {
                const option = MATCH_FORMAT_CONFIG[item];
                return (
                  <Choice key={item} selected={format === item} onClick={() => setFormat(item)}>
                    <span className="text-2xl font-black text-content-strong">
                      {option.shortLabel}
                    </span>
                    <span className="mt-1 block font-semibold text-content">{option.label}</span>
                    <span className="mt-3 block text-sm text-content-muted">
                      {option.startersPerTeam} starters per team
                    </span>
                    <span className="mt-1 block text-sm font-bold text-brand-700">
                      Up to {MAX_SUBSTITUTES_PER_TEAM} substitutes per team
                    </span>
                  </Choice>
                );
              })}
            </div>
          </Step>
        )}
        {current === 'squad' && (
          <Step
            title="Configure the squads"
            detail="Choose how much room each team has beyond its starting lineup."
          >
            <Input
              label="Substitutes per team"
              type="number"
              min="0"
              max={MAX_SUBSTITUTES_PER_TEAM}
              step="1"
              value={substituteCapacityPerTeam}
              onChange={(event) => setSubstituteCapacityPerTeam(Number(event.target.value))}
              hint={`Choose 0–${MAX_SUBSTITUTES_PER_TEAM}. This match can hold ${getMaxMatchParticipants(format, substituteCapacityPerTeam)} players in total.`}
            />
            <label className="flex cursor-pointer gap-3 rounded-2xl border border-line bg-surface-muted p-4">
              <input
                className="mt-1 h-4 w-4 accent-brand-600"
                type="checkbox"
                checked={rollingSubstitutes}
                onChange={(event) => setRollingSubstitutes(event.target.checked)}
              />
              <span>
                <strong className="block text-content-strong">Rolling substitutions</strong>
                <span className="mt-1 block text-sm text-content-muted">
                  Players may rotate on and off during the match.
                </span>
              </span>
            </label>
            <div>
              <p className="mb-2 text-sm font-semibold text-content">Informational rules</p>
              {MATCH_RULES.map((rule) => (
                <label
                  key={rule}
                  className="flex cursor-pointer gap-3 rounded-2xl border border-line bg-surface-muted p-4"
                >
                  <input
                    className="mt-1 h-4 w-4 accent-brand-600"
                    type="checkbox"
                    checked={rules.includes(rule)}
                    onChange={(event) =>
                      setRules((currentRules) =>
                        event.target.checked
                          ? [...currentRules, rule]
                          : currentRules.filter((item) => item !== rule),
                      )
                    }
                  />
                  <span>
                    <strong className="block text-content-strong">
                      {MATCH_RULE_CONFIG[rule].label}
                    </strong>
                    <span className="mt-1 block text-sm text-content-muted">
                      {MATCH_RULE_CONFIG[rule].description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </Step>
        )}
        {current === 'visibility' && (
          <Step
            title="Who can discover this match?"
            detail="Visibility cannot be changed after creation."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Choice selected={visibility === 'PUBLIC'} onClick={() => setVisibility('PUBLIC')}>
                <strong className="text-lg text-content-strong">Public</strong>
                <span className="mt-2 block text-sm text-content-muted">
                  Appears in match discovery and can be joined by eligible players.
                </span>
              </Choice>
              <Choice selected={visibility === 'PRIVATE'} onClick={() => setVisibility('PRIVATE')}>
                <strong className="text-lg text-content-strong">Private</strong>
                <span className="mt-2 block text-sm text-content-muted">
                  Hidden from discovery. You receive a secure invitation link.
                </span>
              </Choice>
            </div>
          </Step>
        )}
        {current === 'details' && (
          <Step title="Match details" detail="Give players a clear idea of the game.">
            <Input
              label="Match name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              error={
                name.length > 0 && name.trim().length < 3 ? 'Use at least 3 characters.' : undefined
              }
            />
            <label className="grid gap-2 text-sm font-semibold text-content">
              Description
              <textarea
                className="min-h-28 rounded-xl border border-line-strong bg-surface px-3.5 py-3 font-normal text-content-strong"
                maxLength={1000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          </Step>
        )}
        {current === 'venue' && (
          <Step
            title="Select a venue and time"
            detail={teamMode ? 'Choose a FootyFinder venue, then a free 60-minute slot. The slot sets the format.' : `Choose a FootyFinder venue, then a free 60-minute slot for ${MATCH_FORMAT_CONFIG[format].shortLabel}.`}
          >
            <VenueSlotPicker format={teamMode ? undefined : format} selected={{ venue: venueSlug, fieldId, startsAt }} onPick={pickSlot} />
            {selectedField && startsAt ? <div className="rounded-2xl border border-brand-300 bg-brand-50 p-5"><strong className="text-content-strong">{venueQuery.data?.venue.name} — {selectedField.name}</strong><span className="mt-2 block text-sm text-content-muted">{venueQuery.data?.venue.addressLine1}</span>{teamMode && selectedFormat && <span className="mt-2 block text-sm font-bold text-content">{MATCH_FORMAT_CONFIG[selectedFormat].label}</span>}<span className="mt-2 block text-sm font-bold text-content">{new Date(startsAt).toLocaleString()}</span></div> : null}
          </Step>
        )}
        {current === 'schedule' && (
          <Step
            title="Schedule"
            detail={teamMode ? 'Every match lasts 60 minutes.' : 'Every match lasts 60 minutes. Players pay only when they join a team.'}
          >
            <div className="rounded-2xl bg-surface-muted p-4"><span className="text-xs font-bold uppercase text-content-muted">Selected kickoff</span><strong className="mt-1 block text-content-strong">{startsAt ? new Date(startsAt).toLocaleString() : 'Choose a venue slot'}</strong></div>
            {!teamMode && (
              <p data-testid="fixed-fee-notice" className="rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm font-semibold text-brand-700">
                Every player pays {formatRands(MATCH_FEE_CENTS)} to join, including subs. The fee is set by Footy Finder. As the host you place no deposit or guarantee, and you only pay if you join a team.
              </p>
            )}
            {teamMode ? <TeamGoNoGoNotice startsAt={startsAt} mode={otherSideMode ?? 'TEAMS_ONLY'} /> : <GoNoGoNotice startsAt={startsAt} />}
          </Step>
        )}
        {current === 'otherSide' && (
          <Step title="Who can take the other side?" detail="Whoever comes first takes it straight away. You can't turn them away; your only way out is cancelling before the 30-minute check.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Choice selected={otherSideMode === 'TEAMS_ONLY'} onClick={() => setOtherSideMode('TEAMS_ONLY')}>
                <strong className="text-lg text-content-strong">Teams only</strong>
                <span className="mt-2 block text-sm text-content-muted">Only another team can take the other side. They load their whole team with one button and pay their own team fee.</span>
              </Choice>
              <Choice selected={otherSideMode === 'OPEN'} onClick={() => setOtherSideMode('OPEN')}>
                <strong className="text-lg text-content-strong">Open to both</strong>
                <span className="mt-2 block text-sm text-content-muted">Another team or individual players, whichever comes first. Players pay R80 each, like a quick match.</span>
              </Choice>
            </div>
          </Step>
        )}
        {current === 'subs' && (
          <Step title="Your subs and team fee" detail="Your team pays R80 for every starting position plus every sub you bring. FootyFinder sets the R80.">
            <Input
              label="Subs your team brings"
              type="number"
              min="0"
              max={MAX_SUBSTITUTES_PER_TEAM}
              step="1"
              value={teamSubs}
              onChange={(event) => setTeamSubs(Math.max(0, Math.min(MAX_SUBSTITUTES_PER_TEAM, Math.trunc(Number(event.target.value) || 0))))}
              hint={`Choose 0–${MAX_SUBSTITUTES_PER_TEAM}. You can change this until 30 minutes before kickoff.`}
            />
            <p data-testid="team-fee-breakdown" className="rounded-2xl border border-brand-200 bg-brand-50 p-4 text-lg font-black text-brand-800">
              {formatTeamFeeBreakdown(teamFee)}
            </p>
            <p className="text-sm text-content-muted">
              Nothing is taken now. Once the other side is taken, your fill meter starts at {formatRandAmount(0)} / {formatRandAmount(teamFee.totalCents)} and a captain fills it from the team wallet. The money is held, and taken only if the match goes ahead.
              {otherSideMode === 'OPEN' && ' Individual players on the other side pay R80 each from their own wallets.'}
            </p>
          </Step>
        )}
        {current === 'review' && (
          <Step
            title="Finalise match"
            detail={teamMode ? 'Your team match is published straight to the lobby.' : 'Format and visibility become immutable when you create the match.'}
          >
            <dl className="grid gap-4 rounded-2xl bg-surface-muted p-5 sm:grid-cols-2">
              <Summary label="Match" value={name} />
              {teamMode && <Summary label="Playing as" value={playAsTeam?.name ?? ''} />}
              <Summary
                label="Format"
                value={teamMode ? config.label : `${config.shortLabel} · ${getMaxMatchParticipants(format, substituteCapacityPerTeam)} players`}
              />
              {teamMode ? (
                <>
                  <Summary label="Other side" value={otherSideMode === 'OPEN' ? 'Open to both: a team or individual players' : 'Teams only'} />
                  <Summary label="Your team fee" value={formatTeamFeeBreakdown(teamFee)} />
                </>
              ) : (
                <>
                  <Summary
                    label="Squads"
                    value={`${config.startersPerTeam} starters + ${substituteCapacityPerTeam} substitutes per team`}
                  />
                  <Summary label="Substitutions" value={rollingSubstitutes ? 'Rolling' : 'Standard'} />
                  <Summary
                    label="Rules"
                    value={
                      rules.length
                        ? rules.map((rule) => MATCH_RULE_CONFIG[rule].label).join(', ')
                        : 'No additional rules'
                    }
                  />
                  <Summary
                    label="Visibility"
                    value={visibility === 'PRIVATE' ? 'Private invitation' : 'Public discovery'}
                  />
                </>
              )}
              <Summary label="Venue" value={`${venueQuery.data?.venue.name ?? ''} — ${selectedField?.name ?? ''}`} />
              <Summary label="Kickoff" value={startsAt ? new Date(startsAt).toLocaleString() : ''} />
              {!teamMode && <Summary label="Player fee" value={`${formatRands(MATCH_FEE_CENTS)} per player (fixed)`} />}
            </dl>
            {teamMode ? (
              <div data-testid="team-wallet-check" className={`rounded-2xl border p-4 text-sm font-semibold ${walletShort ? 'border-danger-200 bg-danger-50 text-danger-700' : 'border-brand-200 bg-brand-50 text-brand-700'}`}>
                {teamWallet.data
                  ? walletShort
                    ? <>Top up your team wallet to at least {formatRandAmount(teamFee.totalCents)} to publish this match. Available now: {formatRandAmount(teamWallet.data.availableCents)}. <Link className="underline" to={`/teams/${playAsTeamId}?tab=wallet`} target="_blank" rel="noreferrer">Open the team wallet</Link>{' '}<button type="button" className="font-bold underline" onClick={() => void teamWallet.refetch()}>Check again</button></>
                    : <>Team wallet available: {formatRandAmount(teamWallet.data.availableCents)} ✓ Nothing is taken until the match goes ahead.</>
                  : 'Checking the team wallet…'}
              </div>
            ) : (
              <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-700">
                <strong>You remain host-only after creation.</strong> Hosting does not consume
                capacity or charge your wallet. Join Home or Away from the lobby if you also want to
                play.
              </div>
            )}
            {teamMode ? <TeamGoNoGoNotice startsAt={startsAt} mode={otherSideMode} /> : <GoNoGoNotice startsAt={startsAt} />}
          </Step>
        )}
        <FormError message={creation.error?.message} />
        <div className="mt-7 flex justify-between border-t border-line pt-5">
          {step > 0 ? (
            <Button variant="secondary" onClick={() => setStep((value) => value - 1)}>
              Previous
            </Button>
          ) : (
            <span />
          )}
          {step < steps.length - 1 ? (
            <Button disabled={!valid[current]} onClick={() => setStep((value) => value + 1)}>
              Continue
            </Button>
          ) : (
            <Button disabled={!selectedField || !startsAt || walletShort} loading={creation.isPending} onClick={submit}>
              {teamMode ? 'Publish team match' : 'Create match'}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
function Step({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-6">
      <div>
        <h2 className="text-xl font-bold text-content-strong">{title}</h2>
        <p className="mt-1 text-sm text-content-muted">{detail}</p>
      </div>
      {children}
    </div>
  );
}
function Choice({
  selected,
  onClick,
  children,
  compact = false,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-2xl border text-left transition focus:outline-none focus:ring-4 focus:ring-brand-100 ${compact ? 'min-h-12 p-3 text-center font-bold' : 'p-5'} ${selected ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface hover:border-brand-200 hover:bg-surface-hover'}`}
    >
      {children}
    </button>
  );
}
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase text-content-muted">{label}</dt>
      <dd className="mt-1 font-semibold text-content-strong">{value}</dd>
    </div>
  );
}
