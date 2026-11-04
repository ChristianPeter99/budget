import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { useStore } from '../state/store';
import { monthLabel, shiftMonth } from '../domain/dates';
import { formatAmountTyping, formatEUR } from '../domain/money';
import type { Category, CatGroup } from '../domain/types';

export const GROUP_COLOR: Record<CatGroup, string> = { einnahme: 'var(--inc)', fix: 'var(--fix)', alltag: 'var(--all)', spar: 'var(--spar)' };
export const GROUP_TILE: Record<CatGroup, string> = { einnahme: 't-in', fix: 't-fix', alltag: 't-all', spar: 't-spar' };
export const GROUP_LABEL: Record<CatGroup, string> = { einnahme: 'Einnahme', fix: 'Fixkosten', alltag: 'Alltag', spar: 'Sparen' };

export function catIcon(cats: Category[], c: Category): string {
  const top = c.parentId ? cats.find((x) => x.id === c.parentId) : c;
  return c.icon ?? top?.icon ?? top?.name ?? 'dots';
}

export function MonthNav({ month, onChange, onEdit, editLabel = 'Kategorien bearbeiten' }: { month: string; onChange: (m: string) => void; onEdit?: () => void; editLabel?: string }) {
  return (
    <div className="mn">
      {onEdit && <button className="ib editbtn" aria-label={editLabel} onClick={onEdit}><Icon name="edit" size={19} /></button>}
      <button className="ib" aria-label="Vorheriger Monat" onClick={() => onChange(shiftMonth(month, -1))}><Icon name="left" /></button>
      <button className="ib" aria-label="Nächster Monat" onClick={() => onChange(shiftMonth(month, 1))}><Icon name="right" /></button>
    </div>
  );
}

export function Header({ kicker, title, right, monthSwipe, keepLine }: { kicker?: ReactNode; title: string; right?: ReactNode; monthSwipe?: boolean; keepLine?: boolean }) {
  return (
    <div className="hd" data-swipe={monthSwipe ? 'month' : undefined}>
      {/* keepLine: leere Zeile über dem Titel, damit er auf derselben Höhe steht wie der Monat auf den anderen Reitern */}
      <div>{kicker ? <div className="kick">{kicker}</div> : keepLine ? <div className="kick" aria-hidden="true"><span className="kk">&nbsp;</span></div> : null}<h1>{title}</h1></div>
      {right}
    </div>
  );
}

export function MonthHeader({ month, onChange, kicker }: { month: string; onChange: (m: string) => void; kicker?: ReactNode }) {
  return <Header kicker={kicker} title={monthLabel(month)} right={<MonthNav month={month} onChange={onChange} />} />;
}

export function Bar({ ratio, color, large }: { ratio: number; color: string; large?: boolean }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 1)) * 100;
  return <div className={'bar' + (large ? ' l' : '')} role="presentation"><i style={{ width: `${pct}%`, background: color }} /></div>;
}

export function Money({ cents, signed }: { cents: number; signed?: boolean }) {
  const cls = cents < 0 ? 'neg' : signed && cents > 0 ? 'pos' : '';
  return <span className={'num ' + cls}>{signed && cents > 0 ? '+' : ''}{formatEUR(cents)}</span>;
}

let openSheets = 0;
/** Während ein Blatt offen ist, scrollt der Hintergrund nicht mit (iOS reicht Scrollen sonst durch). */
function lockBackground(on: boolean): void {
  openSheets = Math.max(0, openSheets + (on ? 1 : -1));
  document.querySelectorAll<HTMLElement>('.view').forEach((v) => { v.style.overflowY = openSheets > 0 ? 'hidden' : ''; });
}

