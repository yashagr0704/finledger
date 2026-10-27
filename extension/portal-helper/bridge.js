// Runs on the LedgerFlow app. It only tells the page which extension id to
// connect to; credentials go straight from the page to the extension over
// chrome.runtime.connect and never pass through window.postMessage.
const hello = () => window.postMessage({ source: 'ledgerflow-helper', type: 'hello', id: chrome.runtime.id }, location.origin);

window.addEventListener('message', (e) => {
  if (e.source === window && e.data && e.data.source === 'ledgerflow-app' && e.data.type === 'ping') hello();
});
hello();
