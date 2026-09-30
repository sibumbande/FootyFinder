import { FOOTBALL_POSITIONS, MATCH_FORMATS, RECRUITMENT_LEVELS } from '@footy-finder/shared';
import type { RecruitmentFilters } from '@footy-finder/api-client';
import { useState, type ReactNode } from 'react';
import { FormError } from '@/components/ui/FormError.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { useLookingPlayers, useRecruitmentPosts } from '../hooks/useRecruitment.js';
import { FORMAT_LABELS, LEVEL_LABELS, positionLabel } from '../recruitment-labels.js';
import { LookingCardItem } from './LookingCardItem.js';
import { RecruitmentPostCard } from './RecruitmentPostCard.js';
import { RecruitmentPostForm } from './RecruitmentPostForm.js';
import { SocialEmpty } from './SocialEmpty.js';

const select = 'min-h-10 rounded-full border border-line bg-surface px-3 text-xs font-bold';

/**
 * Gate 9 / TKT-909: the Teams tab is the recruitment board: "Teams recruiting" (with Ask to join)
 * and "Players looking" (with Invite), filtered by format, level, position and area.
 */
export function TeamsTab({ query, signUpAction }: { query: string; signUpAction?: ReactNode }) {
  const { user } = useAuth();
  const [view, setView] = useState<'posts' | 'looking'>('posts');
  const [filters, setFilters] = useState<RecruitmentFilters>({});
  const [posting, setPosting] = useState(false);
  const active = { ...filters, ...(query.length >= 2 ? { q: query } : {}) };
  const posts = useRecruitmentPosts(active);
  const looking = useLookingPlayers(active);
  const managed = (user?.teams ?? []).filter(({ role }) => role === 'OWNER' || role === 'CAPTAIN');
  const set = (key: keyof RecruitmentFilters, value: string) => setFilters((current) => ({ ...current, [key]: value || undefined }));
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-full bg-surface-muted p-1" role="tablist" aria-label="Recruitment">
          {([['posts', 'Teams recruiting'], ['looking', 'Players looking']] as const).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}
              className={`rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.08em] ${view === key ? 'bg-surface text-brand-700 shadow-sm' : 'text-content-muted'}`}>
              {label}
            </button>
          ))}
        </div>
        {view === 'posts' && managed.length > 0 && !posting && (
          <button type="button" className="button" onClick={() => setPosting(true)}>Post: we're recruiting</button>
        )}
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Filters">
        {view === 'posts' && (
          <>
            <select aria-label="Format" className={select} value={filters.format ?? ''} onChange={(event) => set('format', event.target.value)}>
              <option value="">Any format</option>
              {MATCH_FORMATS.map((format) => <option key={format} value={format}>{FORMAT_LABELS[format]}</option>)}
            </select>
            <select aria-label="Level" className={select} value={filters.level ?? ''} onChange={(event) => set('level', event.target.value)}>
              <option value="">Any level</option>
              {RECRUITMENT_LEVELS.map((level) => <option key={level} value={level}>{LEVEL_LABELS[level]}</option>)}
            </select>
          </>
        )}
        <select aria-label="Position" className={select} value={filters.position ?? ''} onChange={(event) => set('position', event.target.value)}>
          <option value="">Any position</option>
          {FOOTBALL_POSITIONS.map((position) => <option key={position} value={position}>{positionLabel(position)}</option>)}
        </select>
        <input aria-label="Area" className={`${select} w-40`} placeholder="Area" value={filters.area ?? ''} onChange={(event) => set('area', event.target.value)} />
      </div>
      {posting && <RecruitmentPostForm teams={managed} onDone={() => setPosting(false)} />}
      {view === 'posts' ? (
        <>
          <FormError message={posts.error?.message} />
          {posts.data?.length === 0 && <SocialEmpty message="No teams recruiting right now." />}
          <div className="grid gap-3 md:grid-cols-2">
            {posts.data?.map((post) => <RecruitmentPostCard key={post.id} post={post} signUpAction={signUpAction} />)}
          </div>
        </>
      ) : (
        <>
          <FormError message={looking.error?.message} />
          {looking.data?.length === 0 && (
            <SocialEmpty message="No players looking right now.">
              {user && <p className="max-w-sm text-sm text-content-muted">Switch on "Looking for a team" on your profile to appear here.</p>}
            </SocialEmpty>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {looking.data?.map((card) => <LookingCardItem key={card.id} card={card} />)}
          </div>
        </>
      )}
    </div>
  );
}
