import { useMemo, useState } from 'react';
import { amountOf, parseDate } from '../../domain/statement';
import type { ColumnMap, Layout } from '../../domain/statement';
import { Icon } from '../../ui/icons';
import { Header } from '../../ui/Header';
import { formatDateDE } from '../../domain/dates';
import { formatEUR } from '../../domain/money';

type Field = keyof ColumnMap;
const MAIN: [Field, string, boolean][] = [['booking', 'Datum', true], ['amount', 'Betrag', true], ['payee', 'Empfänger / Händler', false], ['zweck', 'Verwendungszweck', false]];
const MORE: [Field, string][] = [['card', 'Kaufdatum / Valuta'], ['debit', 'Ausgaben (Soll) – eigene Spalte'], ['credit', 'Einnahmen (Haben) – eigene Spalte'], ['sign', 'Kennzeichen Soll/Haben (S/H)'], ['payer', 'Name des Zahlenden (bei Eingängen)']];

/**
 * „Spalten zuordnen“: für Dateien, deren Aufbau die App nicht sicher erkennt. Pro Angabe eine Auswahl der Spalten
 * (mit Beispielwert), darunter eine Vorschau der ersten Zeilen. Die Zuordnung wird auf Wunsch für diese Bank gemerkt.
 */
export function ColumnMapper({ layout, fileName, err, bank, banks, onApply, onCancel }: {
  layout: Layout; text: string; fileName: string; err: string; bank: string; banks: string[]; onApply: (m: ColumnMap, saveAs: string | null) => void; onCancel: () => void;
}) {
  const [map, setMap] = useState<ColumnMap>(layout.map);
  const [remember, setRemember] = useState(true);
  const [name, setName] = useState(bank || (banks.length ? `Bank ${banks.length + 1}` : 'Meine Bank'));
  const known = banks.some((b) => b.toLowerCase() === name.trim().toLowerCase());
  const [more, setMore] = useState(MORE.some(([k]) => layout.map[k] >= 0));
  const cols = Array.from({ length: layout.columns }, (_, i) => i);
  const sample = (i: number) => layout.samples.map((r) => (r[i] ?? '').trim()).find((v) => v) ?? '';
  const label = (i: number) => {
    const h = layout.header[i]?.trim();
    const v = sample(i);
    return `${h || `Spalte ${i + 1}`}${v ? ` · ${v.length > 28 ? v.slice(0, 27) + '…' : v}` : ''}`;
  };
  const set = (k: Field, v: number) => setMap((m) => {
    const n = { ...m };
    // eine Spalte gehört zu genau einer Angabe
    if (v >= 0) for (const key of Object.keys(n) as Field[]) if (n[key] === v) n[key] = -1;
    n[k] = v;
    return n;
  });
  const preview = useMemo(() => layout.samples.slice(0, 4).map((r) => {
    const d = map.booking >= 0 ? parseDate((r[map.booking] ?? '').trim()) : null;
    const raw = map.amount >= 0 || map.debit >= 0 || map.credit >= 0 ? amountOf(r, map) : null;
    const a = raw ? raw : null;
    const name = (map.payee >= 0 ? r[map.payee] : '') || (map.zweck >= 0 ? r[map.zweck] : '') || '';
    return { d, a, name: name.trim().slice(0, 40) };
  }), [layout.samples, map]);
  const ok = map.booking >= 0 && (map.amount >= 0 || map.debit >= 0 || map.credit >= 0) && preview.some((p) => p.d && p.a !== null);
  const select = (k: Field, title: string, req = false) => (
    <label className="field cmap" key={k}>
      <span>{title}{req ? '' : <i> · optional</i>}</span>
      <select value={map[k]} onChange={(e) => set(k, Number(e.target.value))} aria-label={title}>
        <option value={-1}>– nicht vorhanden –</option>
        {cols.map((i) => <option key={i} value={i}>{label(i)}</option>)}
      </select>
    </label>
  );
  return (
    <>
      <button className="back" onClick={onCancel}><Icon name="left" size={16} w={2.2} />Abbrechen</button>
      <Header kicker={fileName} title="Spalten zuordnen" />
      <p className="note">Diesen Aufbau kennt die App noch nicht. Sag einmal, wo was steht – Datum und Betrag reichen. Die Vorschau zeigt sofort, ob es passt. Als Bankvorlage gespeichert, wählst du sie beim nächsten Import einfach aus.</p>
      <div className="card cmapcard">
        {MAIN.map(([k, t, req]) => select(k, t, req))}
        <button className="linkbtn" onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Weniger Spalten' : 'Weitere Spalten (Soll/Haben getrennt, Kaufdatum)'}</button>
        {more && MORE.map(([k, t]) => select(k, t))}
      </div>
      <div className="card flush">
        <div className="sec"><h2>Vorschau</h2></div>
        {preview.map((p, i) => (
          <div className="kv" key={i}>
            <span>{p.d ? formatDateDE(p.d) : <i className="neg">kein Datum</i>} · {p.name || '–'}</span>
            <b className={p.a === null ? 'neg' : p.a < 0 ? '' : 'pos'}>{p.a === null ? 'kein Betrag' : `${p.a > 0 ? '+' : ''}${formatEUR(p.a)}`}</b>
          </div>
        ))}
      </div>
      <div className="card cmapcard">
        <label className="field cmapcheck"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span>Als Bankvorlage speichern</span></label>
        {remember && (
          <label className="field cmap">
            <span>Name der Bank</span>
            <input value={name} maxLength={40} placeholder="z. B. Sparkasse" aria-label="Name der Bank" onChange={(e) => setName(e.target.value)} />
            {known && <i className="cmaphint">Die Vorlage „{name.trim()}“ wird aktualisiert.</i>}
          </label>
        )}
      </div>
      {err && <div className="err-text" role="alert">{err}</div>}
      <button className="btn" disabled={!ok || (remember && !name.trim())} onClick={() => onApply(map, remember ? name.trim() : null)}>Weiter</button>
    </>
  );
}
