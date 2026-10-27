# LedgerFlow Portal Helper

A small Chrome/Edge extension (Manifest V3, no build step) that lets the **Login** button in LedgerFlow fill a client's saved login on a government portal.

## Why an extension

A web page can't type into another site's tab. A server-side Playwright or Selenium browser can't drive a tab in the user's own browser, and a remote browser would have to show its own CAPTCHA and OTP screens to the user. An extension is the supported way to fill a form in the user's own browser.

Without the extension, Login still works. It opens the portal's sign-in page in a named tab and shows copy buttons and the remaining steps.

## What happens on Login

1. The app asks the server for **one** credential (`POST /api/clients/:id/logins/:loginId/launch`, audited). The server checks that the login belongs to that client and to the requested portal.
2. The app sends the credential and the portal adapter (`src/config/portalAdapters.ts`) to the extension over `chrome.runtime.connect`. Credentials never go through `window.postMessage`.
3. The extension opens a tab, or reuses the tab it opened earlier for the same client login. A second click while a job is pending is refused.
4. When the tab loads **over HTTPS on one of the adapter's hosts**, the extension types the login ID, the password and any extra field, focuses the CAPTCHA box, and **forgets the credentials**. It never submits the form.
5. The user completes CAPTCHA, OTP, DSC or consent steps. The app shows progress.
6. The extension reports "signed in" only when the adapter's `signedIn` check matches (a URL fragment or a page element). Custom portals have no such check, so they never report success.

Jobs are held in `chrome.storage.session`, which lives in memory only and can't be read by content scripts. They expire after 3 minutes.

## Install (unpacked)

1. Add your LedgerFlow address to `manifest.json` under both `content_scripts[0].matches` and `externally_connectable.matches`, e.g. `"https://ledgerflow.example.com/*"`. `localhost` is already listed for development.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose this folder.
3. Reload LedgerFlow. The sign-in assistant stops showing the "Install the LedgerFlow Portal Helper" hint.

For a firm-wide rollout, publish the extension privately or push it through Chrome Enterprise policy.

## Permissions

- `scripting` + `https://*/*` host access: needed to type into custom portals whose addresses aren't known in advance. The helper only injects into tabs it opened itself, and only on the adapter's hosts.
- `storage`: for the in-memory session job store.

## Limits

- Field selectors in `src/config/portalAdapters.ts` are best-effort and **have not been tested against the live portals**. Portals change their markup, so check after a portal redesign. When no selector matches, the helper falls back to the first visible password box and the text box before it.
- Portals built with Flutter web (TRACES since its 2025 redesign) draw the page on a canvas and have no input boxes until one is clicked. For these, the adapter sets `fillOnFocus`: the user clicks the User ID box, then the Password box, and the helper fills each one as it gets focus. It never overwrites a box that already has text.
- Only the top frame is filled. Sign-in forms inside iframes aren't supported.
- CAPTCHA, OTP, MFA and DSC are never automated.
