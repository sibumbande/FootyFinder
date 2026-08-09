import { zodResolver } from '@hookform/resolvers/zod';
import { registerFormSchema, type RegisterFormInput } from '@footy-finder/shared';
import { useState } from 'react';
import { type FieldPath, useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Input } from '@/components/ui/Input.js';
import { AuthLayout } from '../components/AuthLayout.js';
import { useRegister } from '../hooks/useAuth.js';

const steps: { title: string; fields: FieldPath<RegisterFormInput>[] }[] = [
  { title: 'Account', fields: ['email', 'username'] },
  { title: 'Personal', fields: ['firstName', 'lastName'] },
  { title: 'Security', fields: ['password', 'confirmPassword'] },
  { title: 'Review', fields: [] },
];

export function RegisterPage() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const registration = useRegister();
  const form = useForm<RegisterFormInput>({
    resolver: zodResolver(registerFormSchema),
    mode: 'onTouched',
    defaultValues: { email: '', username: '', firstName: '', lastName: '', password: '', confirmPassword: '' },
  });
  const values = form.watch();
  const next = async () => { if (await form.trigger(steps[step].fields, { shouldFocus: true })) setStep((current) => Math.min(current + 1, steps.length - 1)); };
  const submit = form.handleSubmit(({ confirmPassword: _confirmPassword, ...input }) => registration.mutate(input, { onSuccess: () => navigate('/', { replace: true }) }));

  return <AuthLayout eyebrow="Join the community" title="Create your player account" description="A few quick details and you’ll be ready to find your next game."><div className="mb-6"><div className="mb-3 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500"><span>Step {step + 1} of {steps.length}</span><span>{steps[step].title}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-pitch-600 transition-all duration-300" style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div><ol className="mt-3 grid grid-cols-4 gap-2" aria-label="Registration progress">{steps.map((item, index) => <li key={item.title} className={`truncate text-center text-xs font-semibold ${index <= step ? 'text-pitch-700' : 'text-slate-400'}`}>{item.title}</li>)}</ol></div><form noValidate onSubmit={submit} className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft sm:p-7">{step === 0 && <><Input label="Email address" type="email" autoComplete="email" placeholder="you@example.com" error={form.formState.errors.email?.message} {...form.register('email')} /><Input label="Username" autoComplete="username" placeholder="player1" hint="Letters, numbers, and underscores only." error={form.formState.errors.username?.message} {...form.register('username')} /></>}{step === 1 && <><Input label="First name" autoComplete="given-name" placeholder="John" hint="Optional, but helps other players recognise you." error={form.formState.errors.firstName?.message} {...form.register('firstName')} /><Input label="Last name" autoComplete="family-name" placeholder="Smith" hint="Optional." error={form.formState.errors.lastName?.message} {...form.register('lastName')} /></>}{step === 2 && <><Input label="Password" type="password" autoComplete="new-password" placeholder="At least 8 characters" hint="Use at least one letter and one number." error={form.formState.errors.password?.message} {...form.register('password')} /><Input label="Confirm password" type="password" autoComplete="new-password" placeholder="Enter it again" error={form.formState.errors.confirmPassword?.message} {...form.register('confirmPassword')} /></>}{step === 3 && <div className="grid gap-5"><div><h2 className="text-lg font-bold text-ink">Review your details</h2><p className="mt-1 text-sm text-slate-500">Your password is never displayed or sent until you create the account.</p></div><dl className="grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2"><ReviewItem label="Email" value={values.email} /><ReviewItem label="Username" value={`@${values.username}`} /><ReviewItem label="First name" value={values.firstName || 'Not provided'} /><ReviewItem label="Last name" value={values.lastName || 'Not provided'} /></dl></div>}<FormError message={registration.error instanceof Error ? registration.error.message : undefined} /><div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-between">{step > 0 ? <Button type="button" variant="secondary" onClick={() => setStep((current) => current - 1)} disabled={registration.isPending}>Previous</Button> : <span />}{step < steps.length - 1 ? <Button type="button" onClick={next}>Continue</Button> : <Button type="submit" loading={registration.isPending}>Create account</Button>}</div><p className="text-center text-sm text-slate-600">Already have an account? <Link className="font-bold text-pitch-700 hover:underline" to="/login">Sign in</Link></p></form></AuthLayout>;
}

function ReviewItem({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 truncate font-semibold text-slate-800">{value}</dd></div>; }
