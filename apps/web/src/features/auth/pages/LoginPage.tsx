import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@footy-finder/shared';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Input } from '@/components/ui/Input.js';
import { AuthLayout } from '../components/AuthLayout.js';
import { useLogin } from '../hooks/useAuth.js';

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const { register, handleSubmit, formState: { errors } } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { identifier: '', password: '' } });
  const submit = handleSubmit((values) => login.mutate(values, { onSuccess: () => navigate('/', { replace: true }) }));

  return <AuthLayout eyebrow="Welcome back" title="Ready for your next match?" description="Sign in to discover players and get back to the action."><form noValidate onSubmit={submit} className="grid gap-5 rounded-2xl border border-line bg-surface p-5 shadow-soft sm:p-7"><Input label="Email or username" autoComplete="username" placeholder="you@example.com or player1" error={errors.identifier?.message} {...register('identifier')} /><Input label="Password" type="password" autoComplete="current-password" placeholder="Enter your password" error={errors.password?.message} {...register('password')} /><FormError message={login.error instanceof Error ? login.error.message : undefined} /><Button type="submit" loading={login.isPending} className="w-full">Sign in</Button><p className="text-center text-sm text-content-muted">New to Footy Finder? <Link className="font-bold text-brand-700 hover:text-brand-600 hover:underline" to="/register">Create an account</Link></p></form></AuthLayout>;
}
