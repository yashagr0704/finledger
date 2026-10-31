import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { brand } from '@/config/brand';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { store } from '@/store/store';

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white shadow-sm">{brand.mark}</span>
          <span className="text-lg font-semibold tracking-tight text-ink-900">{brand.name}</span>
        </div>
        <div className="rounded-xl border border-line bg-white p-6 shadow-card">
          <h1 className="text-[17px] font-semibold text-ink-900">{title}</h1>
          {subtitle && <p className="mt-1 text-[13px] text-ink-500">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <div className="mt-4 text-center text-[13px] text-ink-500">{footer}</div>}
      </div>
    </div>
  );
}

function useSubmit(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, onSubmit };
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const { busy, error, onSubmit } = useSubmit(async () => {
    await store.signIn(email, password);
    navigate('/', { replace: true });
  });
  return (
    <AuthCard
      title="Sign in"
      subtitle="Use the email your firm admin invited you with."
      footer="New firm? Contact us to have your firm’s account set up."
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="login-email">
          <Input id="login-email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="login-password">
          <Input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <div className="-mt-2 text-right">
          <Link to={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="text-xs font-medium text-brand-700 hover:underline">
            Forgot password?
          </Link>
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !email || !password}>
          {busy && <Loader2 className="animate-spin" />} Sign in
        </Button>
      </form>
    </AuthCard>
  );
}

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [info, setInfo] = useState<{ name: string; email: string; firm: string } | null | 'invalid'>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    api.inviteInfo(token).then(setInfo, () => setInfo('invalid'));
  }, [token]);
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (password !== confirm) throw new Error('The two passwords don’t match.');
    await api.acceptInvite(token, password);
    await store.refresh();
    navigate('/', { replace: true });
    toast.success('Welcome aboard!');
  });
  if (info === null)
    return (
      <AuthCard title="Checking your invitation…">
        <Loader2 className="mx-auto size-5 animate-spin text-ink-400" />
      </AuthCard>
    );
  if (info === 'invalid')
    return (
      <AuthCard title="Invitation not valid" subtitle="This link has expired or was already used. Ask your firm admin for a new one.">
        <Button asChild variant="primary" className="w-full">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </AuthCard>
    );
  return (
    <AuthCard title={`Join ${info.firm}`} subtitle={`Hi ${info.name}, set a password for ${info.email}.`}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="New password" htmlFor="inv-pw" hint="At least 8 characters.">
          <Input id="inv-pw" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password" htmlFor="inv-pw2">
          <Input id="inv-pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !password}>
          {busy && <Loader2 className="animate-spin" />} Set password & continue
        </Button>
      </form>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [sent, setSent] = useState(false);
  const { busy, error, onSubmit } = useSubmit(async () => {
    await api.forgotPassword(email.trim());
    setSent(true);
  });
  const back = (
    <Link to="/login" className="font-medium text-brand-700 hover:underline">
      Back to sign in
    </Link>
  );
  if (sent)
    return (
      <AuthCard
        title="Check your email"
        subtitle={`If ${email.trim()} has an account, we’ve sent a link to choose a new password. It works once, for 1 hour. Didn’t get it? Check spam, or ask your firm admin for a reset link.`}
        footer={back}
      >
        <Button variant="ghost" className="w-full" onClick={() => setSent(false)}>
          Use a different email
        </Button>
      </AuthCard>
    );
  return (
    <AuthCard title="Forgot your password?" subtitle="Enter the email you sign in with and we’ll send you a link to choose a new one." footer={back}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="fp-email">
          <Input id="fp-email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !email.trim()}>
          {busy && <Loader2 className="animate-spin" />} Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [info, setInfo] = useState<{ name: string; email: string } | null | 'invalid'>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    api.resetInfo(token).then(setInfo, () => setInfo('invalid'));
  }, [token]);
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (password !== confirm) throw new Error('The two passwords don’t match.');
    await api.resetPassword(token, password);
    await store.refresh();
    navigate('/', { replace: true });
    toast.success('Password changed', { description: 'You’re signed in. Other devices have been signed out.' });
  });
  if (info === null)
    return (
      <AuthCard title="Checking your link…">
        <Loader2 className="mx-auto size-5 animate-spin text-ink-400" />
      </AuthCard>
    );
  if (info === 'invalid')
    return (
      <AuthCard title="Reset link not valid" subtitle="This link has expired or was already used. Request a new one.">
        <Button asChild variant="primary" className="w-full">
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </AuthCard>
    );
  return (
    <AuthCard title="Choose a new password" subtitle={`Hi ${info.name}, set a new password for ${info.email}.`}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="New password" htmlFor="rp-pw" hint="At least 8 characters.">
          <Input id="rp-pw" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password" htmlFor="rp-pw2">
          <Input id="rp-pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !password}>
          {busy && <Loader2 className="animate-spin" />} Set password & sign in
        </Button>
      </form>
    </AuthCard>
  );
}

export function ConnectionErrorPage() {
  return (
    <AuthCard title="Can’t reach the server" subtitle="Check your connection and try again.">
      <Button variant="primary" className="w-full" onClick={() => window.location.reload()}>
        Retry
      </Button>
    </AuthCard>
  );
}
