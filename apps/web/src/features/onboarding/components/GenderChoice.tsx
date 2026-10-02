import type { Gender } from '@footy-finder/shared';

const OPTIONS: Array<[Gender, string]> = [['MALE', 'Male'], ['FEMALE', 'Female']];

/**
 * CEO touch-up batch 4, item 1: "Gender: Male / Female". Private: never shown on profiles, cards or public pages, and
 * used only to decide who can join girls-only matches. Saved once; support can correct it.
 */
export function GenderChoice({ value, onChange, locked = false }: { value: Gender | ''; onChange: (gender: Gender) => void; locked?: boolean }) {
  return (
    <fieldset className="grid gap-2" data-testid="gender-choice">
      <legend className="text-xs font-black uppercase tracking-[0.08em] text-content">Gender</legend>
      <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
        {OPTIONS.map(([gender, label]) => (
          <label
            key={gender}
            className={`flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-md border-2 px-3 text-sm font-black ${value === gender ? 'border-brand-700 bg-brand-100 text-brand-700' : 'border-line-strong bg-surface text-content-strong'} ${locked ? 'cursor-not-allowed opacity-70' : ''}`}
          >
            <input type="radio" name="gender" className="size-4" checked={value === gender} disabled={locked} onChange={() => onChange(gender)} />
            {label}
          </label>
        ))}
      </div>
      <p className="text-xs text-content-muted">
        Private. Never shown to other players; used only for girls-only matches. {locked ? 'Contact support if it needs correcting.' : "You can't change it yourself after saving."}
      </p>
    </fieldset>
  );
}