export function Sheet({ title, onClose, left = 'Abbrechen', right, children }: { title: string; onClose: () => void; left?: string; right?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  useEffect(() => { lockBackground(true); return () => lockBackground(false); }, []);
  // Außerhalb des scrollenden Inhalts (direkt in .app), damit nichts das Blatt beschneidet oder mitbewegt; Meldungen bleiben darüber
  return createPortal(
    <div className="sheetwrap" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bd" onClick={onClose} />
      <div className="panel">
        <div className="ph">
          <button className="lnk" onClick={onClose}>{left}</button>
          <h2>{title}</h2>
          <div style={{ minWidth: 84, textAlign: 'right' }}>{right}</div>
        </div>
        {children}
      </div>
    </div>,
    document.querySelector('.app') ?? document.body
  );
}

export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }

export function Back({ onClick, label = 'Mehr' }: { onClick: () => void; label?: string }) {
  return <button className="back" onClick={onClick}><Icon name="left" size={16} w={2.2} />{label}</button>;
}

/** Dauer der Monatswechsel-Animationen (Betrag und Kreisdiagramm laufen synchron), Ausklang ease-out */
export const ANIM_MS = 600;
/** Hochzählen von Beträgen: etwas schneller als das Diagramm, damit die Zahl schnell lesbar ist */
export const COUNT_MS = 380;

/** Animiert eine Zahlenliste weich zum neuen Stand (wie „Noch verfügbar“). Bei „Bewegung reduzieren“ sofort. */
function useTweenList(target: number[], ms = ANIM_MS): number[] {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  const key = target.join('|');
  useEffect(() => {
    const from = cur.current, to = target;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || from.length !== to.length) { cur.current = to; setV(to); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3); // ease-out
      const next = to.map((x, i) => (from[i] ?? 0) + (x - (from[i] ?? 0)) * e);
      cur.current = next;
      setV(next);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms]);
  return v;
}

/**
 * Ring der Übersicht: Anteile (z. B. Fix/Alltag/Sparen) am Ganzen (Einnahmen) als ein Bogen ab 12 Uhr.
 * Gerade Übergänge zwischen den Abschnitten, abgerundet nur an Anfang und Ende. Wechselt weich (ANIM_MS).
 */
export function SpendRing({ parts, total, size = 132, label }: { parts: { value: number; color: string }[]; total: number; size?: number; label: string }) {
  // Außenkante wie bisher (63,5), Ring nach innen dicker – im Verhältnis wie die Kreisdiagramme der Detailansicht
  const R = 51.5, W = 24, C = 2 * Math.PI * R;
  const vals = useTweenList([...parts.map((p) => Math.max(0, p.value)), Math.max(0, total)]);
  const tot = Math.max(vals[vals.length - 1] ?? 0, vals.slice(0, -1).reduce((a, x) => a + x, 0), 1);
  let off = 0;
  const segs = parts.map((p, i) => { const len = ((vals[i] ?? 0) / tot) * C; const seg = { len, off, color: p.color }; off += len; return seg; }).filter((x) => x.len > 0.2);
  const full = off >= C - 0.5;
  // Gerade Kanten überall; feine Fugen in Hintergrundfarbe zwischen den Teilen und am Ende (Variante E)
  const fuge = (l: number) => {
    const a = (l / C) * 2 * Math.PI, sx = Math.sin(a), cy = -Math.cos(a), r0 = R - W / 2 - 1, r1 = R + W / 2 + 1;
    return { x1: 66 + r0 * sx, y1: 66 + r0 * cy, x2: 66 + r1 * sx, y2: 66 + r1 * cy };
  };
  const cuts = segs.slice(1).map((sg) => sg.off);
  const last = segs[segs.length - 1];
  if (last && !full) cuts.push(last.off + last.len);
  return (
    <svg width={size} height={size} viewBox="0 0 132 132" role="img" aria-label={label} style={{ flex: 'none' }}>
      <circle cx="66" cy="66" r={R} fill="none" stroke="var(--ring-track)" strokeWidth={W} />
      <g transform="rotate(-90 66 66)" fill="none" strokeWidth={W}>
        {segs.map((sg, i) => <circle key={i} cx="66" cy="66" r={R} stroke={sg.color} strokeDasharray={`${sg.len} ${C - sg.len}`} strokeDashoffset={-sg.off} />)}
      </g>
      {cuts.map((l, i) => { const f = fuge(l); return <line key={i} {...f} style={{ stroke: 'var(--bg)' }} strokeWidth={i === cuts.length - 1 && !full ? 1.5 : 2.5} />; })}
    </svg>
  );
}

