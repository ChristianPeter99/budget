/**
 * Röhrenfernseher-Effekt („CRT off/on“).
 * Aus: Bild zieht sich senkrecht zu einer hellen Linie zusammen (300 ms), die Linie schrumpft zum Punkt (200 ms),
 * der Punkt leuchtet kurz auf und erlischt. An: Aufwärmen – das Bild kommt leicht überstrahlt aus dem Schwarz.
 * Nur CSS-Transformationen über die Web Animations API – keine Bibliothek. Mit „Bewegung reduzieren“ nur Ein-/Ausblenden.
 */

/** Einschalt-Effekt beim Start der App – zurzeit aus (zum Testen von Zurücksetzen und Version). Auf true setzen zum Einschalten. */
export const CRT_ON_START = false;

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

/** Röhre aus: Bild zur hellen Linie, Linie zum Punkt, Punkt erlischt. hide() blendet das Bild aus, sobald die Linie übernimmt. */
async function collapse(target: HTMLElement, hide: () => void): Promise<void> {
  target.style.transformOrigin = `50% ${window.innerHeight / 2}px`;
  // 1) Bild einfrieren und senkrecht zur hellen Linie zusammenziehen
  await run(target, [
    { transform: 'scale(1, 1)', filter: 'brightness(1)' },
    { transform: 'scale(1, 0.006)', filter: 'brightness(6)' }
  ], { duration: 300, easing: 'cubic-bezier(.55,0,.85,.4)' });
  const { el, line, dot } = layer();
  hide();
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
}

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
  await collapse(r, () => { r.getAnimations().forEach((a) => a.cancel()); r.style.opacity = '0'; });
  busy = false;
}

/**
 * Bildschirm „einschalten“ wie eine echte Röhre beim Aufwärmen: Das Bild kommt aus dem Schwarz,
 * anfangs leicht überstrahlt, weich und minimal größer, und setzt sich in ~450 ms scharf an seinen Platz.
 */
