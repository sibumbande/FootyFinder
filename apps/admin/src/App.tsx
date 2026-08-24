import type { AdminMfaSetup, AuthenticatedUser } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { adminClient, authClient, usersClient } from './api.js';
import { VenuesPage } from './VenuesPage.js';
import { SupportPage } from './SupportPage.js';
import { TestDataPage } from './TestDataPage.js';
import { FinancePage } from './FinancePage.js';
import { MatchLoadingPage } from './MatchLoadingPage.js';
import { ModerationPage } from './ModerationPage.js';
import { DisputesPage } from './DisputesPage.js';

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
  const modules = [
    ['Venues & fields', 'Available now'],
    ['Support inbox', 'Available now'],
    ['Test accounts & data', 'Available when environment-gated'],
    ['Match loading', 'Available now'],
    ['Moderation', 'Available now'],
    ['Disputes', 'Available now'],
    ['Finance & reconciliation', 'Assigned to Slice 5'],
  ];
  return (
    <section>
      <p className="eyebrow">Operations overview</p>
      <h2>Admin workspace</h2>
      <div className="module-grid">
        {modules.map(([item, status]) => (
          <article key={item}>
            <strong>{item}</strong>
            <span>{status}</span>
          </article>
        ))}
      </div>
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

function AdminShell() {
  const cache = useQueryClient();
  const logout = useMutation({
    mutationFn: () => authClient.logout(),
    onSuccess: () => cache.clear(),
  });
  return (
    <div className="app-shell">
      <aside>
        <div>
          <p className="eyebrow">Footy Finder</p>
          <h1>Operations</h1>
        </div>
        <nav>
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/venues">Venues & fields</NavLink>
          <NavLink to="/support">Support inbox</NavLink>
          <NavLink to="/test-data">Test data</NavLink>
          <NavLink to="/finance">Finance</NavLink>
          <NavLink to="/matches">Load Matches</NavLink>
          <NavLink to="/moderation">Moderation</NavLink>
          <NavLink to="/disputes">Disputes</NavLink>
          <NavLink to="/audit">Audit log</NavLink>
        </nav>
        <button className="ghost" onClick={() => logout.mutate()}>
          Log out
        </button>
      </aside>
      <main className="content">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="venues" element={<VenuesPage />} />
          <Route path="support" element={<SupportPage />} />
          <Route path="test-data" element={<TestDataPage />} />
          <Route path="finance" element={<FinancePage />} />
          <Route path="matches" element={<MatchLoadingPage />} />
          <Route path="moderation" element={<ModerationPage />} />
          <Route path="disputes" element={<DisputesPage />} />
          <Route path="audit" element={<AuditLog />} />
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
