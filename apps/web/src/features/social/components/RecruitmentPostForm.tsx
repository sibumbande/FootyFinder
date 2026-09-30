import {
  FOOTBALL_POSITIONS,
  MATCH_FORMATS,
  RECRUITMENT_LEVELS,
  RECRUITMENT_NOTE_MAX,
  type RecruitmentPostInput,
  type RecruitmentPostView,
} from '@footy-finder/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { useRecruitmentAction } from '../hooks/useRecruitment.js';
import { FORMAT_LABELS, LEVEL_LABELS, positionLabel } from '../recruitment-labels.js';
import { AvailabilityPicker, positionChip } from './AvailabilityPicker.js';

const field = 'min-h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm';

/** Gate 9 / TKT-909: create or edit a recruitment post (Owner or Captain). */
export function RecruitmentPostForm({ teams, post, onDone }: { teams: Array<{ id: string; name: string }>; post?: RecruitmentPostView; onDone: () => void }) {
  const action = useRecruitmentAction();
  const [teamId, setTeamId] = useState(post?.team.id ?? teams[0]?.id ?? '');
  const [input, setInput] = useState<RecruitmentPostInput>({
    positions: post?.positions ?? [],
    playersWanted: post?.playersWanted ?? 1,
    format: post?.format ?? 'FIVE_A_SIDE',
    level: post?.level ?? 'CASUAL',
    days: post?.days ?? [],
    times: post?.times ?? [],
    area: post?.area ?? '',
    note: post?.note ?? undefined,
  });
  const set = (patch: Partial<RecruitmentPostInput>) => setInput((current) => ({ ...current, ...patch }));
  const submit = () =>
    action.mutate(post ? { kind: 'update', teamId, postId: post.id, input } : { kind: 'create', teamId, input }, { onSuccess: onDone });
  const togglePosition = (position: (typeof FOOTBALL_POSITIONS)[number]) =>
    set({ positions: input.positions.includes(position) ? input.positions.filter((item) => item !== position) : [...input.positions, position] });
  return (
    <div className="grid gap-4 rounded-2xl border border-line bg-surface p-4" data-testid="recruitment-form">
      {!post && teams.length > 1 && (
        <label className="grid gap-1 text-sm font-bold">
          Team
          <select className={field} value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
      )}
      <fieldset className="grid gap-2">
        <legend className="text-sm font-bold text-content-strong">Positions needed</legend>
        <div className="flex flex-wrap gap-1.5">
          {FOOTBALL_POSITIONS.map((position) => (
            <button key={position} type="button" aria-pressed={input.positions.includes(position)} className={positionChip(input.positions.includes(position))} onClick={() => togglePosition(position)}>
              {positionLabel(position)}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm font-bold">
          Players wanted
          <input className={field} type="number" min={1} max={99} value={input.playersWanted} onChange={(event) => set({ playersWanted: Number(event.target.value) })} />
        </label>
        <label className="grid gap-1 text-sm font-bold">
          Format
          <select className={field} value={input.format} onChange={(event) => set({ format: event.target.value as RecruitmentPostInput['format'] })}>
            {MATCH_FORMATS.map((format) => <option key={format} value={format}>{FORMAT_LABELS[format]}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold">
          Level
          <select className={field} value={input.level} onChange={(event) => set({ level: event.target.value as RecruitmentPostInput['level'] })}>
            {RECRUITMENT_LEVELS.map((level) => <option key={level} value={level}>{LEVEL_LABELS[level]}</option>)}
          </select>
        </label>
      </div>
      <AvailabilityPicker days={input.days} times={input.times} onChange={(value) => set(value)} />
      <label className="grid gap-1 text-sm font-bold">
        Area
        <input className={field} value={input.area} placeholder="e.g. Woodstock, Cape Town" onChange={(event) => set({ area: event.target.value })} />
      </label>
      <label className="grid gap-1 text-sm font-bold">
        <span>Note <span className="font-normal text-content-muted">({(input.note ?? '').length}/{RECRUITMENT_NOTE_MAX})</span></span>
        <textarea className={`${field} min-h-20 py-2`} maxLength={RECRUITMENT_NOTE_MAX} value={input.note ?? ''} onChange={(event) => set({ note: event.target.value || undefined })} />
      </label>
      <FormError message={action.error?.message} />
      <div className="flex gap-2">
        <Button onClick={submit} loading={action.isPending} disabled={!teamId || !input.positions.length || input.area.trim().length < 2}>
          {post ? 'Save post' : 'Post'}
        </Button>
        <Button variant="secondary" type="button" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}