export function Donut({ parts, size = 116 }: { parts: { value: number; color: string }[]; size?: number }) {
  const r = 46, c = 2 * Math.PI * r;
  const vals = useTweenList(parts.map((p) => Math.max(0, p.value)));
  const total = vals.reduce((a, x) => a + x, 0);
  let off = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Verteilung der Ausgaben">
      <circle cx="60" cy="60" r={r} fill="none" stroke="#34363F" strokeWidth="10" />
      {total > 0 && parts.map((p, i) => {
        const len = ((vals[i] ?? 0) / total) * c;
        const el = <circle key={i} cx="60" cy="60" r={r} fill="none" stroke={p.color} strokeWidth="10" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform="rotate(-90 60 60)" />;
        off += len;
        return el;
      })}
    </svg>
  );
}

/** Betragsfeld mit Tausenderpunkten während der Eingabe (z. B. „100.000“). Ein getippter Punkt am Ende wird zum Komma. */
export function AmountInput({ value, onChange, label, placeholder = '0', autoFocus }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; autoFocus?: boolean }) {
  return (
    <input
      aria-label={label} inputMode="decimal" placeholder={placeholder} value={value} autoFocus={autoFocus}
      onChange={(e) => {
        let raw = e.target.value;
        if (raw.length === value.length + 1 && raw.endsWith('.') && !value.includes(',')) raw = raw.slice(0, -1) + ',';
        onChange(formatAmountTyping(raw));
      }}
    />
  );
}

export function Chevron({ open }: { open: boolean }) {
  return <span className="chev" style={{ transform: open ? 'rotate(90deg)' : 'none' }}><Icon name="right" size={14} w={2.4} /></span>;
}

/** Betrag einer Buchung in Listen: Ausgaben ohne Vorzeichen, Einnahmen mit „+“. Minus nur für negative Salden. */
export function TxAmount({ t }: { t: { type: 'income' | 'expense'; amountCents: number } }) {
  return <span className={'amt' + (t.type === 'income' ? ' inc' : '')}>{t.type === 'income' ? '+' : ''}{formatEUR(t.amountCents)}</span>;
}

/** Balkenfarbe nach Zustand: über Budget = rot, ab 85 % = Bernstein („wird knapp“), sonst die Grundfarbe. */
export function barColor(ratio: number, over: boolean, base: string): string {
  if (over) return 'var(--neg)';
  if (ratio >= 0.85) return 'var(--warn)';
  return base;
}

/** Kleiner Pfeil › für antippbare Zeilen und Textknöpfe */
export function Chevr() {
  return <span className="chevr" aria-hidden="true"><Icon name="right" size={14} w={2.2} /></span>;
}

/** Zählt eine Zahl beim Wechsel hoch (COUNT_MS). Bei „Bewegung reduzieren“ sofort. */
export function useCountUp(target: number): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const start = from.current;
    if (reduce || start === target) { from.current = target; setV(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / COUNT_MS);
      const eased = 1 - Math.pow(1 - k, 3);
      setV(Math.round(start + (target - start) * eased));
      if (k < 1) raf = requestAnimationFrame(step); else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target]);
  return v;
}

/** Umschalter „Ich | Gemeinsam“ – erscheint nur, wenn ein gemeinsames Konto eingerichtet ist. */
export function AccountSwitch() {
  const { data, acct, setAcct } = useStore();
  const j = data.settings.joint;
  if (!j?.enabled) return null;
  return (
    <div className="seg" role="tablist" aria-label="Konto">
      <button role="tab" aria-selected={acct === 'own'} className={acct === 'own' ? 'on' : ''} onClick={() => setAcct('own')}>Ich</button>
      <button role="tab" aria-selected={acct === 'joint'} className={acct === 'joint' ? 'on' : ''} onClick={() => setAcct('joint')}>{j.name}</button>
    </div>
  );
}

