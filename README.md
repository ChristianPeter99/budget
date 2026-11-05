# Budget – lokale Finanz-PWA für das iPhone

Haushaltsbuch als Progressive Web App. Alle Daten bleiben auf dem Gerät (IndexedDB). Keine Server, kein Tracking, keine externen Schriften oder Skripte.

## Neu in Version 1.32
- Alltag: Sortieren über dem ersten Kategorie-Block – „Eigene Reihenfolge“ (Ziehen wie bisher) oder „Nach Betrag“ (höchste Ausgaben des Monats oben, auch bei den Unterkategorien; Ziehen ist dann aus). Wird je Ansicht (Ich / Haushaltskonto) auf dem Gerät gemerkt

## Neu in Version 1.31
- Erfassen aus Alltag oder Fixkosten heraus (und aus Schnelltasten der Übersicht): keine Bereichs- und keine Ausgabe/Einnahme-Wahl mehr, nur die Kategorien dieses Bereichs
- Sparen ist ein eigener Bereich und steht nicht mehr bei Fixkosten (Mehr › Kategorien: Alltag · Fixkosten · Sparen · Einnahmen; CSV-Import: Alltag · Fixkosten · Sparen)

## Neu in Version 1.30
- Kategorien getrennt nach Bereich: Beim Erfassen wählt man oben Alltag, Fixkosten oder (wenn eingerichtet) das gemeinsame Konto und sieht nur dessen Kategorien; Vorgabe ist der Reiter, aus dem heraus man erfasst
- Mehr › Kategorien: oben Alltag · Fixkosten · Einnahmen (· gemeinsames Konto); neue Kategorien landen im gewählten Bereich
- CSV-Import: Kategorie wählen mit Umschalter Alltag / Fixkosten; Hauptkategorien ohne Unterkategorie (z. B. Wohnen) sind jetzt direkt wählbar
- Neue Buchung in einem anderen Monat: die App springt in diesen Monat, damit man sie samt Aufleuchten sieht
- Zurückwischen vom linken Rand wieder entfernt

## Neu in Version 1.29
- Aktiven Reiter nochmals antippen: eine Ebene zurück (z. B. aus einer Mehr-Unterseite), sonst weich nach oben scrollen
- Kategorien, Unterkategorien und Detailzeilen klappen weich auf und zu
- Druck-Feedback: Kacheln und Knöpfe geben beim Antippen leicht nach, Zeilen hellen kurz auf (iOS zeigt das dank touchstart-Empfänger)
- Buchung gedrückt halten (Buchungen und Alltag): Menü mit Bearbeiten, Duplizieren, Löschen über verschwommenem Hintergrund; Löschen mit Rückgängig
- Neu gespeicherte Buchung gleitet in die Liste und leuchtet kurz

## Neu in Version 1.28.1
- Fix: klebende Tageszeile in Safari stand mitten im Bild statt oben (Abstand oben ist jetzt ein eigenes Element statt Innenabstand)
- Alltag und Fixkosten: Kopf einer aufgeklappten Kategorie bleibt beim Scrollen durch ihre Unterkategorien oben stehen
- Fenster wegziehen funktioniert jetzt auch auf Feldern und Kategorie-Reihen; wer seitlich wischt, sperrt es für diese Geste; nach einem Zug löst kein versehentlicher Tipp aus

## Neu in Version 1.28
- Fenster (Neue Buchung, Filter, Detailansicht …) lassen sich mit dem Finger nach unten wegziehen, mit Griff oben
- Buchungen: Tagesüberschrift bleibt beim Scrollen oben stehen, bis der nächste Tag sie wegschiebt
- Einheitliche Schrift- und Abstandsstufen (Schrift 40 · 28 · 18 · 17 · 15 · 13 · 11, Abstände 4 · 8 · 12 · 16 · 24 · 32)
- Neues App-Symbol: der Ring der Übersicht in Orange, Blau und Grün auf Schwarz (wird nach erneutem „Zum Home-Bildschirm“ übernommen)
- Start ohne graues Aufblitzen; der Ring der Übersicht füllt sich beim Öffnen einmal sanft
- Leere Zustände ruhig auf Schwarz mit leerem Ring, einem Satz und passender Aktion

