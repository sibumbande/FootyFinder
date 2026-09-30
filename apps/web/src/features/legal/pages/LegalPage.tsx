import { LEGAL_DOCUMENT_TYPES, type LegalDocumentType } from '@footy-finder/shared';
import { Link, useParams } from 'react-router-dom';
import { Logo } from '@/components/Logo.js';
import { ThemeToggle } from '@/components/ThemeToggle.js';
import { useLegalDocuments } from '@/features/onboarding/hooks/useOnboarding.js';

const slugType: Record<string, LegalDocumentType> = {
  terms: 'TERMS', privacy: 'PRIVACY', participation: 'PARTICIPATION', conduct: 'CODE_OF_CONDUCT', about: 'COMPANY_DISCLOSURE',
};
const links = [
  ['About & disclosures', '/legal/about'], ['Terms', '/legal/terms'], ['Privacy / POPIA', '/legal/privacy'], ['Participation', '/legal/participation'], ['Code of Conduct', '/legal/conduct'],
] as const;

export function LegalPage() {
  const { document = 'about' } = useParams();
  const type = slugType[document] ?? LEGAL_DOCUMENT_TYPES[0];
  const documents = useLegalDocuments();
  const current = documents.data?.find((item) => item.type === type);
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface"><div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4"><Logo /><ThemeToggle /></div></header>
      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-10 md:grid-cols-[14rem_1fr]">
        <nav className="grid content-start gap-2" aria-label="Legal documents">{links.map(([label, to]) => <Link key={to} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-bold text-brand-700 hover:bg-surface-hover" to={to}>{label}</Link>)}</nav>
        <article className="rounded-3xl border border-line bg-surface p-6 shadow-soft sm:p-9">
          {documents.isPending ? <p>Loading…</p> : current ? <>
            <p className="anime-kicker">Version {current.version}</p>
            <h1 className="mt-3 text-3xl font-black text-content-strong">{current.title}</h1>
            <p className="mt-2 text-sm text-content-muted">Effective {new Date(current.effectiveAt).toLocaleDateString()}</p>
            <div className="mt-7 whitespace-pre-wrap leading-7 text-content">{current.content}</div>
          </> : <>
            <h1 className="text-3xl font-black text-content-strong">Not published yet</h1>
            <p className="mt-4 leading-7 text-content-muted">This document has not been published yet. Footy Finder does not substitute placeholder legal text.</p>
          </>}
        </article>
      </main>
    </div>
  );
}
