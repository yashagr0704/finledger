/**
 * The "LedgerFlow Fill" bookmarklet: the code that runs on a portal's sign-in page when the
 * user clicks the bookmark. No extension or download is involved.
 *
 * A web page can't type into another site's tab, but a bookmarklet runs inside the page the
 * user is looking at. Credentials reach it like this:
 *  1. LedgerFlow's Login button opens the portal with window.open, so the portal tab's
 *     window.opener is LedgerFlow.
 *  2. The bookmarklet posts {type: 'ready'} to window.opener (LedgerFlow's origin only).
 *  3. LedgerFlow checks the message comes from the tab it opened, on one of the portal's
 *     expected HTTPS hosts, then sends that one login to exactly that origin.
 *  4. The bookmarklet fills the boxes. It never submits; CAPTCHA, OTP and DSC stay with the user.
 *
 * `lfFill` is serialised with Function#toString, so it must stay self-contained: no imports,
 * no outer variables, plain JavaScript only.
 */

/** Bumped when the message format changes, so LedgerFlow can ask users to re-add an old bookmark. */
export const FILL_VERSION = 1;

/* eslint-disable @typescript-eslint/no-explicit-any */
function lfFill(LF: string, VERSION: number) {
  const w = window as any;
  const say = (text: string, error?: boolean) => {
    let box = document.getElementById('__lf_fill_note');
    if (!box) {
      box = document.createElement('div');
      box.id = '__lf_fill_note';
      box.setAttribute('role', 'status');
      box.style.cssText =
        'position:fixed;z-index:2147483647;top:12px;right:12px;max-width:340px;padding:10px 14px;border-radius:8px;font:13px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer';
      box.onclick = () => box!.remove();
      document.documentElement.appendChild(box);
    }
    box.style.background = error ? '#b91c1c' : '#1e3a8a';
    box.textContent = 'LedgerFlow: ' + text;
    clearTimeout(w.__lfNoteTimer);
    w.__lfNoteTimer = setTimeout(() => box && box.remove(), error ? 12000 : 9000);
  };

  const op = window.opener;
  if (!op) return say('Open this portal with the Login button in LedgerFlow, then click this bookmark again.', true);
  if (w.__lfFillActive) return say('Already filling — click into the sign-in boxes.');

  const report = (m: Record<string, unknown>) => {
    try {
      op.postMessage({ source: 'ledgerflow-fill', v: VERSION, ...m }, LF);
    } catch {
      /* LedgerFlow tab closed */
    }
  };

  const onMessage = (e: MessageEvent) => {
    if (e.origin !== LF || e.source !== op) return;
    const d = e.data;
    if (!d || d.source !== 'ledgerflow') return;
    window.removeEventListener('message', onMessage);
    clearTimeout(noReply);
    if (d.type === 'error') return say(d.message || 'LedgerFlow could not send the login.', true);
    if (d.type === 'fill') run(d.adapter, d.creds);
  };
  window.addEventListener('message', onMessage);
  const noReply = setTimeout(() => {
    window.removeEventListener('message', onMessage);
    say('LedgerFlow did not answer. Keep the LedgerFlow tab open, click Login there again, then click this bookmark.', true);
  }, 15000);
  report({ type: 'ready' });
  say('Getting the login from LedgerFlow…');

  function run(adapter: any, creds: { username: string; password: string; extra?: string }) {
    w.__lfFillActive = true;
    const startHost = location.host;
    const visible = (el: any) => !!el && !el.disabled && !el.readOnly && el.getClientRects().length > 0;
    const find = (sels: string[]) => {
      for (const s of sels || []) {
        try {
          for (const el of document.querySelectorAll(s)) if (visible(el)) return el as HTMLInputElement;
        } catch {
          /* bad selector */
        }
      }
      return null;
    };
    const anyPassword = () => ([...document.querySelectorAll('input[type="password"]')].find(visible) as HTMLInputElement) || null;
    const userBefore = (pw: Element) => {
      const inputs = [...document.querySelectorAll('input:not([type]), input[type="text"], input[type="email"], input[type="tel"]')].filter(visible);
      const before = inputs.filter((i) => i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
      return (before[before.length - 1] as HTMLInputElement) || null;
    };
    const set = (el: HTMLInputElement, v: string) => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      if (setter) setter.call(el, v);
      else el.value = v;
      for (const type of ['input', 'change']) el.dispatchEvent(new Event(type, { bubbles: true }));
    };
    const finish = (done: { username: boolean; password: boolean }) => {
      w.__lfFillActive = false;
      creds = { username: '', password: '' }; // forget them
      report({ type: 'filled', username: done.username, password: done.password });
      if (done.username && done.password) say('Details filled. Enter the CAPTCHA / OTP and sign in.');
      else if (done.username || done.password) say(`Only the ${done.username ? 'login ID' : 'password'} was filled. Fill the rest yourself.`, true);
      else say('Could not find the sign-in boxes on this page. Use the copy buttons in LedgerFlow.', true);
    };

    if (adapter.fillOnFocus) {
      // Canvas apps (Flutter web, e.g. TRACES) create an <input> only for the box the user clicks.
      // Fill that box: login ID into a plain box, password into the password box. Never overwrite text.
      const done = { username: false, password: false };
      say(adapter.fillHint || 'Click the login ID box, then the password box.');
      const stop = () => {
        document.removeEventListener('focusin', onFocus, true);
        clearTimeout(timer);
        finish(done);
      };
      const fill = (el: HTMLInputElement, isPw: boolean, attempt: number) => {
        if (location.host !== startHost || !el.isConnected) return;
        const value = isPw ? creds.password : creds.username;
        set(el, value);
        const mark = () => {
          if (el.value !== value) return;
          done[isPw ? 'password' : 'username'] = true;
          if (done.username && done.password) stop();
        };
        // Flutter may reset the box while wiring it up; check once and fill again if so.
        if (attempt === 0) setTimeout(() => (el.value === value ? mark() : fill(el, isPw, 1)), 400);
        else mark();
      };
      const onFocus = (e: FocusEvent) => {
        const el = e.composedPath()[0] as HTMLInputElement;
        if (!el || !['INPUT', 'TEXTAREA'].includes(el.tagName)) return;
        const isPw = el.tagName === 'INPUT' && el.type === 'password';
        if ((isPw ? done.password : done.username) || (!isPw && el.value)) return;
        setTimeout(() => fill(el, isPw, 0), 200);
      };
      document.addEventListener('focusin', onFocus, true);
      const timer = setTimeout(stop, 180000);
      return;
    }

    // Ordinary forms. Waits up to two minutes: some portals ask for the user ID first and the
    // password on the next screen (e.g. Income Tax).
    const done = { username: false, password: false, extra: !creds.extra || !adapter.extra };
    const deadline = Date.now() + 120000;
    const tick = () => {
      if (location.host !== startHost) return finish(done);
      const pw = find(adapter.password) || anyPassword();
      if (!done.username) {
        const el = find(adapter.username) || (pw ? userBefore(pw) : null);
        if (el && el !== pw) {
          set(el, creds.username);
          done.username = true;
          if (!pw && adapter.fillHint) say(adapter.fillHint);
        }
      }
      if (!done.password && pw) {
        set(pw, creds.password);
        done.password = true;
      }
      if (!done.extra) {
        const el = find(adapter.extra);
        if (el) {
          set(el, creds.extra || '');
          done.extra = true;
        }
      }
      if ((done.username && done.password && done.extra) || Date.now() > deadline) {
        const next = find(adapter.focusAfter);
        if (next) next.focus();
        return finish(done);
      }
      setTimeout(tick, 500);
    };
    tick();
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The bookmark's URL for this LedgerFlow address. */
export function bookmarkletHref(origin = window.location.origin) {
  return `javascript:${encodeURIComponent(`void (${lfFill.toString()})(${JSON.stringify(origin)},${FILL_VERSION})`)}`;
}