## Neu in Version 1.27.1
- Farbschema: Alltag einheitlich iOS-Blau (#0A84FF), Fixkosten einheitlich Orange (#F0902E) – Text, Ring, Kacheln, Symbole und Balken in derselben Farbe; nur die Detailkreise nutzen Abstufungen davon

## Neu in Version 1.27
- Bereichsname über dem Monat größer (18 px, fett) – zwischen Monat und „noch N Tage“; Alltag blau, Fixkosten orange
- Untere Leiste nur mit Symbolen und schmaler (54 px); die Namen bleiben für VoiceOver erhalten

## Neu in Version 1.26.1
- „Alltag“ (blau) und „Fixkosten“ (orange) über dem Monat in ihrer Farbe
- Wischen nach dem Herunterscrollen: der Monat der neuen Seite erscheint sofort
- „Mehr“: Titel auf derselben Höhe wie der Monat der anderen Reiter; Datenschutz-Hinweis unten entfernt
- Daten & Backup: kürzere Hinweise; „Datenschutz“ nur noch mit dem Hinweistext

## Neu in Version 1.26
- Blättern: Die Kopfzeile (Monat, Pfeile) bleibt beim Wischen stehen; nur was sich ändert („Übersicht“ → „Alltag“, „noch N Tage“, Stift, Titel bei „Mehr“) wird weich aus- und eingeblendet

## Neu in Version 1.25.4
- „Gehalt (erwartet)“ nur noch ab dem „Gilt ab“ des Gehalts; in Monaten davor zählen nur tatsächlich gebuchte Einnahmen
- Sparen & Depot: Zeile „Gilt ab“ bei der Sparrate (Tipp öffnet die Vorlage)

## Neu in Version 1.25.3
- „Gilt ab“ und Datumsfelder stehen rechtsbündig wie alle anderen Werte
- Gehalt: „Gilt ab“ über „Eingang am“ mit derselben Logik wie bei Fixkosten (fehlende Monate werden nachgebucht, schon gebuchte zugeordnet)
- „Eingang am“ / „Tag im Monat“: Eingabe als Zahl, Anzeige als „1. des Monats“

## Neu in Version 1.25.2
- „Gilt ab“ wieder als Monatsfeld des iPhones (in Gerätesprache); Hinweistext darunter entfernt

## Neu in Version 1.25
- Wiederkehrende Buchungen (z. B. Fixkosten): neues Feld „Gilt ab“ (Monat/Jahr). Ab diesem Monat wird jeden Monat gebucht – auch rückwirkend. Ist die Ausgabe in einem Monat schon gebucht (gleiche Kategorie und gleicher Betrag, z. B. per CSV importiert), wird sie zugeordnet statt doppelt gebucht
- Vorlage löschen: bisherige Buchungen bleiben, es wird nur nichts mehr neu gebucht
- Fixkosten-Tab zeigt wieder die Vorlagen des Monats (die Anzeige importierter Fixkosten aus 1.24.1 entfällt); vor dem Beginn steht ein Hinweis auf „Gilt ab“
- „Einstellungen“ entfällt: Backup-Erinnerung, Speicher & Datenschutz, Zurücksetzen und App-Version liegen jetzt unter „Daten & Backup“

## Neu in Version 1.24
- Alltag und Fixkosten: Kopf wie auf der Übersicht – Monat und Jahr groß, darüber dezent „Alltag · noch N Tage“ (im Haushaltskonto dessen Name) bzw. „Fixkosten“
- Kontoname entfällt (auch in den Einstellungen); vorhandene Namen bleiben im Backup erhalten, werden aber nicht mehr angezeigt

## Neu in Version 1.23.2
- Einstellungen: Zeile zum Speicherschutz samt Erklärung entfernt; Gehalt: kurzer Hinweis; Depot: gleicher Hinweis wie beim Sparkonto

## Neu in Version 1.23.1
- Kürzere Hinweise bei Sparen und beim Kontonamen; Bargeld-Hinweis entfernt; untere Leiste noch durchsichtiger

## Neu in Version 1.23
- Sparen & Depot: „Kontostand laut Bank (€)“ in einer Zeile; je Konto nur noch der letzte Eintrag, Tipp darauf zeigt alle Einträge (mit Veränderung und Löschen)
- Auswertung: Verlauf jetzt auch für das Sparkonto (wie beim Depot)
- Einstellungen: Kontoname getrennt für Alltagskonto und Fixkostenkonto (leer = wie Alltagskonto); Backup-Erinnerung Aus/7/14/30 Tage ohne Kasten; „Vor automatischem Löschen geschützt“ mit Erklärung; Budget-Aufteilung und der Gehalts-Hinweis entfallen
- Mehr: „Kategorien“ als eigener Punkt vor „Gehalt & Wiederkehrend“

## Neu in Version 1.22.3
- Alltag und Fixkosten: „Ausgaben“, Betrag und Balken stehen exakt auf derselben Höhe (6 px Wort → Betrag, 12 px Betrag → Balken)
- Beim Monatswechsel gleiten die Balken-Abschnitte zu ihren neuen Breiten und die Beträge zählen mit – wie der Ring auf der Übersicht

## Neu in Version 1.22.2
- Übersicht: mehr Abstand zwischen Monatsüberschrift und Ring mit „Noch verfügbar“

## Neu in Version 1.22.1
- Übersicht: Ausgaben-Kacheln wieder als Kacheln, leicht in ihrer Farbe getönt (Fixkosten orange, Alltag blau, Sparen grün)
- Untere Leiste durchsichtiger, der Inhalt dahinter stärker verschwommen
- Zahlenfeld: Tasten etwas höher (50 px)
- Abschnitts-Überschriften (z. B. „Speicher & Datenschutz“, „Daten“) stehen direkt auf Schwarz, der Inhalt darunter in der Karte

## Neu in Version 1.22: Schwarz & clean
- Hintergrund ganz schwarz, Karten nur noch ganz leicht abgesetzt
- Pfeile, Stift, Filter ohne grauen Kreis; „Neue Buchung“, „Auswählen“, „Neu“ als reine Textknöpfe
- Übersicht: Ausgaben-Kacheln ohne Kasten mit feinen Trennlinien; „Schnell erfassen“ nur Symbol und Text; Haushaltskonto zwischen Linien
- Pfeile vor Unterkategorien ohne Kästchen; alle Umschalter der App als einzelne Kapseln wie im Filter
- Fenster leicht vom Schwarz abgesetzt; Zahlenfeld und Leisten angepasst

## Neu in Version 1.21
- Neue Buchung (und Fixkosten-Fenster): Ausgabe/Einnahme und „Bezahlt von“ als einzelne, dezente Kapseln wie im Filter
- Alle Knöpfe mit kreisrunden Enden (Kapselform); „Speichern“ und „… Buchungen anzeigen“ kompakter und mittig

## Neu in Version 1.20.2
- Buchungen: unter der Suche nur noch die Anzahl („87 Buchungen“), keine Summen
- Wischen zum Löschen entfällt (Buchungen und Alltag); seitliches Wischen über einer Buchung blättert jetzt zuverlässig zum nächsten Reiter. Löschen: Buchung antippen → „Buchung löschen“ (mit Rückgängig) oder mehrere über „Auswählen“

## Neu in Version 1.20.1
- Filter: „Gesamt“ entfällt (Monat, Jahr, Von–bis bleiben); Knöpfe als einzelne, dezente Kapseln mit Abstand statt eines Blocks
- Kategorie: Suchfeld (findet auch Unterkategorien, z. B. „bäck“ → Lebensmittel) und eine Reihe zum seitlichen Scrollen

## Neu in Version 1.20: Buchungen aufgeräumt, schwebende Tab-Leiste
- Untere Leiste schwebt mit Abstand zu Rand und Unterkante, stark abgerundet und leicht durchsichtig (Inhalt scheint verschwommen durch)
- Der aktive Reiter liegt auf einer hellen Kapsel, die beim Antippen federnd zum neuen Reiter gleitet und beim Wischen mit dem Finger mitwandert
- Symbole ohne farbigen Kasten, wie in Alltag und Fixkosten
- Oben eine Zeile: „Neue Buchung“, „Auswählen“ und ein Filter-Symbol
- Filter-Fenster: Zeitraum (Monat, Jahr, Gesamt, Von–bis mit Datum), Art (Alle, Ausgaben, Einnahmen), Kategorie; „Zurücksetzen“ oben rechts
- Aktiver Filter: Punkt am Filter-Symbol und eine Zeile unter der Suche, Tipp darauf setzt zurück; im Jahr wechseln die Pfeile das Jahr

## Neu in Version 1.19.3
- iPhone (Home-Bildschirm-App, Hochformat): Inhalt und Fenster beginnen 14 px tiefer, damit die erste Zeile nicht mehr in der Unschärfe unter der Statusleiste liegt. Die Unschärfe selbst zeichnet iOS 26 (feste Höhe, nicht einstellbar); beim Scrollen bleibt sie erhalten

## Neu in Version 1.19.2
- Blättern flüssiger: Bewegung wird direkt pro Bildschirmbild gezeichnet (kein Neuaufbau der Seite pro Fingerbewegung); während des seitlichen Ziehens scrollt die Seite nicht mehr zusätzlich senkrecht
- Untere Leiste schaltet sofort um: schon beim Ziehen über die Hälfte und spätestens beim Loslassen, nicht erst nach der Animation

## Neu in Version 1.19.1
- Blättern wie auf dem iPhone-Home-Bildschirm: die Seite folgt dem Finger, die Nachbarseite schiebt sich daneben herein; loslassen nach gut einem Drittel oder mit Schwung blättert um, sonst federt die Seite zurück. Am ersten und letzten Reiter gibt sie nur leicht nach

## Neu in Version 1.19: Wischen zum Blättern
- Wischen nach links/rechts wechselt jetzt die Reiter (Übersicht → Alltag → Buchungen → Fixkosten → Mehr), mit kurzer Schiebe-Animation
- Den Monat wechselst du per Wischen nur noch oben im Kopf mit dem Monatsnamen (Übersicht, Alltag, Fixkosten) oder mit den Pfeilen
- Ausnahmen: Wischen auf einer Buchung (Löschen), in Eingabefeldern und in geöffneten Fenstern; Gedrückthalten zum Sortieren bleibt unverändert
- Fixkosten: Stift und Monatspfeile oben rechts wie im Alltag; angezeigt werden die Fixkosten, die im gewählten Monat laufen. „+ Neu“ ist jetzt „Fixkosten hinzufügen“ unter der Liste
- Hinweis unter dem Balken: „Balken antippen für Details · Kategorien halten zum Sortieren“

## Neu in Version 1.18.3
- Übersicht-Ring: gerade Kanten überall (auch an Anfang und Ende), feine dunkle Fugen zwischen Fixkosten, Alltag und Sparen

## Neu in Version 1.18.2
- Alltag und Fixkosten: Überschrift „Ausgaben“ statt „Ausgegeben“/„Summe pro Monat“ (auch in der Detailansicht)
- Dezenter Hinweis unter dem Balken: „Balken antippen für Details · Halten zum Sortieren“ (ersetzt den Sortier-Hinweis unten)
- Alltag: kein roter Rand mehr am Balken bei Überschreitung – „Noch verfügbar“ wird rot
- Übersicht: Ring nach innen dicker (gleiche Außengröße)

## Neu in Version 1.18.1
- Kreisdiagramm: Text in der Mitte passt sich der Länge an und hält sauberen Abstand zum Ring
- Beträge platzsparend: oben/unten über bzw. unter dem Strich, bei 3/9 Uhr kurzer Strich mit dem Wert darunter; Beschriftungen weichen einander und dem Kreis aus
- Prozentangaben nur noch am Diagramm und in der Mitte, nicht mehr in der Kategorie-Zeile und bei den Unterkategorien

## Neu in Version 1.18: Kreisdiagramm zum Antippen
- Detailansicht: Beträge mit Anteil stehen außen neben den Stücken, verbunden mit einer feinen Linie; kleine Stücke ohne Symbol teilen sich einen Summenbetrag („N weitere“)
- Tipp auf ein Stück holt es nach vorne (vergrößert), die übrigen werden blass; in der Mitte stehen Name, Betrag und Anteil
- Darunter erscheint nur diese Kategorie: Alltag mit ihren Unterkategorien (Anteil, Betrag), aufklappbar bis zu den einzelnen Buchungen; Fixkosten mit ihren Positionen
- Tipp auf die zusammengefassten kleinen Stücke listet diese Kategorien; erneuter Tipp oder Tipp in die Mitte hebt die Auswahl auf
- Ohne Auswahl steht unter dem Diagramm keine Liste mehr

## Neu in Version 1.17: Symbole wählen, Detailansicht
- Kategorien bearbeiten (Stift in Alltag/Fixkosten): Symbol links wie in der normalen Ansicht; Tipp darauf öffnet eine Auswahl mit rund 55 Symbolen im selben Stil (z. B. Bus, Zug, Fahrrad, Tanken, Strom, Internet, Haustier, Urlaub …); „Standard-Symbol verwenden“ setzt zurück
- Das gewählte Symbol erscheint überall: Kategorie-Kopf, Balken, Buchungen, Schnell erfassen; es wird im Backup mitgesichert
- Tipp auf den Balken in Alltag oder Fixkosten öffnet eine Detailansicht: großes Kreisdiagramm mit Symbolen, darunter jede Kategorie mit Symbol, Anteil und Betrag (größte zuerst)

## Neu in Version 1.16.1
- Balken: Abschnitte nach Betrag sortiert – größte Ausgabe links, unabhängig von der Reihenfolge der Kategorien darunter
- „Noch verfügbar“ ist jetzt überall dieselbe Zahl (Übersicht, Alltag, Erfassen): Einnahmen des Monats − alle Ausgaben des Monats. Ohne gebuchte Einnahme zählt das hinterlegte Gehalt („Gehalt (erwartet)“)
- Alltag-Budget (100 % des Balkens) = Einnahmen − Fixkosten − Sparen − sonstige Ausgaben; die prozentuale Budget-Aufteilung bestimmt es nicht mehr

## Neu in Version 1.16: Kategorie-Balken, einklappbare Kategorien
- Alltag: hoher Balken mit einem dunkelblauen Abschnitt je Kategorie und weißem Symbol darin; 100 % = Alltag-Budget (Einnahmen − Fixkosten − Sparen), der dunkle Rest ist noch verfügbar; bei Überschreitung roter Rand. Im Haushaltskonto in Himmelblau
- Fixkosten: flacher Kopf wie im Alltag („Summe pro Monat“, „N Positionen · X % vom Gehalt“), Richtwert entfällt; Balken in Dunkelorange mit weißen Symbolen, immer voll (Anteile an der Summe)
- Alle Kategorien sind sofort sichtbar („X weitere Kategorien“ entfällt)
- Jede Kategorie lässt sich über den Pfeil rechts ein- und ausklappen; die App merkt sich das je Ansicht auf diesem Gerät (nur Kategorie-IDs, keine Beträge)
- Symbole im Balken erscheinen nur, wenn der Abschnitt breit genug ist

## Neu in Version 1.15
- Alltag: Kopf ohne Kasten direkt auf dem Hintergrund – nur „Ausgegeben“ und „Noch verfügbar“ mit Balken (Budget-Zeile und Tageswert entfallen); im Haushaltskonto himmelblauer Balken
- Alltag und Fixkosten: Stift oben rechts statt „Neue Kategorie“/„Bearbeiten“ (neue Kategorien dort über „Neu“); Symbole ohne farbigen Hintergrund; kompaktere Kategorie-Köpfe
- Neues Auto-Symbol (Seitenansicht), auch für Mobilität

## Neu in Version 1.14: Neue Übersicht, dunklerer Hintergrund
- Übersicht ohne grauen Kasten: Ring (gerade Übergänge, runde Enden) links, rechts „Noch verfügbar“, Einnahmen, Ausgaben, Letzter Eintrag
- Drei Kacheln Fixkosten · Alltag · Sparen mit Betrag und Anteil an den Einnahmen des Monats (ohne Einnahmen: am hinterlegten Gehalt)
- Haushaltskonto-Kachel mit eigenem Ring in Himmelblau, darunter „Schnell erfassen“ (3 meistgenutzte Alltags-Kategorien + „Andere“) und eine Zeile „Zuletzt“ (führt zu allen Buchungen)
- „Letzter Eintrag“: heute/gestern mit Uhrzeit, sonst Wochentag und Datum, Vorjahr mit Jahreszahl
- Ganze App mit dunklerem Hintergrund (#0E0F12)
- Die Soll-Aufteilung (Grundlage des Alltag-Budgets) liegt jetzt unter Mehr › Einstellungen › Budget-Aufteilung

## Neu in Version 1.13.2
- „Noch verfügbar“ zählt in 380 ms, das Kreisdiagramm gleitet in 600 ms
- Übersicht: „Letzte Buchungen“ zeigt 3 statt 5 Einträge; Monatswechsel per Wischen nach links/rechts überall auf der Seite

## Neu in Version 1.13.1
- Monatswechsel: „Noch verfügbar“ und Kreisdiagramm animieren gemeinsam in 600 ms (vorher 250 bzw. 450 ms)

## Neu in Version 1.13
- Übersicht: unter dem Kreisdiagramm links „Einnahmen“ und „Ausgaben“, rechts „Letzter Eintrag“ mit Tag, Datum und Uhrzeit
- Kreisdiagramm: wechselt beim Monatswechsel weich zu den neuen Anteilen (bei „Bewegung reduzieren“ sofort)
- Oberer Rand: deckender Streifen unter der Statusleiste und etwas mehr Abstand; Inhalt verschwindet sauber darunter
- Erfassen: Das Zahlenfeld erscheint erst nach Tipp auf den Betrag, unten im Vordergrund wie eine Tastatur, mit „Fertig“ und „Speichern“
- Fehlerbehebung: Die Legende der Auswertung (1.12.1) hat die Legende auf der Übersicht verschoben

## Neu in Version 1.12.1
- Auswertung › Haushaltskonto: Ausgaben (Balken, Legende und „Zeitraum“) nach den Kategorien des Haushaltskontos statt nach Fixkosten/Alltag/Sparen – die 5 größten, Rest als „Sonstige“

## Neu in Version 1.12: Getrennte Kategorien fürs Haushaltskonto
- Das Haushaltskonto hat eine eigene Kategorienliste (Category.scope = 'joint', immer Alltag/Ausgaben). Erfassen, Alltag, Buchungsfilter und CSV-Import zeigen je Konto nur die passende Liste; Buchungen werden beim Speichern darauf geprüft.
- Beim ersten Start mit 1.12 bekommen bisherige Haushaltsbuchungen gleichnamige Kategorien in der neuen Liste (eigene Kategorien bleiben unverändert). Neu eingerichtetes Haushaltskonto startet mit „Lebensmittel“ (Einkaufen, Getränke) und „Haushalt“ (Drogerie, Putzmittel).
- „Neue Kategorie“/„Bearbeiten“ in der Ansicht Haushaltskonto sowie neue Kategorien beim CSV-Import ins Haushaltskonto landen nur in dessen Liste; gemerkte Import-Zuordnungen sind je Konto getrennt.
- Datenbank-Schema 8 (ohne Strukturänderung; ältere App-Versionen lehnen neuere Backups ab, statt die Zuordnung zu verlieren)

## Neu in Version 1.11
- Fehlerbehebung: Einstellungen (z. B. Sparkonto-Stand, Kontoname, Aufteilung) ließen sich nicht speichern, sobald das gemeinsame Konto eingerichtet oder ein CSV-Import gemacht war – geprüft wurde fälschlich ohne Kategorien
- Sparen: Kontostand wird wie beim Depot „mit heutigem Datum erfasst“ (Verlauf, Löschen), dient nur der Korrektur; gebuchte Sparraten seit dem letzten Stand werden weiter hinzugerechnet, die Hochrechnung bleibt
- Untere Leiste: „Buchungen“ ersetzt den Plus-Knopf; neue Buchungen (auch Einnahmen) über „Neue Buchung“ in Buchungen, Ausgaben wie gewohnt per Tipp im Alltag
- Alltag und Fixkosten: „Neue Kategorie“ und „Bearbeiten“ direkt oben; Mehr › Kategorien entfällt (alle Kategorien inkl. Sparen/Einnahmen unter Mehr › Einstellungen)

## Neu in Version 1.10.1 (Fehlerbehebung Updates)
- Eigene Service-Worker-Registrierung mit `updateViaCache: 'none'`: Die Update-Prüfung lädt `sw.js` nie aus dem Browser-Cache, wartet, bis eine neue Version fertig installiert ist, und versucht es bei neuerer Server-Version bis zu dreimal
- Liegt auf dem Server eine neuere Version, deren Dateien noch nicht ankommen (GitHub verteilt mit Verzögerung), steht das jetzt da – statt „neueste Version“
- „Jetzt aktualisieren“ lädt auch dann neu, wenn iOS das Umschalten nicht meldet
- „Neu installieren“ prüft vorher, ob Startseite und alle Programmdateien vom Server kommen; sonst bleibt alles unverändert (kein leerer Bildschirm mehr)
- Können Programmdateien nicht geladen werden, erscheint nach 4 s ein Hinweis mit „Neu laden“ statt einer leeren Seite
- Datenbank: Ein älteres offenes App-Fenster gibt die Datenbank frei und lädt neu, wenn eine neuere Version sie aktualisieren will

## Neu in Version 1.10
- CSV-Import › Weitere › „Retouren“: Gutschrift und frühere Ausgabe mit gleichem Betrag beim selben Händler (oder in derselben Bank-Kategorie, bis 120 Tage) stehen als Paar zusammen und sind abgewählt – sie zählen nicht in die Ausgaben
- Kategorie-Auswahl beim Import: „Neue Kategorie anlegen“ (Hauptkategorie mit erster Unterkategorie und Gruppe), angelegt wie unter Mehr › Kategorien; Abschnitt „Ohne Unterkategorien“ entfällt (Sparen und Einnahmen bleiben wählbar)
- Untere Leiste: Die App wird nicht mehr über den gemeldeten Bildschirmbereich hinaus verlängert; eine eventuelle Lücke darunter wird in der Leistenfarbe gefüllt. Dadurch kann die Leiste nicht mehr abgeschnitten werden.

## Neu in Version 1.9
- Alltag (eigenes und gemeinsames Konto) und Fixkosten: Kategorien, Unterkategorien und Fixkosten-Positionen gedrückt halten (≈ 0,5 s) und ziehen, um die Reihenfolge zu ändern; „Sortieren“ unter Mehr › Kategorien entfällt
- CSV-Import: Tipp auf eine Buchung zeigt alle Angaben aus dem Kontoauszug (Empfänger, Kaufzeitpunkt, Buchungsdatum, Verwendungszweck, Bank-Kategorie, IBAN) und den Status in der App; Übernehmen/Kategorie direkt dort
- CSV-Import: Weitere Sammel-Blöcke nach Bank-Unterkategorie (z. B. Restaurants, Bäckereien, Online-Shopping), sobald mehrere Händler darunter vorkommen; „Weitere Ausgaben“ bleibt je Händler
- Fixkosten-Positionen merken sich ihre Reihenfolge (optionales Feld `sort`, ohne Schema-Änderung)

## Neu in Version 1.8
- Alltag: aufgeklappte Buchungen lassen sich wie in „Alle Buchungen“ nach links wischen und löschen (mit Rückgängig)
- CSV-Import: Supermärkte und Tankstellen stehen je in einem gemeinsamen Block; Aufklappen per Tipp auf Name oder Pfeil
- Kategorie-Auswahl beim Import: „+“ legt direkt eine neue Unterkategorie an
- Auswahlblätter: Hintergrund scrollt nicht mehr mit, Liste lässt sich bis ganz unten scrollen

## Neu in Version 1.7: CSV-Import
- Mehr › CSV-Import: Kontoauszug als CSV einlesen (C24-Export; andere Banken mit Spalten für Datum und Betrag, Komma oder Semikolon)
- Zwischenschritt „Prüfen & zuordnen“: Ausgaben nach Händler gebündelt, eine Kategorie je Händler (Vorschlag aus Name/Bank-Kategorie, einmal gewählte Zuordnung wird gemerkt), einzelne Buchungen ab- oder umwählbar
- Schon vorhandene Ausgaben (gleicher Betrag, gleiches Kauf- oder Buchungsdatum) werden nicht importiert; bis 3 Tage daneben → abgewählt zum Prüfen; schon importierte Zeilen werden erkannt
- Aufrundungen, Umbuchungen und Gutschriften sind ausgeblendet, aber einzeln wählbar (Gutschrift → Einnahme, Aufrundung → Sparen)
- Erst „Übernehmen“ speichert, in einer Transaktion; „Rückgängig“ bzw. „Letzten Import rückgängig machen“ entfernt genau die importierten Buchungen
- Die Datei wird nur im Browser gelesen, nicht gespeichert und nirgends hingeschickt. Zielkonto wählbar (Mein Konto / gemeinsames Konto)
- Datenbank-Schema 7 (ohne Datenumbau; neue optionale Felder `importId` und `importRules`)

## Neu in Version 1.6
- Alltag: die 4 meistgenutzten Kategorien (letzte 3 Monate) bleiben immer sichtbar, auch am Monatsanfang
- Mehr › Kategorien: Reihenfolge („Sortieren“), Unterkategorie verschieben oder zur Hauptkategorie machen, Gruppe wechseln, zwei Kategorien zusammenführen (Buchungen, Vorlagen und Budgets wandern mit)
- Gemeinsames Konto: Rest wird in den Folgemonat übertragen („Verfügbar“ = Übertrag + Einzahlungen − Ausgaben); Übertrag lässt sich ab einem Monat neu starten
- Bearbeiten mit „Rückgängig“, Notiz-Vorschläge aus früheren Einträgen
- Große iOS-Schrift: Beträge und Titel brechen nicht mehr um
- Datenbank-Schema 6 (ohne Datenumbau)

## Neu in Version 1.5: Gemeinsames Konto
- Mehr › Gemeinsames Konto: Name, eigener Beitrag (wird monatlich als Alltags-Ausgabe „Beitrag …“ gebucht), Beitrag der anderen Person (üblicher Betrag, je Monat anpassbar)
- Beim Erfassen „Mein Konto | Haushaltskonto“; Einkäufe vom gemeinsamen Konto zählen nur dort, nie in deinem „Noch verfügbar“ oder Alltagsbudget
- Alltag, Buchungen und Auswertung mit Umschalter „Ich | Haushaltskonto“; Karte auf der Übersicht mit Restbetrag
- Budget des gemeinsamen Kontos = Summe beider Einzahlungen im Monat. Übrige Beträge werden (noch) nicht in den Folgemonat übertragen.
- Datenbank-Schema 5 (ohne Datenumbau; bestehende Buchungen gehören zum eigenen Konto)

## Neu in Version 1.4
- Fixkosten › „Rücklagen für jährliche Zahlungen“: angesparter Betrag je jährlicher Zahlung (aus den tatsächlich gebuchten Monatsanteilen), Fälligkeit und Hinweis, falls bis zur Fälligkeit etwas fehlt
- Auswertung › Tipp auf eine Kategorie: Verlauf der letzten 12 Monate mit Durchschnitt und teuerstem Monat
- Neue Vorlagen werden sofort im aktuellen Monat gebucht
- WebKit-Tests (Safari-Engine): `npm run e2e:webkit` (Linux oder WSL mit `apt install webkit2gtk-driver xvfb`, vorher `npm run build` und `npm run preview`)

## Neu in Version 1.3
- Dezenteres Zahlenfeld beim Erfassen (Tasten weiterhin mindestens 44 pt)
- Mehr › Einstellungen › App-Version: installierte Version, Version auf dem Server, „Nach Update suchen“, „Jetzt aktualisieren“ und als Notlösung „Neu installieren“ (leert nur den Programm-Cache, Daten bleiben)
- Bei jedem Release `src/version.ts`, `package.json` und `public/version.json` gemeinsam erhöhen (ein Test prüft das)

## Neu in Version 1.2
- Schnelle Listen auch bei sehr vielen Buchungen (seitenweises Laden)
- Absturzschutz mit verständlicher Meldung, Monatswechsel bei offener App
- Backup zählt erst als gesichert, wenn du bestätigst, dass die Datei abgelegt ist
- Content-Security-Policy (keine Verbindungen zu fremden Servern)
- Neues, ruhigeres Designsystem: feste Farbrollen, 6 Schriftstufen nach iOS-Textgröße, Touch-Flächen ≥ 44 pt
- Erfassen: zuletzt genutzte Bezeichnungen, Duplizieren, Löschen mit Rückgängig
- Jährliche Fixkosten mit Fälligkeitsmonat und Übersicht „Jährliche Zahlungen“

**Empfehlung:** Aktiviere die Zwei-Faktor-Anmeldung für dein GitHub-Konto. Wer das Konto übernimmt, könnte sonst eine manipulierte App-Version ausliefern.

## Funktionen (Version 1.1)
- Reiter Übersicht · Alltag · + · Fixkosten · Mehr; Erfassen per Zahlenfeld mit Kategorie-Chips
- Alltag: Unterkategorien aufklappbar mit den einzelnen Buchungen
- Buchungen: nach links wischen zum Löschen, Mehrfachauswahl, „Rückgängig“
- Gehalt als Basis der Aufteilung (Mehr › Gehalt & Wiederkehrend), Aufteilung über „Anpassen“ auf der Übersicht
- Fixkosten monatlich oder jährlich (Jahresbetrag wird centgenau auf 12 Monate verteilt)
- Sparen: Sparrate, Kontostand, Hochrechnung; Depot: Stände mit Datum, Verlauf als Grafik in der Auswertung
- Auswertung mit frei wählbarem Zeitraum (1–12 Monate)

## Voraussetzungen (Windows)
- Node.js 20 oder neuer (https://nodejs.org)
- Zum Veröffentlichen: kostenloses GitHub-Konto (GitHub Pages) oder anderer statischer HTTPS-Host

## Installation & Entwicklung
```
npm install
npm run dev        # Entwicklungsserver
npm test           # Unit-/Integrationstests (Vitest)
npm run build      # Typprüfung + Produktions-Build nach dist/
npm run preview    # Build lokal ansehen (http://localhost:4173)
npm run e2e        # Playwright-Tests in Chromium (einmalig: npx playwright install chromium)
npm run e2e:webkit # WebKit-Tests (Safari-Engine), nur Linux/WSL, siehe „Neu in Version 1.4“
```

## Veröffentlichen (für die iPhone-Installation nötig)
iOS erlaubt Service Worker und „Zum Home-Bildschirm“ nur über **HTTPS**. Der Inhalt von `dist/` ist rein statisch:
1. Neues GitHub-Repository anlegen und den Inhalt von `dist/` hochladen.
2. Settings → Pages → Branch wählen. Adresse: `https://<name>.github.io/<repo>/`.
Die App nutzt relative Pfade (`base: './'`) und läuft deshalb auch in Unterordnern. Das Repository enthält nur Programmcode, keine Finanzdaten.

## Installation auf dem iPhone
1. Adresse **in Safari** öffnen.
2. Teilen-Symbol → „Zum Home-Bildschirm“ → Hinzufügen.
3. App vom Home-Bildschirm starten und einmal mit Internet öffnen (lädt alle Dateien). Danach läuft sie offline.

Wichtig: Safari und die Home-Bildschirm-App haben getrennte Datenbanken. Lege Daten nur in der Home-Bildschirm-App an.

## Offline
Alle Programmdateien werden per Workbox vorab gecacht, Daten liegen in IndexedDB. Im Automatiktest (Chromium) wurden Neuladen und Buchen im Offline-Modus geprüft. Der Flugmodus-Test auf einem echten iPhone steht noch aus.

## Backup & Wiederherstellung
- Mehr › Backup › „Verschlüsseltes Backup erstellen“, Passwort mindestens 10 Zeichen. Es gibt **kein automatisches Backup**, nur manuelle Exporte; die App weist darauf hin, solange noch keines existiert.
- Format: JSON-Hülle mit Version, zufälligem Salt (16 Byte) und IV (12 Byte) je Export, PBKDF2-SHA256 (Standard 600 000 Iterationen), AES-256-GCM, Kopfdaten als Additional Data authentifiziert. Es wird die Web-Crypto-API des Browsers genutzt, keine eigene Kryptografie.
- Wiederherstellen: Datei wählen → Passwort → Prüfung mit Zusammenfassung (Datum, Anzahl Buchungen, Zeitraum) → Bestätigung. Der Import läuft in **einer** Transaktion; bei jedem Fehler bleiben die bestehenden Daten unverändert. Vorher wird der aktuelle Stand als Sicherung abgelegt und lässt sich zurückholen.
- Falsches Passwort, beschädigte, manipulierte oder nicht unterstützte Dateien werden abgelehnt, ohne Daten zu ändern. Das Passwort wird nirgends gespeichert.

## Datenschutz und Sicherheitsgrenzen
- IndexedDB ist **nicht** zusätzlich verschlüsselt. Schutz bietet die Gerätesperre des iPhones (bewusste Entscheidung: kein App-PIN). Nur Backup-Dateien sind verschlüsselt.
- Ein Backup ist nur so sicher wie sein Passwort; vergessene Passwörter sind nicht wiederherstellbar.
- Die App sendet keine Finanzdaten. Auf dem Host fallen nur übliche Zugriffsprotokolle für die Programmdateien an.
- Safari kann Website-Daten von nicht installierten Seiten nach längerer Nichtnutzung löschen. Als Home-Bildschirm-App ist das Risiko deutlich geringer, aber nicht null: regelmäßig sichern.

## Bekannte Einschränkungen
- Kein Face ID, keine Widgets, keine Erinnerungen.
- Kein automatisches Backup, keine Synchronisation zwischen Geräten.
- Nur Euro. Wiederkehrende Buchungen: monatlich, Tag 1–28.
- Sparen wird als Ausgabe der Gruppe „Sparen“ gebucht und senkt „Noch verfügbar“. Bargeld ist eine normale Alltags-Kategorie.
- Die Spar-Hochrechnung rechnet ohne Zinsen. Kontostand und Depot werden von Hand gepflegt (keine Bankanbindung).
- Die Dauer der Schlüsselableitung (600 000 Iterationen) auf dem iPhone wurde nicht gemessen.

## Updates ohne Datenverlust
Neuen Build auf den Host laden. Die App meldet „Neue App-Version bereit“ → „Aktualisieren“. Programmdateien und Daten sind getrennt; Datenbankänderungen laufen über versionierte Migrationen (`src/db/db.ts`, aktuell Schema 8; Tests in `tests/backup-migration.test.ts`, `tests/v3-features.test.ts`, `tests/v4-features.test.ts`, `tests/v5-joint.test.ts`, `tests/v6.test.ts`, `tests/import.test.ts` und im Browser-Test). Backups älterer Versionen lassen sich weiterhin einspielen. Vor größeren Updates ein Backup erstellen.
