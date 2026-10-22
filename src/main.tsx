import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, MemoryRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// Static hosts without SPA fallbacks (GitHub Pages) use hash URLs; sandboxed previews use an in-memory router.
const mode = import.meta.env.VITE_ROUTER;
const Router = mode === 'memory' ? MemoryRouter : mode === 'hash' ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
);
