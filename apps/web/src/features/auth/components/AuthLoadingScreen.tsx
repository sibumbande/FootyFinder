import { Logo } from '@/components/Logo.js';
import { Spinner } from '@/components/ui/Spinner.js';
export function AuthLoadingScreen() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas p-6">
      <div className="grid justify-items-center gap-5">
        <Logo />
        <Spinner className="size-7 text-brand-600" />
        <p className="text-sm text-content-muted">Checking your session…</p>
      </div>
    </div>
  );
}