/** Zeile unter der Übersicht in Alltag und Fixkosten: neue Kategorie anlegen bzw. Kategorien bearbeiten */
export function CatActions({ onNew, onEdit }: { onNew: () => void; onEdit: () => void }) {
  return (
    <div className="catactions">
      <button className="pillbtn" onClick={onNew}><Icon name="plus" size={18} w={2.2} />Neue Kategorie</button>
      <button className="pillbtn" onClick={onEdit}>Bearbeiten</button>
    </div>
  );
}

/** Ein Abschnitt im Kategorie-Balken. */
export interface CatSeg { id: string; name: string; icon: string; cents: number }

/**
 * Hoher Balken mit einem Abschnitt je Kategorie und dem Kategorie-Symbol darin.
 * Abschnitte nach Betrag absteigend. `base` ist 100 %: beim Alltag das Budget (Rest bleibt dunkel), bei Fixkosten die Summe (immer voll).
 * Ein Symbol erscheint nur, wenn der Abschnitt mindestens 26 px breit ist.
 */
export function CatBar({ segs, base, color, label, over, onOpen }: { segs: CatSeg[]; base: number; color: string; label: string; over?: boolean; onOpen?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || 340);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 340));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Beim Monatswechsel gleiten die Abschnitte wie der Ring der Übersicht zu ihren neuen Breiten
  const tw = useTweenList([...segs.map((s) => Math.max(0, s.cents)), Math.max(0, base)]);
  const cur = new Map(segs.map((s, i) => [s.id, tw[i] ?? 0]));
  // Größte Ausgabe links, dann absteigend – unabhängig von der Reihenfolge der Liste darunter
  const shown = segs.filter((s) => s.cents > 0 || (cur.get(s.id) ?? 0) > 1).sort((a, b) => b.cents - a.cents || (cur.get(b.id) ?? 0) - (cur.get(a.id) ?? 0));
  const total = Math.max(tw[segs.length] ?? base, shown.reduce((a, s) => a + (cur.get(s.id) ?? 0), 0));
  return (
    <div ref={ref} className={'catbar' + (over ? ' over' : '') + (onOpen ? ' tap' : '')} role={onOpen ? 'button' : 'img'} tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? `${label}. Details anzeigen` : label} onClick={onOpen}
      onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } } : undefined}>
      {total > 0 && shown.map((s) => {
        const pct = ((cur.get(s.id) ?? 0) / total) * 100;
        return (
          <span key={s.id} style={{ width: `${pct}%`, background: color }}>
            {(pct / 100) * w >= 26 && <Icon name={s.icon} size={16} w={2.1} />}
          </span>
        );
      })}
    </div>
  );
}

const COLLAPSE_KEY = 'budget.collapsed.v1';
function readCollapsed(): Record<string, string[]> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string[]>) : {};
  } catch { return {}; }
}

/**
 * Welche Kategorien eingeklappt sind – je Ansicht (z. B. „alltag“, „joint“, „fix“), auf diesem Gerät gemerkt.
 * Enthält nur Kategorie-IDs, keine Beträge. Ohne Speicher (privates Fenster) gilt: alles aufgeklappt.
 */
export function useCollapsed(view: string) {
  const [set, setSet] = useState<Set<string>>(() => new Set(Array.isArray(readCollapsed()[view]) ? readCollapsed()[view] : []));
  const toggle = (id: string) => setSet((old) => {
    const n = new Set(old);
    if (n.has(id)) n.delete(id); else n.add(id);
    try { const all = readCollapsed(); all[view] = [...n]; localStorage.setItem(COLLAPSE_KEY, JSON.stringify(all)); } catch { /* nur Komfort */ }
    return n;
  });
  return { isCollapsed: (id: string) => set.has(id), toggle };
}

/** Pfeil rechts im Kategorie-Kopf zum Ein- und Ausklappen. */
export function CollapseBtn({ name, collapsed, onClick }: { name: string; collapsed: boolean; onClick: () => void }) {
  return (
    <button className="gtog" aria-expanded={!collapsed} aria-label={`${name} ${collapsed ? 'aufklappen' : 'zuklappen'}`}
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <Icon name="right" size={16} w={2.4} />
    </button>
  );
}

