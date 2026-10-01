import { useEffect, useState } from 'react';
export function MatchTimer({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const target = now < start ? start : end;
  const remaining = Math.max(0, target - now);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining / 60_000) % 60);
  const seconds = Math.floor((remaining / 1000) % 60);
  return (
    <div className="rounded-2xl bg-content-inverse/10 px-4 py-3 text-center">
      <span className="block text-[10px] font-bold uppercase tracking-wide text-hero-muted">
        {now < start ? 'Kickoff in' : remaining ? 'Time remaining' : 'Full time'}
      </span>
      <span className="font-mono text-xl font-black">
        {hours ? `${String(hours).padStart(2, '0')}:` : ''}
        {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </span>
    </div>
  );
}
