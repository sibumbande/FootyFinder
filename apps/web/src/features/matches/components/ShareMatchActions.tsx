import { useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { useConfirm } from '@/components/ui/ConfirmDialog.js';
import { formatCurrency } from '@/utils/format-currency.js';
import { formatDate } from '@/utils/format-date.js';

export interface MatchShareFacts {
  canonicalUrl: string;
  name: string;
  venueName: string;
  startsAt: string;
  filled: number;
  total: number;
  feeCents: number;
}

export const buildMatchShareText = (facts: MatchShareFacts) =>
  [
    facts.name,
    `${facts.venueName} | ${formatDate(facts.startsAt)}`,
    `${facts.filled}/${facts.total} players | ${facts.feeCents ? formatCurrency(facts.feeCents) : 'Free'}`,
  ].join('\n');

export const whatsAppShareUrl = (facts: MatchShareFacts) =>
  `https://wa.me/?text=${encodeURIComponent(`${buildMatchShareText(facts)}\n${facts.canonicalUrl}`)}`;

export function ShareMatchActions({ facts }: { facts: MatchShareFacts }) {
  const [message, setMessage] = useState('');
  const { confirm, confirmDialog } = useConfirm();
  const copy = async () => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(facts.canonicalUrl);
      setMessage('Canonical match link copied.');
      return;
    }
    // No clipboard access (an older browser): show the link to copy by hand, in the app (batch 5 brief, B2).
    setMessage('Canonical match link ready to copy.');
    await confirm({
      title: 'Copy this match link',
      message: <p className="select-all break-all rounded-xl bg-surface-muted p-3 font-mono text-content-strong" data-testid="share-link">{facts.canonicalUrl}</p>,
      confirmLabel: 'Done',
      hideCancel: true,
    });
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: facts.name,
          text: buildMatchShareText(facts),
          url: facts.canonicalUrl,
        });
        setMessage('Match shared.');
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    await copy();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirmDialog}
      <Button type="button" variant="secondary" onClick={share}>
        Share match
      </Button>
      <a
        className="button-secondary inline-flex min-h-11 items-center"
        href={whatsAppShareUrl(facts)}
        target="_blank"
        rel="noreferrer"
      >
        WhatsApp
      </a>
      <button
        type="button"
        className="min-h-11 rounded-xl px-4 text-sm font-bold text-hero-muted underline hover:text-content-inverse"
        onClick={copy}
      >
        Copy link
      </button>
      <span className="text-sm font-semibold text-hero-muted" aria-live="polite">
        {message}
      </span>
    </div>
  );
}
