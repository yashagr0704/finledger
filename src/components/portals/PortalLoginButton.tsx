import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Bookmark, Hourglass, Loader2, LogIn, Puzzle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import type { PortalAdapter } from '@/config/portalAdapters';
import { bookmarkletHref } from '@/lib/portalFill';
import { clearLoginState, fetchPassword, launchPortalLogin, loginKey, reopenPortal, useHelperInstalled, useLoginState, type LaunchTarget } from '@/lib/portalLogin';
import { cn } from '@/lib/utils';
import { store } from '@/store/store';

/** “Login” for one saved client credential: fills via the Portal Helper if installed, else opens the portal with the Fill bookmark. */
export function PortalLoginButton({ target, className }: { target: LaunchTarget; className?: string }) {
  const key = loginKey(target);
  const state = useLoginState(key);
  const [manual, setManual] = useState<PortalAdapter | null>(null);
  const working = state?.state === 'working';

  const click = () => {
    clearLoginState(key);
    const r = launchPortalLogin(target);
    if (r.mode === 'busy') return;
    if (r.mode === 'error') return void toast.error(r.message);
    store.trackPortalOpen(target.portal.id);
    if (r.mode === 'opened') setManual(r.adapter);
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

/** No extension: the portal tab is open. Explain the Fill bookmark, offer copy buttons and the extension. */
function SignInAssistant({ target, adapter, onClose }: { target: LaunchTarget; adapter: PortalAdapter; onClose: () => void }) {
  const state = useLoginState(loginKey(target));
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
          <FillBookmark adapter={adapter} />
          {state && <p className={cn('text-2xs', state.state === 'error' ? 'text-red-600' : 'text-ink-500')}>{state.message}</p>}
          <p className="font-medium text-ink-800">Or copy the details</p>
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
              <li>Fill the login ID and password (bookmark or copy buttons)</li>
              {adapter.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
          {!helper && <HelperInstallHint />}
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => {
              const r = reopenPortal(target);
              if (r.mode === 'error') toast.error(r.message);
            }}>
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

/** How to fill with the "LedgerFlow Fill" bookmark, and the button to drag to the bookmarks bar. */
function FillBookmark({ adapter }: { adapter: PortalAdapter }) {
  const link = useRef<HTMLAnchorElement>(null);
  // Set outside React so it doesn't warn about javascript: URLs; this one is our own code.
  useEffect(() => link.current?.setAttribute('href', bookmarkletHref()), []);
  return (
    <div className="rounded-md border border-brand-200 bg-brand-50/60 p-2.5">
      <p className="mb-1 flex items-center gap-1.5 font-medium text-ink-800">
        <Bookmark className="size-3.5" /> Fill automatically
      </p>
      <ol className="list-decimal space-y-0.5 pl-4 text-ink-600">
        <li>
          Once per browser: drag{' '}
          <a
            ref={link}
            draggable
            onClick={(e) => {
              e.preventDefault();
              toast.info('Drag this button to your bookmarks bar (Ctrl+Shift+B shows it), then click it on the portal page.');
            }}
            className="mx-0.5 inline-flex cursor-grab items-center gap-1 rounded bg-brand-600 px-1.5 py-0.5 font-medium text-white no-underline"
          >
            <Bookmark className="size-3" /> LedgerFlow Fill
          </a>{' '}
          to your bookmarks bar.
        </li>
        <li>On the portal tab, click the LedgerFlow Fill bookmark.</li>
        {adapter.fillOnFocus && <li>{adapter.fillHint}</li>}
      </ol>
      <p className="mt-1 text-2xs text-ink-500">Keep this LedgerFlow tab open. The bookmark fills only the tab LedgerFlow opened, and never submits.</p>
    </div>
  );
}

/** For fully automatic filling: how to install the Portal Helper extension (once per computer). */
function HelperInstallHint() {
  return (
    <details className="text-2xs text-ink-500">
      <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-ink-700">
        <Puzzle className="size-3 shrink-0" /> Fill without clicking a bookmark: install the Portal Helper extension
      </summary>
      <ol className="mt-1 list-decimal space-y-0.5 pl-6">
        <li>
          <a className="font-medium text-brand-600 underline" href={`${import.meta.env.BASE_URL}ledgerflow-portal-helper.zip`} download>
            Download the helper
          </a>{' '}
          and unzip it.
        </li>
        <li>
          Open <span className="font-mono">chrome://extensions</span> (or <span className="font-mono">edge://extensions</span>) and turn on Developer mode.
        </li>
        <li>Click Load unpacked and choose the unzipped ledgerflow-portal-helper folder.</li>
        <li>Reload LedgerFlow. Login then fills the portal by itself (once per computer).</li>
      </ol>
    </details>
  );
}
