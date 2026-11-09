import { formatAmountTyping, formatEUR } from '../domain/money';

export function Money({ cents, signed }: { cents: number; signed?: boolean }) {
  const cls = cents < 0 ? 'neg' : signed && cents > 0 ? 'pos' : '';
  return <span className={'num ' + cls}>{signed && cents > 0 ? '+' : ''}{formatEUR(cents)}</span>;
}

/**
 * Ring der Übersicht: Anteile (z. B. Fix/Alltag/Sparen) am Ganzen (Einnahmen) als ein Bogen ab 12 Uhr.
 * Gerade Übergänge zwischen den Abschnitten, abgerundet nur an Anfang und Ende. Wechselt weich (ANIM_MS).
 */

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

/** Betrag einer Buchung in Listen: Ausgaben ohne Vorzeichen, Einnahmen mit „+“. Minus nur für negative Salden. */
export function TxAmount({ t }: { t: { type: 'income' | 'expense'; amountCents: number } }) {
  return <span className={'amt' + (t.type === 'income' ? ' inc' : '')}>{t.type === 'income' ? '+' : ''}{formatEUR(t.amountCents)}</span>;
}
