/**
 * LedgerFlow Portal Helper — service worker.
 *
 * 1. The app connects (externally_connectable) and sends one login job:
 *    the portal adapter plus one client's credentials for one portal.
 * 2. The helper opens the portal's sign-in page in a tab it owns (or reuses
 *    the tab it opened earlier for the same client + login).
 * 3. When that tab finishes loading on one of the adapter's hosts, it types
 *    the credentials, then forgets them.
 * 4. It reports "signed in" only when the adapter's signed-in check matches.
 *
 * It never touches CAPTCHA, OTP, DSC or consent boxes, never submits the
 * form, and never types credentials into a tab it did not open or a host the
 * adapter does not list. Jobs live in chrome.storage.session (memory only,
 * not readable by content scripts) and expire after a few minutes.
 */

const JOB_TTL_MS = 4 * 60 * 1000;
const WATCH_MS = 10 * 60 * 1000;

/** tabId -> { port, requestId } for status messages. Lost if the worker restarts; filling still works. */
const ports = new Map();
/** tabIds with a fill script running right now. */
const filling = new Set();

const jobKey = (tabId) => `job:${tabId}`;
const getJob = async (tabId) => (await chrome.storage.session.get(jobKey(tabId)))[jobKey(tabId)];
const putJob = (tabId, job) => chrome.storage.session.set({ [jobKey(tabId)]: job });
const dropJob = (tabId) => chrome.storage.session.remove(jobKey(tabId));

function report(tabId, status, message) {
  const p = ports.get(tabId);
  if (!p) return;
  try {
    p.port.postMessage({ requestId: p.requestId, status, message });
  } catch {
    ports.delete(tabId);
  }
}

function allowedHost(hosts, url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.replace(/^www\./, '');
    return hosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function validJob(m) {
  const a = m && m.adapter;
  return (
    m &&
    m.type === 'login' &&
    typeof m.requestId === 'string' &&
    typeof m.key === 'string' &&
    typeof m.username === 'string' &&
    typeof m.password === 'string' &&
    a &&
    typeof a.loginUrl === 'string' &&
    Array.isArray(a.hosts) &&
    a.hosts.length > 0 &&
    a.hosts.every((h) => typeof h === 'string' && h.includes('.')) &&
    Array.isArray(a.username) &&
    Array.isArray(a.password)
  );
}

chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name !== 'portal-login') return port.disconnect();
  const origin = port.sender && port.sender.origin;
  port.onMessage.addListener((m) => startJob(port, origin, m).catch(() => port.postMessage({ requestId: m && m.requestId, status: 'error', message: 'The Portal Helper could not open the portal.' })));
});

async function startJob(port, origin, m) {
  if (!validJob(m)) return port.postMessage({ requestId: m && m.requestId, status: 'error', message: 'The Portal Helper received an invalid request.' });
  const { adapter } = m;
  if (!allowedHost(adapter.hosts, adapter.loginUrl)) return port.postMessage({ requestId: m.requestId, status: 'error', message: 'The sign-in page is not on an expected HTTPS portal address, so nothing was filled.' });

  // One tab and one job per app + client login. A second click while a job is pending is refused.
  const owner = `${origin}|${m.key}`;
  const all = await chrome.storage.session.get(null);
  let reuseTab;
  for (const [k, job] of Object.entries(all)) {
    if (!k.startsWith('job:') || job.owner !== owner) continue;
    const tabId = Number(k.slice(4));
    const alive = await chrome.tabs.get(tabId).catch(() => null);
    if (!alive) {
      await dropJob(tabId);
      continue;
    }
    if (job.creds && Date.now() < job.expires) return port.postMessage({ requestId: m.requestId, status: 'busy', message: 'Already signing in to this portal — finish in the open tab.' });
    reuseTab = tabId;
  }

  const job = {
    owner,
    requestId: m.requestId,
    adapter,
    creds: { username: m.username, password: m.password, extra: typeof m.extra === 'string' ? m.extra : '' },
    expires: Date.now() + JOB_TTL_MS,
    watchUntil: Date.now() + WATCH_MS,
  };
  // Register the job before the portal starts loading so the first "complete" event finds it.
  const tab = reuseTab !== undefined ? await chrome.tabs.get(reuseTab) : await chrome.tabs.create({ url: 'about:blank', active: true });
  await putJob(tab.id, job);
  ports.set(tab.id, { port, requestId: m.requestId });
  port.onDisconnect.addListener(() => {
    if (ports.get(tab.id)?.port === port) ports.delete(tab.id);
  });
  await chrome.tabs.update(tab.id, { url: adapter.loginUrl, active: true });
  if (reuseTab !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  report(tab.id, 'opened');
}

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' && !info.url) return;
  const job = await getJob(tabId);
  if (!job) return;
  const url = tab.url || '';

  if (job.creds) {
    if (Date.now() > job.expires) {
      await putJob(tabId, { ...job, creds: null });
      return report(tabId, 'error', 'Timed out before the sign-in form appeared. Click Login again.');
    }
    if (info.status !== 'complete' || filling.has(tabId)) return;
    // The blank page the tab starts on (and other non-web pages) is not a redirect; wait for the portal.
    if (!/^https?:/i.test(url)) return;
    if (!allowedHost(job.adapter.hosts, url)) {
      await putJob(tabId, { ...job, creds: null });
      return report(tabId, 'error', 'The portal redirected to an unexpected address, so nothing was filled.');
    }
    filling.add(tabId);
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: fillLoginForm, args: [job.adapter, job.creds] });
      const r = res && res.result;
      if (!r || r.aborted) return; // page navigated away mid-fill; the next load retries
      await putJob(tabId, { ...job, creds: null, filled: r.username || r.password });
      if (r.username && r.password) report(tabId, 'needs_user', 'Details filled. Complete CAPTCHA / OTP and sign in on the portal.');
      else if (r.username || r.password) report(tabId, 'needs_user', `Only the ${r.username ? 'login ID' : 'password'} box was found. Fill the rest on the portal.`);
      else report(tabId, 'error', 'Could not find the sign-in fields on the portal page. Sign in manually.');
    } catch {
      // Navigation or a closed tab interrupted the script; the next load retries until the job expires.
    } finally {
      filling.delete(tabId);
    }
    return;
  }

  if (!job.filled) return;
  if (Date.now() > job.watchUntil) return dropJob(tabId);
  if (!allowedHost(job.adapter.hosts, url)) return;
  const s = job.adapter.signedIn || {};
  let signedIn = (s.urlIncludes || []).some((part) => url.includes(part));
  if (!signedIn && s.selector && info.status === 'complete') {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: (sel) => !!document.querySelector(sel), args: [s.selector] }).catch(() => []);
    signedIn = !!(res && res.result);
  }
  if (signedIn) {
    report(tabId, 'signed_in', 'The portal shows a signed-in page.');
    await dropJob(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  ports.delete(tabId);
  filling.delete(tabId);
  dropJob(tabId);
});

