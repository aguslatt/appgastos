import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/calculator.css';
import './styles/month.css';
import './styles/history.css';
import './styles/settings.css';
import './styles/story.css';
import './styles/goals.css';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);

// Offline support and install: only in the built app (the dev server has no service worker).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const hadController = navigator.serviceWorker.controller !== null;
    navigator.serviceWorker
      .register('./sw.js')
      .then(() => {
        // A new version took over while the app was open: offer a reload.
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (hadController) window.dispatchEvent(new CustomEvent('mg:update'));
        });
      })
      .catch(() => undefined);
  });
}
