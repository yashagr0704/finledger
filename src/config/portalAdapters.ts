import type { Portal } from '@/types';

/**
 * How the Portal Helper browser extension signs in to each portal.
 *
 * The extension is generic: the app sends it the adapter together with the
 * credentials, so portal-specific knowledge lives only here. Selectors are
 * tried in order; when none match, the helper falls back to the first visible
 * password box and the text box before it. Government portals change their
 * markup without notice, so keep these lists short and verify after a portal
 * redesign.
 *
 * Adapters only fill fields. CAPTCHA, OTP, DSC and consent checkboxes are
 * always left to the user.
 */
export interface PortalAdapter {
  /** Page the helper opens. */
  loginUrl: string;
  /** Hostnames credentials may be typed into (exact match or a subdomain of one). */
  hosts: string[];
  username: string[];
  password: string[];
  /** Field for the login's non-secret extra detail (e.g. TAN on TRACES). */
  extra?: string[];
  /** Field the cursor goes to after filling, usually the CAPTCHA box. */
  focusAfter?: string[];
  /** Evidence the portal shows a signed-in page. Without it the helper never reports success. */
  signedIn?: { urlIncludes?: string[]; selector?: string };
  /**
   * For canvas-rendered apps (Flutter web) that have no input boxes until one is clicked:
   * fill whichever box the user clicks into — login ID into the first plain box, password
   * into the password box — instead of searching for fields.
   */
  fillOnFocus?: boolean;
  /** Shown in the app while the helper is working, e.g. what to click. */
  fillHint?: string;
  /** What the user still has to do, shown in the app. */
  steps: string[];
}

type Known = Omit<PortalAdapter, 'hosts'> & { hosts?: string[] };

const KNOWN: Record<string, Known> = {
  pt_gst: {
    loginUrl: 'https://services.gst.gov.in/services/login',
    hosts: ['gst.gov.in'],
    username: ['#username', 'input[name="user_name"]'],
    password: ['#user_pass', 'input[name="user_pass"]'],
    focusAfter: ['#captcha', 'input[name="captcha"]'],
    signedIn: { urlIncludes: ['/services/auth/'], selector: 'a[href*="logout"]' },
    steps: ['Type the CAPTCHA shown on the page', 'Click LOGIN'],
  },
  pt_it: {
    loginUrl: 'https://eportal.incometax.gov.in/iec/foservices/#/login',
    hosts: ['incometax.gov.in'],
    username: ['#panAdhaarUserId', 'input[formcontrolname="userId"]'],
    password: ['#loginPasswordField', 'input[formcontrolname="password"]'],
    signedIn: { urlIncludes: ['#/dashboard'] },
    fillHint: 'Login ID filled — click Continue on the portal; the password fills on the next screen.',
    steps: ['Click Continue after the user ID is filled', 'Tick “Please confirm your secure access message”', 'Complete OTP if the portal asks for it'],
  },
  // New TRACES (2025+) is a Flutter web app drawn on a canvas: no field ids exist until a box is
  // clicked, so the helper fills the box the user clicks into. The form asks for user ID,
  // password, user type and CAPTCHA (no TAN/PAN box); signed-in pages live under /auth/dashboard/.
  pt_traces: {
    loginUrl: 'https://traces.tdscpc.gov.in/auth/login/loginScreen',
    hosts: ['traces.tdscpc.gov.in', 'tdscpc.gov.in'],
    username: [],
    password: ['input[type="password"]'],
    fillOnFocus: true,
    fillHint: 'Click the User ID box, then the Password box — the helper fills each one.',
    signedIn: { urlIncludes: ['/auth/dashboard/'] },
    steps: ['Click the User ID box, then the Password box (the helper fills them)', 'Choose the user type (Deductor / Taxpayer / PAO)', 'Enter the CAPTCHA', 'Click Login'],
  },
  pt_mca: {
    loginUrl: 'https://www.mca.gov.in/content/mca/global/en/foportal/fologin.html',
    hosts: ['mca.gov.in'],
    username: ['input[type="email"]', 'input[name*="user" i]'],
    password: ['input[type="password"]'],
    steps: ['Enter the CAPTCHA', 'Complete OTP if prompted', 'Click Sign In'],
  },
  pt_epfo: {
    loginUrl: 'https://unifiedportal-emp.epfindia.gov.in/epfo/',
    hosts: ['epfindia.gov.in'],
    username: ['#username', 'input[name="username"]'],
    password: ['#password', 'input[name="password"]'],
    focusAfter: ['#captcha', 'input[name="captcha"]'],
    steps: ['Enter the CAPTCHA', 'Click Sign In'],
  },
  pt_esic: {
    loginUrl: 'https://www.esic.in/EmployerPortal/ESICInsurancePortal/Portal_Loginnew.aspx',
    hosts: ['esic.in', 'esic.gov.in'],
    username: ['#txtUserName', 'input[name*="UserName" i]'],
    password: ['#txtPassword', 'input[type="password"]'],
    focusAfter: ['#txtCaptcha', 'input[name*="captcha" i]'],
    steps: ['Enter the CAPTCHA', 'Click Login'],
  },
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** The adapter for a portal: a tuned one for known portals, a generic one for custom portals. */
export function adapterFor(portal: Portal): PortalAdapter {
  const known = KNOWN[portal.id];
  const loginUrl = portal.loginUrl || known?.loginUrl || portal.url;
  const hosts = [...new Set([...(known?.hosts ?? []), hostOf(loginUrl), hostOf(portal.url)].filter(Boolean))];
  if (known) return { ...known, loginUrl, hosts };
  return {
    loginUrl,
    hosts,
    username: ['input[type="email"]', 'input[autocomplete="username"]', 'input[name*="user" i]', 'input[id*="user" i]', 'input[name*="login" i]'],
    password: ['input[type="password"]'],
    steps: ['Complete any CAPTCHA or OTP the portal asks for', 'Click the portal’s sign-in button'],
  };
}

/** Is `url` on one of the adapter's hosts? Used before any credential is typed. */
export function isAllowedHost(adapter: PortalAdapter, url: string) {
  const host = hostOf(url);
  return !!host && adapter.hosts.some((h) => host === h || host.endsWith(`.${h}`));
}