/** Farbabstufungen für das Kreisdiagramm (gleicher Farbton, gut unterscheidbar); [Füllung, Symbolfarbe]. */
export const PIE_SHADES: Record<'alltag' | 'fix' | 'hh', [string, string][]> = {
  alltag: [['#3E66C9', '#FFFFFF'], ['#6EA2FF', '#0E0F12'], ['#2A4790', '#FFFFFF'], ['#A9CBFF', '#0E0F12'], ['#5478DA', '#FFFFFF'], ['#D2E1FF', '#0E0F12'], ['#1F3570', '#FFFFFF'], ['#8FB0FF', '#0E0F12']],
  fix: [['#E8832A', '#FFFFFF'], ['#F7B26A', '#0E0F12'], ['#B5581A', '#FFFFFF'], ['#FAD3A6', '#0E0F12'], ['#D06A1F', '#FFFFFF'], ['#FFC48A', '#0E0F12'], ['#8F4A17', '#FFFFFF'], ['#F09A50', '#0E0F12']],
  hh: [['#2A86B5', '#FFFFFF'], ['#5EC8F2', '#0E0F12'], ['#1D6489', '#FFFFFF'], ['#A6E1F8', '#0E0F12'], ['#3FA3D2', '#FFFFFF'], ['#CFEFFC', '#0E0F12'], ['#164C68', '#FFFFFF'], ['#82D4F5', '#0E0F12']]
};

const PIE = { W: 400, H: 320, CX: 200, CY: 160, RI: 62, RO: 102, MIN: 0.075 };

/** Ringstück als Pfad (Winkel in Bruchteilen 0..1, 0 = oben, im Uhrzeigersinn). */
function arcPath(a0: number, a1: number, ri: number, ro: number): string {
  const { CX, CY } = PIE;
  const pt = (f: number, r: number) => { const t = f * 2 * Math.PI - Math.PI / 2; return `${(CX + r * Math.cos(t)).toFixed(2)} ${(CY + r * Math.sin(t)).toFixed(2)}`; };
  if (a1 - a0 >= 0.9999) return `M${pt(0, ro)}A${ro} ${ro} 0 1 1 ${pt(0.5, ro)}A${ro} ${ro} 0 1 1 ${pt(0, ro)}M${pt(0, ri)}A${ri} ${ri} 0 1 0 ${pt(0.5, ri)}A${ri} ${ri} 0 1 0 ${pt(0, ri)}Z`;
  const large = a1 - a0 > 0.5 ? 1 : 0;
  return `M${pt(a0, ro)}A${ro} ${ro} 0 ${large} 1 ${pt(a1, ro)}L${pt(a1, ri)}A${ri} ${ri} 0 ${large} 0 ${pt(a0, ri)}Z`;
}
const polar = (f: number, r: number) => { const t = f * 2 * Math.PI - Math.PI / 2; return { x: PIE.CX + r * Math.cos(t), y: PIE.CY + r * Math.sin(t) }; };

type Lab = { id: string; mid: number; amount: string; line2: string; r: number; tx: number; ty: number; anchor: 'start' | 'middle' | 'end'; line: string; box: [number, number, number, number] };

function mkLab(id: string, mid: number, amount: string, line2: string): Lab {
  return { id, mid, amount, line2, r: 0, tx: 0, ty: 0, anchor: 'start', line: '', box: [0, 0, 0, 0] };
}

