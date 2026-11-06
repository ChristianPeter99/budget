/**
 * Röhrenfernseher-Effekt („CRT off/on“).
 * Aus: Bild zieht sich senkrecht zu einer hellen Linie zusammen (300 ms), die Linie schrumpft zum Punkt (200 ms),
 * der Punkt leuchtet kurz auf und erlischt. An: dieselbe Folge rückwärts.
 * Nur CSS-Transformationen über die Web Animations API – keine Bibliothek. Mit „Bewegung reduzieren“ nur Ein-/Ausblenden.
 */

/** Einschalt-Effekt beim Start der App. Zum Entfernen auf false setzen (oder die Zeile in App.tsx löschen). */
export const CRT_ON_START = true;

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const rootEl = () => document.getElementById('root');
let busy = false;

function layer(): { el: HTMLDivElement; line: HTMLElement; dot: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'crt';
  el.setAttribute('aria-hidden', 'true');
  const line = document.createElement('i');
  line.className = 'crt-line';
  const dot = document.createElement('i');
  dot.className = 'crt-dot';
  el.append(line, dot);
  document.body.appendChild(el);
  return { el, line, dot };
}

const run = (el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) => el.animate(frames, { fill: 'forwards', ...opts }).finished.catch(() => undefined);

/** Bildschirm „ausschalten“. Danach ist die App unsichtbar, bis crtOn() (oder crtReset()) folgt. */
export async function crtOff(): Promise<void> {
  const r = rootEl();
  if (!r || busy) return;
  busy = true;
  r.style.pointerEvents = 'none';
  if (reduced()) {
    await run(r, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out' });
    busy = false;
    return;
  }
  r.style.transformOrigin = `50% ${window.innerHeight / 2}px`;
  // 1) Bild einfrieren und senkrecht zur hellen Linie zusammenziehen
  await run(r, [
    { transform: 'scale(1, 1)', filter: 'brightness(1)' },
    { transform: 'scale(1, 0.006)', filter: 'brightness(6)' }
  ], { duration: 300, easing: 'cubic-bezier(.55,0,.85,.4)' });
  const { el, line, dot } = layer();
  r.getAnimations().forEach((a) => a.cancel());
  r.style.opacity = '0';
  // 2) Linie schrumpft zum Punkt
  await run(line, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.012)' }], { duration: 200, easing: 'cubic-bezier(.6,0,.4,1)' });
  line.style.display = 'none';
  // 3) Punkt leuchtet kurz auf und erlischt
  await run(dot, [
    { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', boxShadow: '0 0 6px 2px rgba(255,255,255,.9)' },
    { opacity: 1, transform: 'translate(-50%,-50%) scale(1.5)', boxShadow: '0 0 22px 9px rgba(255,255,255,.75)', offset: 0.35 },
    { opacity: 0, transform: 'translate(-50%,-50%) scale(.2)', boxShadow: '0 0 0 0 rgba(255,255,255,0)' }
  ], { duration: 220, easing: 'ease-out' });
  el.remove();
  busy = false;
}

/** Bildschirm „einschalten“: Punkt → Linie → Bild. Ohne vorheriges crtOff blendet es die App aus dem Schwarz ein. */
export async function crtOn(): Promise<void> {
  const r = rootEl();
  if (!r || busy) return;
  busy = true;
  r.style.pointerEvents = 'none';
  if (reduced()) {
    r.style.opacity = '';
    await run(r, [{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    crtReset();
    return;
  }
  r.style.opacity = '0';
  const { el, line, dot } = layer();
  line.style.transform = 'scaleX(0.012)';
  // 1) Punkt leuchtet auf
  await run(dot, [
    { opacity: 0, transform: 'translate(-50%,-50%) scale(.2)', boxShadow: '0 0 0 0 rgba(255,255,255,0)' },
    { opacity: 1, transform: 'translate(-50%,-50%) scale(1.4)', boxShadow: '0 0 20px 8px rgba(255,255,255,.75)' }
  ], { duration: 130, easing: 'ease-out' });
  dot.style.display = 'none';
  // 2) Punkt zieht sich zur Linie auf
  await run(line, [{ transform: 'scaleX(0.012)' }, { transform: 'scaleX(1)' }], { duration: 160, easing: 'cubic-bezier(.3,0,.2,1)' });
  // 3) Linie klappt zum Bild auf
  r.style.transformOrigin = `50% ${window.innerHeight / 2}px`;
  r.style.opacity = '';
  const open = run(r, [
    { transform: 'scale(1, 0.006)', filter: 'brightness(6)' },
    { transform: 'scale(1, 1.02)', filter: 'brightness(1.2)', offset: 0.8 },
    { transform: 'scale(1, 1)', filter: 'brightness(1)' }
  ], { duration: 280, easing: 'cubic-bezier(.2,.8,.3,1)' });
  requestAnimationFrame(() => el.remove());
  await open;
  crtReset();
}

/** Alles zurück auf normal (Transformation entfernen – sonst hingen feste Elemente wie die Leiste am verschobenen Bild). */
export function crtReset(): void {
  const r = rootEl();
  if (r) {
    r.getAnimations().forEach((a) => a.cancel());
    r.style.transform = ''; r.style.transformOrigin = ''; r.style.opacity = ''; r.style.pointerEvents = ''; r.style.filter = '';
  }
  document.querySelectorAll('.crt').forEach((e) => e.remove());
  busy = false;
}
