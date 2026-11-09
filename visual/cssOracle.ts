import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { appendFileSync, readFileSync } from 'node:fs';

/**
 * Stil-Vergleich (Hilfe für den CSS-Umbau): Im aktuellen Zustand der Seite werden die berechneten Stile aller
 * Elemente (inkl. ::before/::after) einmal mit CSS_A und einmal mit CSS_B ermittelt. Unterschiede landen in CSS_OUT.
 * Nur aktiv, wenn die drei Umgebungsvariablen gesetzt sind.
 */
export async function cssOracle(page: Page, label: string): Promise<void> {
  const A = process.env.CSS_A, B = process.env.CSS_B, OUT = process.env.CSS_OUT;
  if (!A || !B || !OUT || page.isClosed()) return;
  const a = readFileSync(A, 'utf8'), b = readFileSync(B, 'utf8');
  const res = await page.evaluate(([a, b]) => {
    const KILL = '*,*::before,*::after{transition:none!important;animation:none!important}';
    const desc = (el: Element) => { const parts: string[] = []; let e: Element | null = el; for (let i = 0; e && i < 4; i++, e = e.parentElement) parts.unshift(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '')); return parts.join(' > '); };
    const ELS = [...document.querySelectorAll('*')];
    const snap = (only?: RegExp) => {
      const out: Map<string, string>[] = [];
      for (const el of ELS) for (const pe of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, pe);
        const m = new Map<string, string>();
        if (pe && cs.content === 'none') { out.push(m); continue; }
        for (let i = 0; i < cs.length; i++) { const p = cs[i]!; if (!only || only.test(p)) m.set(p, cs.getPropertyValue(p)); }
        out.push(m);
      }
      return out;
    };
    const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
    const kill = document.createElement('style'); kill.textContent = KILL;
    const st = document.createElement('style');
    document.head.appendChild(kill);
    const base = snap();
    links.forEach((l) => { l.disabled = true; });
    document.head.insertBefore(st, kill);
    st.textContent = a; const sa = snap();
    st.textContent = b; const sb = snap();
    kill.remove();
    const TA = /^(transition|animation)/;
    st.textContent = a; const ta = snap(TA);
    st.textContent = b; const tb = snap(TA);
    st.remove(); links.forEach((l) => { l.disabled = false; });
    const els = ELS;
    const diff = (x: Map<string, string>[], y: Map<string, string>[]) => {
      const d: string[] = [];
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const p = x[i]!, q = y[i]!;
        for (const [k, v] of p) if (q.get(k) !== v) { d.push(`${desc(els[Math.floor(i / 3)]!)}${['', '::before', '::after'][i % 3]} ${k}: ${v} → ${q.get(k)}`); if (d.length > 30) return d; }
      }
      if (x.length !== y.length) d.push(`Anzahl ${x.length} → ${y.length}`);
      return d;
    };
    return { sanity: diff(base, sa).slice(0, 5), styles: diff(sa, sb), motion: diff(ta, tb) };
  }, [a, b] as const);
  appendFileSync(OUT, JSON.stringify({ label, ...res }) + '\n');
}

/** In einer Testdatei aufrufen: vergleicht nach jedem Test den Endzustand. */
export function cssOracleAfterEach(): void {
  test.afterEach(async ({ page }, info) => { try { await cssOracle(page, info.titlePath.join(' › ')); } catch { /* Seite schon zu */ } });
}
