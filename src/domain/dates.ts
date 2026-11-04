// Alle Funktionen arbeiten mit lokalen Kalenderwerten als Text. Es gibt bewusst keine Umrechnung über
// UTC (toISOString), damit eine Buchung kurz vor Mitternacht nicht auf dem falschen Tag landet.

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const todayISO = (): string => toISODate(new Date());
export const monthKeyOf = (iso: string): string => iso.slice(0, 7);
export const currentMonthKey = (): string => monthKeyOf(todayISO());

export function isValidISODate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(`${s.slice(0, 7)}`);
}
export function isValidMonthKey(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s) && Number(s.slice(0, 4)) >= 1900;
}

export function daysInMonth(key: string): number {
  const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7));
  return new Date(y, m, 0).getDate(); // Tag 0 des Folgemonats = letzter Tag; berücksichtigt Schaltjahre
}

export function shiftMonth(key: string, delta: number): string {
  const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7));
  const idx = y * 12 + (m - 1) + delta;
  return `${String(Math.floor(idx / 12)).padStart(4, '0')}-${pad((idx % 12) + 1)}`;
}

export function monthRange(key: string): { from: string; to: string } {
  return { from: `${key}-01`, to: `${key}-${pad(daysInMonth(key))}` };
}
export function yearRange(year: string): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function monthLabel(key: string): string {
  const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7));
  return new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}
export function monthShort(key: string): string {
  const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7));
  return new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'short' }).replace('.', '');
}
export function dayLabel(iso: string, today = todayISO()): string {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
  const label = new Date(y, m - 1, d).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
  const t = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  const yest = new Date(t); yest.setDate(yest.getDate() - 1);
  if (iso === today) return `Heute · ${label}`;
  if (iso === toISODate(yest)) return `Gestern · ${label}`;
  return label;
}
export function formatDateDE(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}
/** Verbleibende Tage inkl. heute im angegebenen Monat; 0 bei vergangenen, volle Länge bei künftigen Monaten. */
export function daysLeftInMonth(key: string, today = todayISO()): number {
  const cur = monthKeyOf(today);
  if (key < cur) return 0;
  if (key > cur) return daysInMonth(key);
  return daysInMonth(key) - Number(today.slice(8, 10)) + 1;
}