export async function crtOn(): Promise<void> {
  const r = rootEl();
  if (!r || busy) return;
  busy = true;
  r.style.pointerEvents = 'none';
  document.querySelectorAll('.crt').forEach((e) => e.remove());
  r.style.opacity = '';
  if (reduced()) {
    await run(r, [{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    crtReset();
    return;
  }
  r.style.transformOrigin = `50% ${window.innerHeight / 2}px`;
  await run(r, [
    { opacity: 0, transform: 'scale(1.02)', filter: 'brightness(1.9) blur(2px)' },
    { opacity: 0.55, transform: 'scale(1.014)', filter: 'brightness(1.6) blur(1.2px)', offset: 0.3 },
    { opacity: 0.5, transform: 'scale(1.012)', filter: 'brightness(1.5) blur(1px)', offset: 0.38 },
    { opacity: 0.9, transform: 'scale(1.004)', filter: 'brightness(1.15) blur(.3px)', offset: 0.7 },
    { opacity: 1, transform: 'scale(1)', filter: 'brightness(1) blur(0)' }
  ], { duration: 460, easing: 'cubic-bezier(.25,.6,.3,1)' });
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wie lange der Bildschirm zwischen Aus und An schwarz bleibt (Zurücksetzen und Extra). */
export const CRT_DARK_MS = 1100;
/** Rauschen und Testbild beim Extra */
const SNOW_MS = 2500;
const CARD_MS = 5000;

/** Schwarzes Bild halten (eigene Ebene, damit nichts von der App durchscheint). */
function black(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'crt';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  return el;
}

/** Testbild mit laufender Uhr („Sendepause“) */
function testCard(version: string): { el: HTMLDivElement; stop: () => void } {
  const el = black();
  el.innerHTML = `
    <div class="tb">
      <div class="tb-bars">${['#bfbfbf', '#bfbf00', '#00bfbf', '#00bf00', '#bf00bf', '#bf0000', '#0000bf'].map((c) => `<i style="background:${c}"></i>`).join('')}</div>
      <div class="tb-mid">${['#0000bf', '#111', '#bf00bf', '#111', '#00bfbf', '#111', '#bfbfbf'].map((c) => `<i style="background:${c}"></i>`).join('')}</div>
      <div class="tb-low">${['#000', '#262626', '#4d4d4d', '#737373', '#999', '#bfbfbf', '#fff'].map((c) => `<i style="background:${c}"></i>`).join('')}</div>
      <div class="tb-ring"><div class="tb-box"><b>BUDGET</b><span class="tb-clock"></span><small>${version}</small></div></div>
      <div class="tb-cap">Sendepause · gleich geht’s weiter</div>
      <div class="tb-scan"></div>
    </div>`;
  const clock = el.querySelector<HTMLElement>('.tb-clock')!;
  // genau auf die volle Sekunde weiterschalten – läuft wie eine echte Uhr
  let t = 0;
  const tick = () => {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString('de-DE');
    t = window.setTimeout(tick, 1000 - now.getMilliseconds() + 5);
  };
  tick();
  return { el, stop: () => window.clearTimeout(t) };
}

/** Rauschen („Schnee“) auf einer kleinen Leinwand, groß gezogen */
async function snow(host: HTMLElement, ms: number): Promise<void> {
  const cv = document.createElement('canvas');
  cv.className = 'tb-snow';
  cv.width = 140; cv.height = 250;
  host.appendChild(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) { cv.remove(); return; }
  const img = ctx.createImageData(cv.width, cv.height);
  const end = performance.now() + ms;
  await new Promise<void>((done) => {
    const frame = () => {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      // ab und zu ein heller Streifen, wie beim Senderwechsel
      const y = (Math.random() * cv.height) | 0;
      for (let x = 0; x < cv.width; x++) { const i = (y * cv.width + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; }
      ctx.putImageData(img, 0, 0);
      // ruhiger flimmern: etwa 14 Bilder pro Sekunde statt bei jedem Bildschirmbild
      if (performance.now() < end) window.setTimeout(frame, 70); else done();
    };
    frame();
  });
  cv.remove();
}

let egg = false;

/**
 * Das Extra (kurz auf die Version halten): wie ein Senderwechsel – das Bild verliert den Halt und rollt weg,
 * Rauschen, Testbild mit Uhr („Sendepause“). Zum Schluss wird der Fernseher ausgeschaltet (Linie, Punkt),
 * bleibt eine Weile schwarz und wärmt dann mit der App wieder auf. Antippen beendet das Testbild früher.
 * Läuft nach dem Auslösen von selbst zu Ende.
 */
export async function crtEgg(version: string): Promise<void> {
  const r = rootEl();
  if (!r || egg || busy) return;
  egg = true;
  busy = true;
  try {
    r.style.pointerEvents = 'none';
    const screen = black();
    screen.style.background = 'transparent';
    // 1) Bildfang verloren: die App rollt nach oben weg, immer schneller
    if (reduced()) await run(r, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
    else await run(r, [
      { transform: 'translateY(0)', filter: 'brightness(1)' },
      { transform: 'translateY(-60%)', filter: 'brightness(1.3)', offset: 0.6 },
      { transform: 'translateY(-130%)', filter: 'brightness(1.8) blur(1px)' }
    ], { duration: 600, easing: 'cubic-bezier(.5,0,.9,.6)' });
    r.getAnimations().forEach((a) => a.cancel());
    r.style.opacity = '0';
    screen.style.background = '';
    // 2) Rauschen
    if (!reduced()) await snow(screen, SNOW_MS);
    // 3) Testbild
    const card = testCard(version);
    screen.remove();
    const tb = card.el.firstElementChild as HTMLElement;
    card.el.style.pointerEvents = 'auto';
    let skip: () => void = () => undefined;
    const skipped = new Promise<void>((res) => { skip = res; });
    card.el.addEventListener('pointerdown', () => skip(), { once: true });
    if (reduced()) {
      await run(tb, [{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
      await Promise.race([sleep(CARD_MS), skipped]);
      await run(tb, [{ opacity: 1 }, { opacity: 0 }], { duration: 250 });
    } else {
      // Röhre fängt sich: kurzes Flackern, dann ruhig
      await run(tb, [
        { opacity: 0, filter: 'brightness(2.2) blur(2px)' }, { opacity: 0.8, offset: 0.15 }, { opacity: 0.2, offset: 0.25 },
        { opacity: 0.95, filter: 'brightness(1.4) blur(.6px)', offset: 0.45 }, { opacity: 0.6, offset: 0.55 },
        { opacity: 1, filter: 'brightness(1) blur(0)' }
      ], { duration: 650, easing: 'linear' });
      await Promise.race([sleep(CARD_MS), skipped]);
      // 4) Fernseher aus: Testbild zur Linie, zum Punkt
      card.el.style.pointerEvents = 'none';
      await collapse(tb, () => { tb.getAnimations().forEach((a) => a.cancel()); tb.style.visibility = 'hidden'; });
    }
    card.stop();
    // 5) eine Weile schwarz, dann wärmt die Röhre mit der App auf
    await sleep(CRT_DARK_MS);
    busy = false;
    await crtOn();
  } finally {
    egg = false;
    if (busy) crtReset();
  }
}
