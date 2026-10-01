import type { AdminMfaSetup, AuthenticatedUser, GoNoGoHealth, GoNoGoProblem } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { adminClient, authClient, usersClient } from './api.js';
import { VenuesPage } from './VenuesPage.js';
import { SupportPage } from './SupportPage.js';
import { TestDataPage } from './TestDataPage.js';
import { FinancePage } from './FinancePage.js';
import { SettlementsPage } from './SettlementsPage.js';
import { MatchLoadingPage } from './MatchLoadingPage.js';
import { ModerationPage } from './ModerationPage.js';
import { DisputesPage } from './DisputesPage.js';
import { RefereesPage } from './RefereesPage.js';
import { MatchRefereesPage } from './MatchRefereesPage.js';
import { ResultsPage } from './ResultsPage.js';
import { TeamReviewsPage } from './TeamReviewsPage.js';
import { RecruitmentPage } from './RecruitmentPage.js';
import { ThemeToggle } from './theme.js';
import { WaitingListPage } from './WaitingListPage.js';

const meKey = ['admin', 'me'] as const;
const mfaKey = ['admin', 'mfa'] as const;

function Login() {
  const cache = useQueryClient();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => authClient.login({ identifier, password }),
    onSuccess: ({ data }) => cache.setQueryData(meKey, data),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate();
  };
  return (
    <main className="center-shell">
      <form className="auth-card" onSubmit={submit}>
        <p className="eyebrow">Restricted operations</p>
        <h1>Footy Finder Admin</h1>
        <p>Use your platform administrator account. Public registration is not available here.</p>
        <label>
          Email or username
          <input
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {login.error && <p className="error">{login.error.message}</p>}
        <button disabled={login.isPending}>{login.isPending ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}

function MfaGate() {
  const cache = useQueryClient();
  const [setup, setSetup] = useState<AdminMfaSetup>();
  const [code, setCode] = useState('');
  const status = useQuery({
    queryKey: mfaKey,
    queryFn: async () => (await adminClient.authStatus()).data,
  });
  const setupMutation = useMutation({
    mutationFn: () => adminClient.setupMfa(),
    onSuccess: ({ data }) => setSetup(data),
  });
  const verify = useMutation({
    mutationFn: () => adminClient.verifyMfa({ code }),
    onSuccess: ({ data }) => cache.setQueryData(mfaKey, data),
  });
  if (status.isPending)
    return (
      <main className="center-shell">
        <p>Checking Admin session…</p>
      </main>
    );
  if (status.error)
    return (
      <main className="center-shell">
        <p className="error">{status.error.message}</p>
      </main>
    );
  if (status.data?.verified) return <AdminShell />;
  return (
    <main className="center-shell">
      <section className="auth-card">
        <p className="eyebrow">Second factor required</p>
        <h1>{status.data?.configured ? 'Verify your code' : 'Set up MFA'}</h1>
        {!status.data?.configured && !setup && (
          <button onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending}>
            Create authenticator secret
          </button>
        )}
        {setup && (
          <div className="secret">
            <strong>Store this secret in your authenticator app</strong>
            <code>{setup.secret}</code>
            <a href={setup.otpauthUri}>Open in an authenticator app</a>
            <small>The secret is shown only during initial setup.</small>
          </div>
        )}
        {(status.data?.configured || setup) && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              verify.mutate();
            }}
          >
            <label>
              Six-digit code
              <input
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            </label>
            {verify.error && <p className="error">{verify.error.message}</p>}
            <button disabled={verify.isPending}>Verify Admin session</button>
          </form>
        )}
      </section>
    </main>
  );
}