/** Lage einer Beschriftung für den Abstand r (Strichende) berechnen. Textblock: Betrag (14 px) + Zeile darunter (11,5 px). */
function placeLab(l: Lab, r: number): void {
  const t = l.mid * 2 * Math.PI - Math.PI / 2, dx = Math.cos(t), dy = Math.sin(t);
  const a = polar(l.mid, PIE.RO + 4);
  const w = Math.max(l.amount.length * 8.4, l.line2.length * 6.3), h = 30;
  const side = Math.abs(dy) <= 0.38; // um 3 bzw. 9 Uhr
  l.r = r;
  if (side) {
    // kurzer Strich nach außen, Wert mittig darunter → braucht wenig Breite
    const e = { x: PIE.CX + dx * (r + 14), y: PIE.CY + dy * (r + 14) };
    l.anchor = 'middle'; l.tx = e.x + Math.sign(dx) * (w / 2 - 14); l.ty = e.y + 17;
    l.line = `${a.x.toFixed(1)},${a.y.toFixed(1)} ${e.x.toFixed(1)},${e.y.toFixed(1)} ${(e.x + Math.sign(dx) * 18).toFixed(1)},${e.y.toFixed(1)}`;
    l.box = [l.tx - w / 2, e.y + 3, w, h];
  } else {
    const e = polar(l.mid, r);
    l.anchor = dx > 0.25 ? 'start' : dx < -0.25 ? 'end' : 'middle';
    l.tx = e.x + (l.anchor === 'start' ? 3 : l.anchor === 'end' ? -3 : 0);
    l.ty = dy < 0 ? e.y - 18 : e.y + 15;
    l.line = `${a.x.toFixed(1)},${a.y.toFixed(1)} ${e.x.toFixed(1)},${e.y.toFixed(1)}`;
    const x0 = l.anchor === 'start' ? l.tx : l.anchor === 'end' ? l.tx - w : l.tx - w / 2;
    l.box = [x0, l.ty - 12, w, h];
  }
}
const boxHit = (p: Lab['box'], q: Lab['box']) => p[0] < q[0] + q[2] + 4 && q[0] < p[0] + p[2] + 4 && p[1] < q[1] + q[3] + 2 && q[1] < p[1] + p[3] + 2;
/** Abstand der Box zum Kreismittelpunkt (nächster Punkt). */
const boxDist = (b: Lab['box']) => Math.hypot(Math.max(b[0] - PIE.CX, 0, PIE.CX - b[0] - b[2]), Math.max(b[1] - PIE.CY, 0, PIE.CY - b[1] - b[3]));

/** Beschriftungen nah am Kreis platzieren; bei Überlappung mit dem Kreis oder einer anderen Beschriftung weiter nach außen. */
function layoutLabels(labs: Lab[]): void {
  const done: Lab[] = [];
  for (const l of [...labs].sort((a, b) => a.mid - b.mid)) {
    let r = PIE.RO + 18;
    placeLab(l, r);
    for (let i = 0; i < 12 && (boxDist(l.box) < PIE.RO + 14 || done.some((d) => boxHit(d.box, l.box))); i++) placeLab(l, (r += 8));
    // im sichtbaren Bereich halten
    const dxs = Math.max(0, 2 - l.box[0]) - Math.max(0, l.box[0] + l.box[2] - PIE.W + 2);
    const dys = Math.max(0, 2 - l.box[1]) - Math.max(0, l.box[1] + l.box[3] - PIE.H + 2);
    l.tx += dxs; l.ty += dys; l.box = [l.box[0] + dxs, l.box[1] + dys, l.box[2], l.box[3]];
    done.push(l);
  }
}

/** Text in der Kreismitte, so klein gesetzt, dass er sauber Abstand zum Ring hält. */
function CenterText({ label, amount, pct }: { label: string; amount: string; pct: string | null }) {
  const inner = PIE.RI - 12; // Innenradius minus Abstand
  const chord = (y: number) => 2 * Math.sqrt(Math.max(0, inner * inner - y * y));
  const yL = pct ? -20 : -11, yA = pct ? 5 : 13, yP = 25;
  const fsA = Math.min(21, chord(yA + 6) / (amount.length * 0.6));
  // Bezeichnung: erst kleiner setzen (bis 9,5 px), erst danach kürzen
  const fsL = Math.max(9.5, Math.min(12, chord(yL - 4) / (label.length * 0.56)));
  const maxL = Math.floor(chord(yL - 4) / (fsL * 0.56));
  const lab = label.length > maxL ? label.slice(0, Math.max(1, maxL - 1)) + '…' : label;
  return (
    <g className="piecenter" pointerEvents="none">
      <text x={PIE.CX} y={PIE.CY + yL} textAnchor="middle" className="piecl" style={{ fontSize: `${fsL.toFixed(1)}px` }}>{lab}</text>
      <text x={PIE.CX} y={PIE.CY + yA} textAnchor="middle" className="pieca" style={{ fontSize: `${fsA.toFixed(1)}px` }}>{amount}</text>
      {pct && <text x={PIE.CX} y={PIE.CY + yP} textAnchor="middle" className="piecl">{pct}</text>}
    </g>
  );
}

