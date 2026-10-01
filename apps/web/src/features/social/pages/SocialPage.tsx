import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DiscoverTab } from '../components/DiscoverTab.js';
import { DmsTab } from '../components/DmsTab.js';
import { FriendsTab } from '../components/FriendsTab.js';
import { TeamsTab } from '../components/TeamsTab.js';
import { useSocialSummary } from '../hooks/useSocial.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { SignUpPrompt } from '@/features/public/components/SignUpPrompt.js';

export const SOCIAL_TABS = ['discover', 'friends', 'teams', 'dms'] as const;
export type SocialTab = (typeof SOCIAL_TABS)[number];
const placeholders: Record<SocialTab, string> = {
  discover: 'Search profiles by name...',
  friends: 'Search your friends...',
  teams: 'Search teams and players...',
  dms: 'Search conversations...',
};

/** Gate 9 / TKT-902: the Social area (CEO screenshot): Discover, Friends, Teams and DMs. */
export function SocialPage() {
  const [params, setParams] = useSearchParams();
  const tab: SocialTab = SOCIAL_TABS.includes(params.get('tab') as SocialTab) ? (params.get('tab') as SocialTab) : 'discover';
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const summary = useSocialSummary();
  const { user } = useAuth();
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 250);
    return () => clearTimeout(timer);
  }, [input]);
  const select = (next: SocialTab) => {
    setInput('');
    setQuery('');
    setParams(next === 'discover' ? {} : { tab: next }, { replace: true });
  };
  const counts: Partial<Record<SocialTab, number>> = {
    friends: summary.data?.friends,
    dms: summary.data?.unreadConversations || undefined,
  };
  const labels: Record<SocialTab, string> = { discover: 'Discover', friends: 'Friends', teams: 'Teams', dms: 'DMs' };

  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="rounded-[2rem] border border-line bg-surface p-5 shadow-sm sm:p-10">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-4xl font-black uppercase leading-none tracking-tight text-content-strong">Social network</h1>
            <p className="mt-3 text-[11px] font-black uppercase tracking-[0.14em] text-content-muted">Players, friends, and squads in your city</p>
          </div>
          {/* CEO touch-up batch 3, item 9: on phones one full-width drop-down instead of pills that wrap unevenly. */}
          <label className="grid gap-1 sm:hidden">
            <span className="text-xs font-black uppercase tracking-[0.08em] text-content-muted">Section</span>
            <select
              value={tab}
              onChange={(event) => select(event.target.value as SocialTab)}
              className="h-12 w-full rounded-2xl border-2 border-line-strong bg-surface px-4 text-base font-black text-content-strong"
              data-testid="social-section-select"
            >
              {SOCIAL_TABS.map((item) => (
                <option key={item} value={item}>
                  {labels[item]}{counts[item] !== undefined ? ` (${counts[item]})` : ''}{item === 'friends' && summary.data?.incomingRequests ? ` · ${summary.data.incomingRequests} new ${summary.data.incomingRequests === 1 ? 'request' : 'requests'}` : ''}
                </option>
              ))}
            </select>
          </label>
          <nav className="hidden w-full flex-wrap gap-1 rounded-full bg-surface-muted p-1.5 sm:flex sm:w-auto" role="tablist" aria-label="Social">
            {SOCIAL_TABS.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={tab === item}
                onClick={() => select(item)}
                className={`relative flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-[11px] font-black uppercase tracking-[0.08em] transition sm:flex-none ${tab === item ? 'bg-brand-600 text-content-inverse shadow-[0_6px_16px_rgb(var(--theme-brand-600)/0.35)]' : 'text-content-muted hover:text-content-strong'}`}
              >
                {item === 'dms' && (
                  <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></svg>
                )}
                {labels[item]}
                {counts[item] !== undefined && <span>({counts[item]})</span>}
                {item === 'friends' && Boolean(summary.data?.incomingRequests) && (
                  <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-danger-600" aria-label={`${summary.data!.incomingRequests} new friend ${summary.data!.incomingRequests === 1 ? 'request' : 'requests'}`} />
                )}
              </button>
            ))}
          </nav>
        </div>
        <label className="mx-auto mt-4 flex w-full max-w-2xl items-center gap-3 rounded-full border border-line bg-surface-muted px-5 py-3 focus-within:ring-4 focus-within:ring-brand-100 sm:mt-8 sm:py-4">
          <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-content-muted" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <span className="sr-only">Search</span>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={placeholders[tab]}
            className="w-full bg-transparent font-bold text-content-strong placeholder:text-content-muted focus:outline-none"
            data-testid="social-search"
          />
        </label>
      </div>
      <div className="rounded-[2rem] border border-line bg-surface p-5 shadow-sm sm:p-8">
        {!user && tab !== 'teams' && (
          <SignUpPrompt action={tab === 'discover' ? 'search players and add friends' : tab === 'friends' ? 'add friends' : 'send messages'} />
        )}
        {user && tab === 'discover' && <DiscoverTab query={query} />}
        {user && tab === 'friends' && <FriendsTab query={query} />}
        {tab === 'teams' && <TeamsTab query={query} signUpAction={<SignUpPrompt action="ask to join" compact />} />}
        {user && tab === 'dms' && <DmsTab query={query} />}
      </div>
    </section>
  );
}