function Dashboard() {
  const summary = useQuery({
    queryKey: ['admin', 'operations', 'summary'],
    queryFn: async () => (await adminClient.operationsSummary()).data,
    refetchInterval: 30_000,
  });
  const data = summary.data;
  const money = (cents: number) =>
    new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(cents / 100);
  const metrics = data
    ? ([
        [
          'Support queue',
          data.workQueues.openSupportTickets,
          `${data.workQueues.urgentSupportTickets} urgent`,
        ],
        ['Moderation queue', data.workQueues.openModerationReports, 'open reports'],
        ['Disputes', data.workQueues.openDisputes, 'awaiting resolution'],
        ['Funding bookings', data.workQueues.fundingReservations, 'awaiting contributions'],
        [
          'Active accounts',
          data.accounts.active,
          `${data.accounts.suspended} suspended · ${data.accounts.banned} banned`,
        ],
        [
          'Live Matches',
          data.matches.inProgress,
          `${data.matches.open} open · ${data.matches.awaitingResult} awaiting result`,
        ],
        [
          'Durable jobs',
          data.durableJobs.pending,
          `${data.durableJobs.overdue} overdue · ${data.durableJobs.failed} failed`,
        ],
        [
          'Settled in 24h',
          money(data.finance24Hours.settledValueCents),
          `${data.finance24Hours.succeededTransactions} succeeded · ${data.finance24Hours.failedTransactions} failed`,
        ],
      ] as const)
    : [];
  return (
    <section>
      <div className="row between">
        <div className="stack compact-gap">
          <p className="eyebrow">Operations overview</p>
          <h2>Admin workspace</h2>
        </div>
        {data && (
          <span className="ready-pill">Database ready · {data.database.responseTimeMs} ms</span>
        )}
      </div>
      {summary.isPending && <p>Loading operational state…</p>}
      {summary.error && <p className="error">{summary.error.message}</p>}
      {data && (
        <>
          <div className="module-grid metrics-grid">
            {metrics.map(([item, value, detail]) => (
              <article key={item}>
                <span>{item}</span>
                <strong className="metric-value">{value}</strong>
                <small>{detail}</small>
              </article>
            ))}
          </div>
          <GoNoGoPanel health={data.goNoGo} />
          <UnassignedRefereesPanel />
          <ResultsAttentionPanel />
          <p className="muted">
            Updated {new Date(data.generatedAt).toLocaleTimeString()} · API uptime{' '}
            {Math.floor(data.runtime.uptimeSeconds / 60)} minutes · {data.accounts.admins}{' '}
            administrators
          </p>
          <details>
            <summary>Process counters</summary>
            <div className="process-metrics">
              {Object.entries(data.processMetrics).length === 0 && (
                <span>No lifecycle transitions recorded by this process yet.</span>
              )}
              {Object.entries(data.processMetrics).map(([name, value]) => (
                <code key={name}>
                  {name}: {value}
                </code>
              ))}
            </div>
          </details>
        </>
      )}
    </section>
  );
}

const GO_NO_GO_PROBLEM_LABELS: Record<GoNoGoProblem, string> = {
  OVERDUE: 'Overdue',
  FAILED: 'Failed',
  STALE_RUNNING: 'Stuck (worker stopped)',
  UNCONFIRMED_PAST_KICKOFF: 'Past kickoff, never decided',
};

/**
 * DEC-018: T-30 go/no-go checks that are overdue, failed or stuck, and go/no-go matches past
 * kickoff that were never decided. Refreshes with the dashboard every 30 seconds.
 */
/** Gate 8 / D2: matches that still need a referee; each is cancelled at T-30 without one. */
function UnassignedRefereesPanel() {
  const unassigned = useQuery({
    queryKey: ['admin', 'referee-matches', 'unassigned'],
    queryFn: async () => (await adminClient.refereeMatches('unassigned')).data,
    refetchInterval: 30_000,
  });
  if (!unassigned.data) return null;
  return (
    <p className={unassigned.data.length ? 'error' : 'muted'}>
      {unassigned.data.length
        ? `${unassigned.data.length} upcoming match(es) have no referee. `
        : 'Every upcoming match has a referee. '}
      <NavLink to="/match-referees">Match referees</NavLink>
    </p>
  );
}

/** Gate 8 / D4, D6: overdue results and open problem reports. */
function ResultsAttentionPanel() {
  const awaiting = useQuery({
    queryKey: ['admin', 'results', 'awaiting'],
    queryFn: async () => (await adminClient.resultQueue('awaiting')).data,
    refetchInterval: 30_000,
  });
  const problems = useQuery({
    queryKey: ['admin', 'results', 'problems', 'OPEN'],
    queryFn: async () => (await adminClient.resultProblems('OPEN')).data,
    refetchInterval: 30_000,
  });
  if (!awaiting.data || !problems.data) return null;
  const overdue = awaiting.data.filter(({ overdue: late }) => late).length;
  const attention = overdue + problems.data.length;
  return (
    <p className={attention ? 'error' : 'muted'}>
      {overdue} overdue result(s), {problems.data.length} open result report(s). <NavLink to="/results">Results</NavLink>
    </p>
  );
}

