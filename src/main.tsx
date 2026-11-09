import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './app/App';
import { StoreProvider } from './state/store';
import { initPwa } from './state/pwa';
import { ErrorBoundary } from './app/ErrorBoundary';

initPwa();

// iOS-Home-Bildschirm-Apps: Manche iOS-Versionen melden eine sichtbare Fläche, die unten kürzer ist als der Bildschirm.
// Früher wurde die App dann nach unten verlängert – stimmte die Meldung nicht, rutschte die Leiste unter den Rand.
// Jetzt bleibt die App immer innerhalb der gemeldeten Fläche (nichts wird abgeschnitten). Eine echte Lücke darunter
// füllt die Hintergrundfarbe der Leiste, und der Abstand für den Home-Balken wird um die Lücke verkleinert.
function fitStandalone(): void {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const portrait = window.innerHeight > window.innerWidth;
  const gap = standalone && portrait ? Math.round(window.screen.height - window.innerHeight) : 0;
  document.documentElement.style.setProperty('--gap', `${gap > 0 && gap <= 60 ? gap : 0}px`);
}
fitStandalone();
window.addEventListener('resize', fitStandalone);
window.addEventListener('orientationchange', fitStandalone);
window.visualViewport?.addEventListener('resize', fitStandalone);
document.addEventListener('visibilitychange', fitStandalone);
// iOS Safari zeigt :active (Druck-Feedback) nur, wenn es irgendwo einen touchstart-Empfänger gibt
document.addEventListener('touchstart', () => undefined, { passive: true });
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode><ErrorBoundary><StoreProvider><App /></StoreProvider></ErrorBoundary></StrictMode>
);
