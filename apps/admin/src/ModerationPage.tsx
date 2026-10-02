import type {
  AccountEnforcementType,
  ModerationReportStatus,
  ModerationReportTargetType,
} from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { adminClient } from './api.js';
import { CorrectGender } from './GirlsOnlyControls.js';

const rootKey = ['admin', 'moderation'] as const;

export function ModerationPage() {
  const cache = useQueryClient();
  const [view, setView] = useState<'reports' | 'players'>('reports');
  const [reportStatus, setReportStatus] = useState<ModerationReportStatus | ''>('OPEN');
  const [targetType, setTargetType] = useState<ModerationReportTargetType | ''>('');
  const [selectedReportId, setSelectedReportId] = useState<string>();
  const [resolution, setResolution] = useState('');
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string>();
  const [enforcementType, setEnforcementType] = useState<AccountEnforcementType>('SUSPENSION');
  const [publicReason, setPublicReason] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [endsAt, setEndsAt] = useState('');

  const reports = useQuery({
    queryKey: [...rootKey, 'reports', reportStatus, targetType],
    queryFn: async () => (await adminClient.moderationReports({
      ...(reportStatus ? { status: reportStatus } : {}),
      ...(targetType ? { targetType } : {}),
    })).data,
  });
  const selectedReport = reports.data?.find((item) => item.id === selectedReportId);
  const users = useQuery({
    queryKey: [...rootKey, 'users', search],
    queryFn: async () => (await adminClient.moderationUsers(search ? { search } : {})).data,
  });
  const user = useQuery({
    queryKey: [...rootKey, 'user', selectedUserId],
    queryFn: async () => (await adminClient.moderationUser(selectedUserId!)).data,
    enabled: Boolean(selectedUserId),
  });
  const refresh = () => void cache.invalidateQueries({ queryKey: rootKey });
  const updateReport = useMutation({
    mutationFn: (status: ModerationReportStatus) => adminClient.updateModerationReport(selectedReportId!, {
      status,
      assignedToMe: true,
      ...(['RESOLVED', 'DISMISSED'].includes(status) ? { resolutionSummary: resolution } : {}),
    }),
    onSuccess: () => { refresh(); setResolution(''); },
  });
  const enforce = useMutation({
    mutationFn: () => adminClient.enforceUser(selectedUserId!, enforcementType === 'BAN'
      ? { type: 'BAN', publicReason, ...(internalNote ? { internalNote } : {}) }
      : { type: 'SUSPENSION', publicReason, ...(internalNote ? { internalNote } : {}), endsAt: new Date(endsAt).toISOString() }),
    onSuccess: ({ data }) => {
      cache.setQueryData([...rootKey, 'user', selectedUserId], data);
      refresh();
      setPublicReason('');
      setInternalNote('');
    },
  });
  const reinstate = useMutation({
    mutationFn: (enforcementId: string) => adminClient.revokeEnforcement(selectedUserId!, enforcementId, { reason: 'Reviewed and reinstated by an administrator.' }),
    onSuccess: ({ data }) => { cache.setQueryData([...rootKey, 'user', selectedUserId], data); refresh(); },
  });

  return <section>
    <p className="eyebrow">Safety operations</p>
    <h2>Moderation & enforcement</h2>
    <p className="muted">Evidence is snapshotted when reported. Restrictions revoke every session immediately while preserving historical and financial records.</p>
    <div className="row">
      <button className={view === 'reports' ? '' : 'ghost'} onClick={() => setView('reports')}>Reports</button>
      <button className={view === 'players' ? '' : 'ghost'} onClick={() => setView('players')}>Players</button>
    </div>
    {view === 'reports' && <>
      <div className="row">
        <label>Status<select value={reportStatus} onChange={(event) => setReportStatus(event.target.value as ModerationReportStatus | '')}><option value="">All</option>{['OPEN','UNDER_REVIEW','RESOLVED','DISMISSED'].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Target<select value={targetType} onChange={(event) => setTargetType(event.target.value as ModerationReportTargetType | '')}><option value="">All</option>{['USER','DIRECT_MESSAGE','LOBBY_MESSAGE','TEAM','MATCH','RECRUITMENT_POST','LOOKING_CARD'].map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>
      <div className="support-layout">
        <div className="ticket-list">{reports.data?.map((report) => <button key={report.id} className={selectedReportId === report.id ? 'ticket active-ticket' : 'ticket'} onClick={() => setSelectedReportId(report.id)}><strong>{report.reason.replaceAll('_', ' ')}</strong><span>{report.targetType.replaceAll('_', ' ')} · {report.status.replaceAll('_', ' ')}</span><small>{report.reporter?.displayName} · {new Date(report.createdAt).toLocaleString()}</small></button>)}</div>
        <div>{selectedReport ? <article className="venue-card"><h3>{selectedReport.reason.replaceAll('_', ' ')}</h3><p>{selectedReport.details ?? 'No additional details supplied.'}</p><p className="muted">Target: {selectedReport.targetType} · {selectedReport.targetId}</p><pre>{JSON.stringify(selectedReport.evidenceSnapshot, null, 2)}</pre><label>Resolution summary<textarea value={resolution} onChange={(event) => setResolution(event.target.value)} maxLength={2000} /></label><div className="row"><button onClick={() => updateReport.mutate('UNDER_REVIEW')}>Take for review</button><button disabled={!resolution.trim()} onClick={() => updateReport.mutate('RESOLVED')}>Resolve</button><button className="ghost" disabled={!resolution.trim()} onClick={() => updateReport.mutate('DISMISSED')}>Dismiss</button></div>{updateReport.error && <p className="error">{updateReport.error.message}</p>}</article> : <p className="empty">Select a report.</p>}</div>
      </div>
    </>}
    {view === 'players' && <>
      <label>Find player<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Email, username, or display name" /></label>
      <div className="support-layout">
        <div className="ticket-list">{users.data?.map((item) => <button key={item.id} className={selectedUserId === item.id ? 'ticket active-ticket' : 'ticket'} onClick={() => setSelectedUserId(item.id)}><strong>{item.displayName}</strong><span>@{item.username} · {item.accountStatus}</span><small>{item.email}</small></button>)}</div>
        <div>{user.data ? <article className="venue-card"><h3>{user.data.user.displayName}</h3><p className="muted">@{user.data.user.username} · {user.data.user.email} · {user.data.user.accountStatus}</p><p>{user.data.reportCount} report(s) target this player.</p><CorrectGender key={user.data.user.id} userId={user.data.user.id} gender={user.data.user.gender} onSaved={() => void cache.invalidateQueries({ queryKey: [...rootKey, 'user', selectedUserId] })} />{user.data.activeEnforcement ? <div className="support-message internal"><strong>Active {user.data.activeEnforcement.type.toLowerCase()}</strong><p>{user.data.activeEnforcement.publicReason}</p><button onClick={() => reinstate.mutate(user.data!.activeEnforcement!.id)}>Reinstate player</button></div> : user.data.user.platformRole === 'ADMIN' ? <p className="muted">Administrator accounts cannot be restricted from this workflow.</p> : <form className="stack" onSubmit={(event: FormEvent) => { event.preventDefault(); enforce.mutate(); }}><label>Action<select value={enforcementType} onChange={(event) => setEnforcementType(event.target.value as AccountEnforcementType)}><option value="SUSPENSION">Timed suspension</option><option value="BAN">Permanent ban</option></select></label>{enforcementType === 'SUSPENSION' && <label>Ends at<input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required /></label>}<label>Reason shown to player<textarea value={publicReason} onChange={(event) => setPublicReason(event.target.value)} required maxLength={500} /></label><label>Internal note<textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} maxLength={2000} /></label><button disabled={enforce.isPending}>{enforcementType === 'BAN' ? 'Ban player' : 'Suspend player'}</button></form>}<h4>Enforcement history</h4>{user.data.enforcementHistory.map((item) => <p key={item.id}>{item.type} · {item.status} · {new Date(item.createdAt).toLocaleString()}</p>)}{(enforce.error || reinstate.error) && <p className="error">{(enforce.error ?? reinstate.error)?.message}</p>}</article> : <p className="empty">Select a player.</p>}</div>
      </div>
    </>}
  </section>;
}