function GoNoGoPanel({ health }: { health: GoNoGoHealth }) {
  const total = health.overdue + health.staleRunning + health.failed + health.unconfirmedPastKickoff;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
  return (
    <section className={`go-no-go-panel${total > 0 ? ' alerting' : ''}`} aria-label="Go/no-go checks">
      <div className="row between">
        <h3>Go/no-go checks</h3>
        <strong>
          {total > 0
            ? `${health.overdue} overdue · ${health.failed} failed · ${health.staleRunning} stuck · ${health.unconfirmedPastKickoff} past kickoff`
            : 'All go/no-go checks on time'}
        </strong>
      </div>
      {health.items.length > 0 && (
        <ul>
          {health.items.map((item) => (
            <li key={item.jobId ?? item.matchId ?? item.problem}>
              <strong>{GO_NO_GO_PROBLEM_LABELS[item.problem]}</strong>
              <span>{item.matchName ?? item.matchId ?? 'Unknown match'}</span>
              <small>
                Kickoff {when(item.startsAt)} · check due {when(item.runAt)}
                {item.status ? ` · ${item.status}` : ''} · {item.attempts} attempts
                {item.lastError ? ` · last error ${item.lastError}` : ''}
              </small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AuditLog() {
  const query = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: async () => (await adminClient.auditLog()).data,
  });
  return (
    <section>
      <p className="eyebrow">Immutable history</p>
      <h2>Admin audit log</h2>
      {query.error && <p className="error">{query.error.message}</p>}
      <div className="audit-list">
        {query.data?.map((entry) => (
          <article key={entry.id}>
            <strong>{entry.action}</strong>
            <span>
              {entry.actor?.displayName ?? 'System'} · {new Date(entry.createdAt).toLocaleString()}
            </span>
            <code>
              {entry.entityType}
              {entry.entityId ? ` · ${entry.entityId}` : ''}
            </code>
          </article>
        ))}
      </div>
    </section>
  );
}

const NAV_GROUPS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> = [
  ['Overview', [['/', 'Dashboard'], ['/waiting-list', 'Waiting list']]],
  ['Matches', [['/matches', 'Load matches'], ['/match-referees', 'Match referees'], ['/results', 'Results']]],
  ['Venues', [['/venues', 'Venues & fields']]],
  ['Money', [['/finance', 'Finance'], ['/settlement', 'Venue settlement']]],
  ['People and safety', [['/support', 'Support inbox'], ['/moderation', 'Moderation'], ['/disputes', 'Disputes'], ['/referees', 'Referees'], ['/team-reviews', 'Team reviews'], ['/recruitment', 'Recruitment']]],
  ['System', [['/test-data', 'Test data'], ['/audit', 'Audit log']]],
];

function AdminShell() {
  const cache = useQueryClient();
  const logout = useMutation({
    mutationFn: () => authClient.logout(),
    onSuccess: () => cache.clear(),
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => setMenuOpen(false);
  // CEO touch-up batch 3.5, item 3: a grouped menu that scrolls on its own, with the theme toggle and
  // Log out always on screen (desktop) or in the Menu (phones).
  return (
    <div className="app-shell">
      <aside className={menuOpen ? 'menu-open' : undefined}>
        <div className="side-top">
          <div className="admin-brand">
            <span className="admin-brand-mark" aria-hidden="true">
              88
            </span>
            <div>
              <p className="eyebrow">Footy Finder</p>
              <h1 className="brand-title">Operations</h1>
            </div>
          </div>
          <button type="button" className="ghost menu-button" aria-expanded={menuOpen} aria-controls="admin-menu" onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? 'Close' : 'Menu'}
          </button>
        </div>
        <div className="side-menu" id="admin-menu">
          <nav aria-label="Admin sections">
            {NAV_GROUPS.map(([heading, links]) => (
              <div className="nav-group" key={heading}>
                <p className="nav-heading">{heading}</p>
                {links.map(([to, label]) => (
                  <NavLink key={to} to={to} end={to === '/'} onClick={close}>
                    {label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="side-footer">
            <ThemeToggle />
            <button className="ghost logout" onClick={() => logout.mutate()}>
              Log out
            </button>
          </div>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="venues" element={<VenuesPage />} />
          <Route path="support" element={<SupportPage />} />
          <Route path="test-data" element={<TestDataPage />} />
          <Route path="finance" element={<FinancePage />} />
          <Route path="settlement" element={<SettlementsPage />} />
          <Route path="matches" element={<MatchLoadingPage />} />
          <Route path="moderation" element={<ModerationPage />} />
          <Route path="disputes" element={<DisputesPage />} />
          <Route path="referees" element={<RefereesPage />} />
          <Route path="match-referees" element={<MatchRefereesPage />} />
          <Route path="results" element={<ResultsPage />} />
          <Route path="team-reviews" element={<TeamReviewsPage />} />
          <Route path="recruitment" element={<RecruitmentPage />} />
          <Route path="audit" element={<AuditLog />} />
          <Route path="waiting-list" element={<WaitingListPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  const cache = useQueryClient();
  const me = useQuery<AuthenticatedUser>({
    queryKey: meKey,
    queryFn: async () => (await usersClient.me()).data,
  });
  if (me.isPending)
    return (
      <main className="center-shell">
        <p>Loading secure workspace…</p>
      </main>
    );
  if (me.error) return <Login />;
  if (me.data.platformRole !== 'ADMIN')
    return (
      <main className="center-shell">
        <section className="auth-card">
          <h1>Access denied</h1>
          <p>This account is not a platform administrator.</p>
          <button
            onClick={() => void authClient.logout().finally(() => cache.clear())}
            className="ghost"
          >
            Sign out
          </button>
        </section>
      </main>
    );
  return <MfaGate />;
}
