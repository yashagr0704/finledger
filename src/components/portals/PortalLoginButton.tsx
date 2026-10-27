import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Hourglass, Loader2, LogIn, Puzzle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import type { PortalAdapter } from '@/config/portalAdapters';
import { clearLoginState, fetchPassword, launchPortalLogin, loginKey, useHelperInstalled, useLoginState, type LaunchTarget } from '@/lib/portalLogin';
import { cn } from '@/lib/utils';
import { store } from '@/store/store';

/** “Login” for one saved client credential, with live progress from the Portal Helper. */
export function PortalLoginButton({ target, className }: { target: LaunchTarget; className?: string }) {
  const key = loginKey(target);
  const state = useLoginState(key);
  const [manual, setManual] = useState<PortalAdapter | null>(null);
  const working = state?.state === 'working';

  const click = () => {
    clearLoginState(key);
    const r = launchPortalLogin(target);
    if (r.mode === 'busy') return;
    store.trackPortalOpen(target.portal.id);
    if (r.mode === 'manual') setManual(r.adapter);
    if (r.mode === 'error') toast.error(r.message);
  };

  return (
    <span className={cn('inline-flex flex-col items-end gap-0.5', className)}>
      <Button size="sm" onClick={click} disabled={working} aria-busy={working}>
        {working ? <Loader2 className="animate-spin" /> : <LogIn />} Login
      </Button>
      {state && (
        <span
          role="status"
          className={cn(
            'flex max-w-[260px] items-start gap-1 text-right text-2xs leading-snug',
            state.state === 'error' ? 'text-red-600' : state.state === 'signed_in' ? 'text-emerald-700' : 'text-ink-500',
          )}
        >
          {state.state === 'error' ? <AlertTriangle className="mt-px size-3 shrink-0" /> : state.state === 'signed_in' ? <CheckCircle2 className="mt-px size-3 shrink-0" /> : state.state === 'waiting' ? <Hourglass className="mt-px size-3 shrink-0" /> : null}
          {state.message}
        </span>
      )}
      {manual && <SignInAssistant target={target} adapter={manual} onClose={() => setManual(null)} />}
    </span>
  );
}

/** Fallback without the extension: the portal tab is already open; offer copy buttons and the steps. */
function SignInAssistant({ target, adapter, onClose }: { target: LaunchTarget; adapter: PortalAdapter; onClose: () => void }) {
  const helper = useHelperInstalled();
  const [copying, setCopying] = useState(false);
  const copy = (text: string, what: string) =>
    navigator.clipboard?.writeText(text).then(
      () => toast.success(`${what} copied`),
      () => toast.error('Copy not allowed here — select the text instead'),
    );
  const copyPassword = () => {
    setCopying(true);
    fetchPassword(target)
      .then((pw) => (pw ? copy(pw, 'Password') : toast.error('No password is saved for this login.')))
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setCopying(false));
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={`Sign in to ${target.portal.name}`} description={`For ${target.client.name}. The sign-in page opened in a new tab.`} size="sm">
        <DialogBody className="space-y-3 text-xs">
          <dl className="grid grid-cols-[90px_1fr] items-center gap-y-2">
            <dt className="text-ink-500">Login ID</dt>
            <dd className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-mono text-ink-900">{target.login.username}</span>
              <Button size="icon-sm" variant="ghost" onClick={() => copy(target.login.username, 'Login ID')} aria-label="Copy login ID">
                <Copy />
              </Button>
            </dd>
            <dt className="text-ink-500">Password</dt>
            <dd className="flex items-center gap-1.5">
              <span className="font-mono text-ink-900">••••••••</span>
              <Button size="icon-sm" variant="ghost" onClick={copyPassword} disabled={copying} aria-label="Copy password">
                {copying ? <Loader2 className="animate-spin" /> : <Copy />}
              </Button>
            </dd>
            {target.login.extra && (
              <>
                <dt className="text-ink-500">Other details</dt>
                <dd className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-ink-900">{target.login.extra}</span>
                  <Button size="icon-sm" variant="ghost" onClick={() => copy(target.login.extra!, 'Details')} aria-label="Copy other details">
                    <Copy />
                  </Button>
                </dd>
              </>
            )}
          </dl>
          <div className="rounded-md bg-slate-50 p-2.5">
            <p className="mb-1 font-medium text-ink-800">On the portal</p>
            <ol className="list-decimal space-y-0.5 pl-4 text-ink-600">
              <li>Paste the login ID and password</li>
              {adapter.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
          {!helper && (
            <p className="flex items-start gap-1.5 text-2xs text-ink-500">
              <Puzzle className="mt-px size-3 shrink-0" />
              Install the LedgerFlow Portal Helper browser extension to fill these fields automatically. CAPTCHA and OTP always stay with you.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => window.open(adapter.loginUrl, `lf_${target.client.id}_${target.portal.id}`.replace(/[^\w]/g, '_'), 'noopener')}>
            Open again <ExternalLink />
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