interface PieSlice extends CatSeg { a0: number; a1: number; frac: number; fill: string; fg: string; big: boolean }

/**
 * Detailansicht zum Kategorie-Balken: Kreisdiagramm mit Beträgen an feinen Linien neben den Stücken.
 * Kleine Stücke (ohne Symbol) teilen sich einen Summenbetrag. Tipp auf ein Stück holt es nach vorne und zeigt
 * darunter die Details dieser Kategorie (renderDetail); erneuter Tipp oder Tipp in die Mitte hebt die Auswahl auf.
 */
export function CatDetailSheet({ title, segs, shades, sub, onClose, renderDetail }: {
  title: string; segs: CatSeg[]; shades: [string, string][]; sub?: string; onClose: () => void; renderDetail: (id: string, cents: number) => ReactNode;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const shown = segs.filter((s) => s.cents > 0).sort((a, b) => b.cents - a.cents);
  const total = shown.reduce((a, s) => a + s.cents, 0);
  const pct = (c: number) => (total > 0 ? Math.round((c / total) * 100) : 0);
  let acc = 0;
  const slices: PieSlice[] = shown.map((s, i) => {
    const frac = s.cents / total; const a0 = acc; acc += frac;
    const [fill, fg] = shades[i % shades.length] as [string, string];
    return { ...s, a0, a1: acc, frac, fill, fg, big: frac >= PIE.MIN || shown.length === 1 };
  });
  const small = slices.filter((s) => !s.big);
  const REST = '__rest__';
  // Beschriftungen: große Stücke einzeln, kleine gemeinsam (sie liegen nebeneinander, da nach Größe sortiert).
  // Platzsparend: oben/unten über bzw. unter dem Strich, seitlich (3/9 Uhr) mittig unter dem Strichende.
  const labs: Lab[] = slices.filter((s) => s.big).map((s) => mkLab(s.id, (s.a0 + s.a1) / 2, formatEUR(s.cents), `${pct(s.cents)} %`));
  if (small.length > 0) {
    const c = small.reduce((a, s) => a + s.cents, 0);
    labs.push(mkLab(REST, (small[0]!.a0 + small[small.length - 1]!.a1) / 2, formatEUR(c), small.length === 1 ? `${pct(c)} %` : `${small.length} weitere · ${pct(c)} %`));
  }
  layoutLabels(labs);
  const selSlice = slices.find((s) => s.id === sel);
  const restSel = sel === REST;
  const isOn = (s: PieSlice) => !sel || s.id === sel || (restSel && !s.big);
  const toggle = (id: string) => setSel((o) => (o === id ? null : id));
  const centerLabel = selSlice ? selSlice.name : restSel ? `${small.length} weitere` : (sub ?? 'Summe');
  const centerCents = selSlice ? selSlice.cents : restSel ? small.reduce((a, s) => a + s.cents, 0) : total;
  return (
    <Sheet title={title} onClose={onClose} left="Schließen">
      {total === 0 ? <div className="card"><Empty>In diesem Zeitraum gibt es noch keine Ausgaben.</Empty></div> : (
        <>
          <div className="piewrap">
            <svg viewBox={`0 0 ${PIE.W} ${PIE.H}`} role="group" aria-label={`${title}: ${shown.map((s) => `${s.name} ${formatEUR(s.cents)} (${pct(s.cents)} %)`).join(', ')}`}>
              {slices.map((s) => {
                const active = s.id === sel || (restSel && !s.big);
                const m = polar((s.a0 + s.a1) / 2, 10);
                const ic = polar((s.a0 + s.a1) / 2, (PIE.RI + PIE.RO) / 2);
                return (
                  <g key={s.id} className={'pieslice' + (active ? ' on' : '') + (isOn(s) ? '' : ' dim')} role="button" tabIndex={0}
                    aria-label={`${s.name}: ${formatEUR(s.cents)}, ${pct(s.cents)} %`} aria-pressed={active}
                    style={{ transform: active ? `translate(${(m.x - PIE.CX).toFixed(1)}px, ${(m.y - PIE.CY).toFixed(1)}px) scale(1.08)` : undefined }}
                    onClick={() => toggle(s.big ? s.id : sel === REST ? s.id : REST)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(s.big ? s.id : REST); } }}>
                    <path d={arcPath(s.a0, s.a1, PIE.RI, PIE.RO)} fill={s.fill} stroke="var(--bg)" strokeWidth={slices.length > 1 ? 1.5 : 0} />
                    {s.big && <g transform={`translate(${(ic.x - 11).toFixed(1)} ${(ic.y - 11).toFixed(1)})`} style={{ color: s.fg }}><Icon name={s.icon} size={22} w={2} /></g>}
                  </g>
                );
              })}
              {labs.map((l) => {
                const dim = sel && sel !== l.id && !(l.id !== REST && selSlice?.id === l.id);
                return (
                  <g key={l.id} className={'pielab' + (dim ? ' dim' : '')} onClick={() => toggle(l.id)} aria-hidden="true">
                    <polyline points={l.line} fill="none" stroke="var(--faint)" strokeWidth="1" />
                    <text x={l.tx} y={l.ty} textAnchor={l.anchor} className="pieamt">{l.amount}</text>
                    <text x={l.tx} y={l.ty + 14} textAnchor={l.anchor} className="piesub">{l.line2}</text>
                  </g>
                );
              })}
              <circle cx={PIE.CX} cy={PIE.CY} r={PIE.RI - 2} fill="transparent" onClick={() => setSel(null)} />
              <CenterText label={centerLabel} amount={formatEUR(centerCents)} pct={selSlice || restSel ? `${pct(centerCents)} %` : null} />
            </svg>
          </div>
          {!sel && <p className="note" style={{ textAlign: 'center' }}>Tippe auf ein Stück für Details.</p>}
          {selSlice && (
            <div className="card flush piedetail">
              <div className="pierow head">
                <span className="piedot" style={{ background: selSlice.fill, color: selSlice.fg }}><Icon name={selSlice.icon} size={18} w={2} /></span>
                <span className="piename">{selSlice.name}</span><b className="num">{formatEUR(selSlice.cents)}</b>
              </div>
              {renderDetail(selSlice.id, selSlice.cents)}
            </div>
          )}
          {restSel && (
            <div className="card flush piedetail">
              {small.map((s) => (
                <button className="pierow clickrow" key={s.id} onClick={() => setSel(s.id)}>
                  <span className="piedot" style={{ background: s.fill, color: s.fg }}><Icon name={s.icon} size={18} w={2} /></span>
                  <span className="piename">{s.name}</span><b className="num">{formatEUR(s.cents)}</b><Chevr />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

/** Eine Zeile in den Details einer Kategorie: Name, Anteil, Betrag; optional aufklappbar. */
export function DetailRow({ name, cents, approx, children }: { name: string; cents: number; approx?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const can = !!children;
  return (
    <>
      <button className="detrow" disabled={!can} aria-expanded={can ? open : undefined} onClick={() => setOpen(!open)}>
        <span className="dettog">{can && <Chevron open={open} />}</span>
        <span className="detname">{name}</span><span className="num">{approx ? '≈ ' : ''}{formatEUR(cents)}</span>
      </button>
      {can && open && <div className="drill">{children}</div>}
    </>
  );
}
