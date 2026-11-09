import { useState } from 'react';
import type { ReactNode } from 'react';
import type { CatSeg } from './Bar';
import { formatEUR } from '../domain/money';
import { Sheet } from './Sheet';
import { EmptyState } from './Empty';
import { Icon } from './icons';
import { Chevr, Chevron, Collapse } from './Collapse';

/** Farbabstufungen für das Kreisdiagramm (gleicher Farbton, gut unterscheidbar); [Füllung, Symbolfarbe]. */
export const PIE_SHADES: Record<'alltag' | 'fix' | 'hh', [string, string][]> = {
  alltag: [['#0A84FF', '#FFFFFF'], ['#5EB0FF', '#0E0F12'], ['#0062CC', '#FFFFFF'], ['#A8D4FF', '#0E0F12'], ['#3399FF', '#FFFFFF'], ['#D3E9FF', '#0E0F12'], ['#004A99', '#FFFFFF'], ['#7FC1FF', '#0E0F12']],
  fix: [['#F0902E', '#FFFFFF'], ['#F7B26A', '#0E0F12'], ['#B5581A', '#FFFFFF'], ['#FAD3A6', '#0E0F12'], ['#D06A1F', '#FFFFFF'], ['#FFC48A', '#0E0F12'], ['#8F4A17', '#FFFFFF'], ['#F5A04E', '#0E0F12']],
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
      {total === 0 ? <EmptyState title="Noch keine Ausgaben" text="Sobald du etwas buchst, erscheint es hier." /> : (
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
      {can && <Collapse open={open}><div className="drill">{children}</div></Collapse>}
    </>
  );
}