/**
 * Runs inside the portal page (isolated world). Waits up to two minutes for
 * the fields (some portals ask for the user ID first and the password on the
 * next screen), fills them, and focuses the CAPTCHA box. Never submits.
 */
async function fillLoginForm(adapter, creds) {
  const hostOk = () => {
    const host = location.hostname.replace(/^www\./, '');
    return location.protocol === 'https:' && adapter.hosts.some((h) => host === h || host.endsWith(`.${h}`));
  };
  const visible = (el) => !!el && !el.disabled && !el.readOnly && el.getClientRects().length > 0;
  const find = (sels) => {
    for (const s of sels || []) {
      try {
        for (const el of document.querySelectorAll(s)) if (visible(el)) return el;
      } catch {
        /* bad selector */
      }
    }
    return null;
  };
  const anyPassword = () => [...document.querySelectorAll('input[type="password"]')].find(visible) || null;
  const userBefore = (pw) => {
    const inputs = [...document.querySelectorAll('input:not([type]), input[type="text"], input[type="email"], input[type="tel"]')].filter(visible);
    const before = inputs.filter((i) => i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
    return before[before.length - 1] || null;
  };
  const set = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    if (setter) setter.call(el, v);
    else el.value = v;
    for (const type of ['input', 'change', 'blur']) el.dispatchEvent(new Event(type, { bubbles: true }));
  };

  if (adapter.fillOnFocus) {
    // Canvas apps (Flutter web) create a hidden <input> only for the box the user clicks into.
    // Fill that box: login ID into the first plain box, password into the password box.
    // A box that already has text is never overwritten, and nothing is submitted.
    return new Promise((resolve) => {
      const done = { username: false, password: false };
      const finish = () => {
        document.removeEventListener('focusin', onFocus, true);
        clearTimeout(timer);
        resolve({ ...done });
      };
      const fill = (el, isPw, attempt) => {
        if (!hostOk() || !el.isConnected) return;
        const value = isPw ? creds.password : creds.username;
        set(el, value);
        // Flutter may reset the box while it wires it up; check once and fill again if so.
        if (attempt === 0) return setTimeout(() => (el.value === value ? mark() : fill(el, isPw, 1)), 400);
        mark();
        function mark() {
          if (el.value !== value) return;
          done[isPw ? 'password' : 'username'] = true;
          if (done.username && done.password) finish();
        }
      };
      const onFocus = (e) => {
        const el = e.composedPath()[0];
        if (!el || !['INPUT', 'TEXTAREA'].includes(el.tagName)) return;
        const isPw = el.tagName === 'INPUT' && el.type === 'password';
        if ((isPw ? done.password : done.username) || (!isPw && el.value)) return;
        setTimeout(() => fill(el, isPw, 0), 200);
      };
      document.addEventListener('focusin', onFocus, true);
      const timer = setTimeout(finish, 180000);
    });
  }

  const done = { username: false, password: false, extra: !creds.extra || !adapter.extra };
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (!hostOk()) return { aborted: true };
    const pw = find(adapter.password) || anyPassword();
    if (!done.username) {
      const el = find(adapter.username) || (pw ? userBefore(pw) : null);
      if (el && el !== pw) {
        set(el, creds.username);
        done.username = true;
      }
    }
    if (!done.password && pw) {
      set(pw, creds.password);
      done.password = true;
    }
    if (!done.extra) {
      const el = find(adapter.extra);
      if (el) {
        set(el, creds.extra);
        done.extra = true;
      }
    }
    if (done.username && done.password && done.extra) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const next = find(adapter.focusAfter);
  if (next) next.focus();
  return { username: done.username, password: done.password };
}
