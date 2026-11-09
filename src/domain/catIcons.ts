/** Auswählbare Kategorie-Symbole (Schlüssel = Name in icons.tsx). Reihenfolge = Reihenfolge in der Auswahl. */
export const CAT_ICONS: { key: string; label: string }[] = [
  // Essen & Einkaufen
  { key: 'Lebensmittel', label: 'Korb' }, { key: 'cart', label: 'Einkauf' }, { key: 'bag', label: 'Tasche' },
  { key: 'fork', label: 'Essen gehen' }, { key: 'coffee', label: 'Kaffee' }, { key: 'bread', label: 'Bäcker' }, { key: 'drink', label: 'Getränke' },
  // Mobilität
  { key: 'Auto', label: 'Auto' }, { key: 'fuel', label: 'Tanken' }, { key: 'bus', label: 'Bus' }, { key: 'train', label: 'Zug' },
  { key: 'bike', label: 'Fahrrad' }, { key: 'Motorrad', label: 'Motorrad' }, { key: 'plane', label: 'Flugzeug' }, { key: 'parking', label: 'Parken' }, { key: 'wrench', label: 'Werkstatt' },
  // Wohnen
  { key: 'Wohnen', label: 'Wohnen' }, { key: 'bolt', label: 'Strom' }, { key: 'flame', label: 'Heizung' }, { key: 'drop', label: 'Wasser' },
  { key: 'wifi', label: 'Internet' }, { key: 'phone', label: 'Handy' }, { key: 'tv', label: 'Fernsehen' }, { key: 'sparkle', label: 'Putzen' }, { key: 'plant', label: 'Garten' },
  // Freizeit
  { key: 'Freizeit', label: 'Freizeit' }, { key: 'music', label: 'Musik' }, { key: 'game', label: 'Spiele' }, { key: 'ticket', label: 'Tickets' },
  { key: 'Sport', label: 'Sport' }, { key: 'suitcase', label: 'Urlaub' }, { key: 'book', label: 'Bücher' }, { key: 'school', label: 'Bildung' }, { key: 'laptop', label: 'Technik' },
  // Persönlich
  { key: 'Gesundheit', label: 'Gesundheit' }, { key: 'pill', label: 'Apotheke' }, { key: 'scissors', label: 'Friseur' }, { key: 'Bekleidung', label: 'Kleidung' },
  { key: 'gift', label: 'Geschenke' }, { key: 'paw', label: 'Haustier' }, { key: 'baby', label: 'Kind' }, { key: 'Gemeinsames Konto', label: 'Gemeinsam' },
  // Geld & Verträge
  { key: 'Versicherungen', label: 'Versicherung' }, { key: 'Bargeld', label: 'Bargeld' }, { key: 'bank', label: 'Bank' }, { key: 'percent', label: 'Kredit' },
  { key: 'piggy', label: 'Sparschwein' }, { key: 'Sparen', label: 'Anlage' }, { key: 'repeat', label: 'Abo' }, { key: 'doc', label: 'Gebühren' },
  { key: 'tag', label: 'Sonstiges' }, { key: 'dots', label: 'Allgemein' }
];
export const CAT_ICON_KEYS = new Set(CAT_ICONS.map((i) => i.key));
