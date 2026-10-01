import { TERMS_ANCHORS } from '@footy-finder/shared';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { Logo } from '@/components/Logo.js';
import { ThemeToggle } from '@/components/ThemeToggle.js';
import { useLegalDocuments } from '@/features/onboarding/hooks/useOnboarding.js';
import { parseTerms, type InlinePart, type TermsBlock } from '../terms-document.js';

/**
 * CEO Q1: the Terms of Service (with the Privacy Notice and the Participation Agreement) are the
 * only legal document. The retired document pages now point at the matching clause.
 */
const RETIRED_SLUGS: Record<string, string> = {
  about: 'clause-3',
  privacy: TERMS_ANCHORS.privacy,
  participation: TERMS_ANCHORS.riskWaiver,
  conduct: 'clause-15',
};

export function LegalPage() {
  const { document = 'terms' } = useParams();
  if (document !== 'terms') {
    const anchor = RETIRED_SLUGS[document];
    return <Navigate to={anchor ? `/legal/terms#${anchor}` : '/legal/terms'} replace />;
  }
  return <TermsPage />;
}

function TermsPage() {
  const documents = useLegalDocuments();
  const { hash } = useLocation();
  const current = documents.data?.find((item) => item.type === 'TERMS');
  const blocks = useMemo(() => (current ? parseTerms(current.content) : []), [current]);
  // Jump to the clause in the link (e.g. the footer's #clause-8) once the text has loaded.
  useEffect(() => {
    if (!hash || !blocks.length) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [hash, blocks]);
  const clauses = blocks.filter(
    (block): block is Extract<TermsBlock, { kind: 'clause' }> | (Extract<TermsBlock, { kind: 'subheading' }> & { id: string }) =>
      block.kind === 'clause' || (block.kind === 'subheading' && Boolean(block.id)),
  );
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-[4.5rem] max-w-5xl items-center justify-between px-4"><Logo /><ThemeToggle /></div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-10 md:grid-cols-[15rem_1fr]">
        <nav className="hidden content-start gap-1 md:sticky md:top-4 md:grid md:max-h-[calc(100vh-2rem)] md:overflow-y-auto" aria-label="Terms contents">
          {clauses.map((clause) => (
            <a key={clause.id} className="rounded-lg px-2 py-1 text-sm font-bold text-brand-700 hover:bg-surface-hover" href={`#${clause.id}`}>
              {clause.kind === 'clause' ? `${clause.number}. ${clause.text}` : clause.text}
            </a>
          ))}
        </nav>
        <article className="min-w-0 rounded-3xl border border-line bg-surface p-6 shadow-soft sm:p-9">
          {documents.isPending ? <p>Loading…</p> : current ? <>
            <p className="anime-kicker">Version {current.version}</p>
            <p className="mt-2 text-sm text-content-muted">Effective {new Date(current.effectiveAt).toLocaleDateString()}</p>
            <div className="mt-6 grid gap-4 leading-7 text-content">{blocks.map((block, index) => <Block key={index} block={block} />)}</div>
          </> : <>
            <h1 className="text-3xl font-black text-content-strong">Not published yet</h1>
            <p className="mt-4 leading-7 text-content-muted">The Terms of Service have not been published yet. Footy Finder does not substitute placeholder legal text.</p>
          </>}
        </article>
      </main>
    </div>
  );
}

function Inline({ parts }: { parts: InlinePart[] }) {
  return <>{parts.map((part, index) =>
    part.kind === 'bold' ? <strong key={index} className="text-content-strong">{part.text}</strong>
      : part.kind === 'link' ? <a key={index} className="font-bold text-brand-700 underline" href={`#${part.anchor}`}>{part.text}</a>
        : <span key={index}>{part.text}</span>)}</>;
}

function Block({ block }: { block: TermsBlock }): ReactNode {
  switch (block.kind) {
    case 'title':
      return <h1 className="text-3xl font-black text-content-strong">{block.text}</h1>;
    case 'clause':
      return <h2 id={block.id} className="mt-6 scroll-mt-4 text-2xl font-black text-content-strong">{block.number}. {block.text}</h2>;
    case 'subheading':
      return <h3 id={block.id} className="mt-2 scroll-mt-4 text-lg font-black text-content-strong">{block.text}</h3>;
    case 'paragraph':
      return <p id={block.id} className="scroll-mt-4"><Inline parts={block.parts} /></p>;
    case 'box':
      return (
        <div className="grid gap-2 rounded-2xl border-2 border-warning-300 bg-warning-50 p-4 text-sm text-content">
          {block.paragraphs.map((parts, index) => <p key={index}><Inline parts={parts} /></p>)}
        </div>
      );
    case 'list':
      return <ul className="ml-5 grid list-disc gap-1">{block.items.map((parts, index) => <li key={index}><Inline parts={parts} /></li>)}</ul>;
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-line align-top">
                  {row.map((cell, cellIndex) => {
                    const Cell = rowIndex === 0 ? 'th' : 'td';
                    return <Cell key={cellIndex} className={`p-2 text-left ${rowIndex === 0 ? 'font-black text-content-strong' : ''}`}><Inline parts={cell} /></Cell>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}
