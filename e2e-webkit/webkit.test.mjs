// WebKit-Tests (Safari-Engine) über WebKitWebDriver (WebKitGTK).
// Voraussetzung (Linux/WSL): apt install webkit2gtk-driver xvfb; App-Build läuft unter http://localhost:4173.
// Start: npm run e2e:webkit  (startet Treiber unter xvfb automatisch, siehe scripts/webkit-tests.sh)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Builder, By, until } from 'selenium-webdriver';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
const SERVER = process.env.WEBKIT_DRIVER ?? 'http://127.0.0.1:4445';
const BINARY = process.env.WEBKIT_BINARY ?? '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser';
let d;
const results = {};

const byText = (tag, text, exact = true) => By.xpath(`//${tag}[${exact ? `normalize-space(.)='${text}'` : `contains(normalize-space(.),'${text}')`}]`);
const click = async (loc) => { const el = await d.wait(until.elementLocated(loc), 8000); await d.wait(until.elementIsVisible(el), 8000); await d.executeScript('arguments[0].scrollIntoView({block:"center"})', el); await el.click(); return el; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = async (css) => (await d.findElement(By.css(css))).getText();

before(async () => {
  d = await new Builder().usingServer(SERVER).withCapabilities({ browserName: 'MiniBrowser', 'webkitgtk:browserOptions': { binary: BINARY, args: ['--automation'] } }).build();
  await d.manage().window().setRect({ width: 390, height: 844 });
  // Erfundene Beispieldaten (tests/demo): übergeben, bevor die App die Datenbank anlegt; Startmonat = aktueller Monat
  await d.get(BASE + 'manifest.webmanifest');
  const now = new Date(), month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const demo = readFileSync('tests/demo/demo-data.json', 'utf8').replace(/"__MONTH__"/g, JSON.stringify(month));
  await d.executeScript("localStorage.setItem('seedDemo', arguments[0]); localStorage.setItem('budget.catview.v1', JSON.stringify({ alltag: 'list', fix: 'list' }))", demo);
  await d.get(BASE);
  await d.wait(until.elementLocated(By.css('h1')), 15000);
});
after(async () => { console.log('WEBKIT_RESULTS ' + JSON.stringify(results)); await d?.quit(); });

test('WebKit: App startet, Engine ist WebKit, Startdaten aus IndexedDB', async () => {
  const ua = await d.executeScript('return navigator.userAgent');
  assert.match(ua, /AppleWebKit/);
  results.userAgent = ua;
  results.viewport = await d.executeScript('return [window.innerWidth, window.innerHeight]');
  assert.match(await text('h1'), /\d{4}/);
  assert.ok((await d.findElements(byText('span', 'Noch verfügbar'))).length === 1);
});

test('WebKit: kein horizontales Scrollen auf iPhone-Breite', async () => {
  for (const tab of ['Alltag', 'Fixkosten', 'Mehr', 'Übersicht']) {
    await click(By.xpath(`//nav//button[@aria-label='${tab}']`));
    await sleep(200);
    const over = await d.executeScript('return document.documentElement.scrollWidth > window.innerWidth');
    assert.equal(over, false, tab);
  }
});

test('WebKit: Buchung per Zahlenfeld, Tausenderpunkte, bleibt nach Neuladen', async () => {
  await click(By.xpath("//nav//button[@aria-label='Buchungen']"));
  await click(By.css('button[aria-label="Neue Buchung"]'));
  await click(By.css('button[aria-label="Betrag"]'));
  for (const k of ['1', '2', '3', '4', ',', '5']) await click(By.css(`[aria-label="Zahlenfeld"] button[aria-label="${k}"]`));
  assert.equal(await text('[aria-label="Betrag"]'), '1.234,5 €');
  const keys = await d.executeScript('return [...document.querySelectorAll("[aria-label=Zahlenfeld] button")].map(b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; })');
  for (const [w, h] of keys) { assert.ok(w >= 44 && h >= 44, `Taste ${w}×${h}`); }
  await click(By.xpath("//div[@role='dialog']//button[contains(@class,'chip') and not(contains(@class,'recent')) and normalize-space(.)='Lebensmittel']"));
  await click(By.xpath("//div[@role='dialog']//button[contains(@class,'chip') and not(contains(@class,'recent')) and normalize-space(.)='Kantine']"));
  const note = await d.findElement(By.css('input[placeholder="Optional"]'));
  await note.sendKeys('WebKit-Test');
  await click(byText('button', 'Speichern'));
  await d.wait(async () => (await d.findElements(By.css('.sheetwrap'))).length === 0, 5000);
  await d.navigate().refresh();
  await d.wait(until.elementLocated(By.css('nav')), 10000);
  await click(By.xpath("//nav//button[@aria-label='Buchungen']"));
  await d.wait(until.elementLocated(byText('b', 'WebKit-Test')), 10000);
  const amt = await d.findElement(By.xpath("//button[.//b[normalize-space(.)='WebKit-Test']]//span[contains(@class,'amt')]")).getText();
  assert.equal(amt, '1.234,50 €');
});

test('WebKit: Buchung antippen und löschen, Rückgängig stellt wieder her', async () => {
  const row = await d.wait(until.elementLocated(By.xpath("//div[contains(@class,'swipe')]//button[contains(@class,'item')][.//b[normalize-space(.)='WebKit-Test']]")), 8000);
  await d.executeScript('arguments[0].click()', row);
  await click(byText('button', 'Buchung löschen'));
  await d.wait(async () => (await d.findElements(byText('b', 'WebKit-Test'))).length === 0, 5000);
  await click(byText('button', 'Rückgängig'));
  await d.wait(until.elementLocated(byText('b', 'WebKit-Test')), 5000);
});

test('WebKit: Web Crypto mit den Backup-Parametern (PBKDF2-SHA256 600.000, AES-256-GCM, AAD)', async () => {
  const r = await d.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    (async () => {
      const enc = new TextEncoder();
      const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
      const derive = async (pw) => crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 },
        await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const aad = enc.encode('{"format":"budget-backup"}');
      const t0 = performance.now();
      const key = await derive('richtiges-passwort');
      const ms = performance.now() - t0;
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, enc.encode('Grüße 1.234,56 €'));
      const pt = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ct));
      let wrongRejected = false;
      try { await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, await derive('falsches-passwort'), ct); } catch { wrongRejected = true; }
      let aadRejected = false;
      try { await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('x') }, key, ct); } catch { aadRejected = true; }
      done({ pt, wrongRejected, aadRejected, ms: Math.round(ms) });
    })().catch((e) => done({ error: String(e) }));`);
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.pt, 'Grüße 1.234,56 €');
  assert.equal(r.wrongRejected, true);
  assert.equal(r.aadRejected, true);
  results.pbkdf2Ms = r.ms;
});

test('WebKit: Content-Security-Policy ohne Verstöße beim Durchklicken', async () => {
  await d.executeScript('window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective));');
  await click(By.xpath("//nav//button[@aria-label='Mehr']"));
  for (const p of ['Sparen & Depot', 'Auswertung', 'Wiederkehrende Einnahmen', 'Daten & Backup']) {
    await click(By.xpath(`//button[contains(@class,'link')][contains(normalize-space(.),'${p}')]`));
    await sleep(250);
    await click(By.xpath("//button[contains(@class,'back')]"));
  }
  assert.deepEqual(await d.executeScript('return window.__csp'), []);
});

test('WebKit: Gemeinsames Konto – Einkauf ändert „Noch verfügbar“ nicht', async () => {
  await click(By.xpath("//nav//button[@aria-label='Mehr']"));
  await click(By.xpath("//button[contains(@class,'link')][contains(normalize-space(.),'Gemeinsames Konto')]"));
  const setVal = async (label, v) => { const el = await d.findElement(By.css(`input[aria-label="${label}"]`)); await el.clear(); await el.sendKeys(v); };
  await setVal('Mein Beitrag pro Monat', '400');
  await setVal('Beitrag der anderen Person pro Monat', '350');
  await click(By.xpath("//button[normalize-space(.)='Einrichten' or normalize-space(.)='Speichern']"));
  await sleep(500);
  await click(By.xpath("//nav//button[@aria-label='Übersicht']"));
  await sleep(700);
  const before = await text('.hero .big');
  await click(By.xpath("//nav//button[@aria-label='Buchungen']"));
  await click(By.css('button[aria-label="Neue Buchung"]'));
  await click(By.xpath("//div[@role='dialog']//button[@role='tab'][normalize-space(.)='Haushaltskonto']"));
  await click(By.css('button[aria-label="Betrag"]'));
  for (const k of ['2', '0']) await click(By.css(`[aria-label="Zahlenfeld"] button[aria-label="${k}"]`));
  await click(By.xpath("//div[@role='dialog']//button[contains(@class,'chip') and not(contains(@class,'recent')) and normalize-space(.)='Lebensmittel']"));
  await click(By.xpath("//div[@role='dialog']//button[contains(@class,'chip') and not(contains(@class,'recent')) and normalize-space(.)='Einkaufen']"));
  await click(byText('button', 'Speichern'));
  await d.wait(async () => (await d.findElements(By.css('.sheetwrap'))).length === 0, 5000);
  await click(By.xpath("//nav//button[@aria-label='Übersicht']"));
  await sleep(700);
  assert.equal(await text('.hero .big'), before);
  const card = await d.findElement(By.css('.ovcorner.tl')).getText();
  assert.match(card, /Haushaltskonto\s*730 €\s*übrig/);
});

test('WebKit: CSV-Import – Datei lesen, Duplikat-Prüfung, übernehmen', async () => {
  const csv = (await import('node:fs')).readFileSync(new URL('../tests/fixtures/c24-beispiel.csv', import.meta.url), 'utf8');
  await click(By.xpath("//nav//button[@aria-label='Mehr']"));
  await click(By.xpath("//button[contains(normalize-space(.),'Import')]"));
  await d.wait(until.elementLocated(By.css('input[aria-label="Kontoauszug (CSV oder PDF)"]')), 8000);
  await d.executeScript(`const inp = document.querySelector('input[aria-label="Kontoauszug (CSV oder PDF)"]');
    const dt = new DataTransfer(); dt.items.add(new File([arguments[0]], 'beispiel.csv', { type: 'text/csv' }));
    inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));`, csv);
  await d.wait(until.elementLocated(By.css('.imp')), 8000);
  const bar = async () => (await d.findElement(By.css('.selbar span'))).getText();
  assert.match(await bar(), /1 ohne Kategorie/);
  // die Zeile ohne Kategorie-Vorschlag zuordnen (welche das ist, hängt von den Kategorienamen ab)
  await d.executeScript('const b = document.querySelector(".catpick.need"); b.scrollIntoView({block:"center"}); b.click()');
  await click(By.xpath("//div[@role='dialog']//button[normalize-space(.)='Kino']"));
  await sleep(200);
  assert.doesNotMatch(await bar(), /ohne Kategorie/);
  await d.executeScript('document.querySelector(".selbar .btn").click()');
  await d.wait(until.elementLocated(By.xpath("//*[contains(normalize-space(.),'Buchungen übernommen')]")), 8000);
  results.csvImport = await (await d.findElement(By.css('.toast'))).getText();
  // Der Hinweis (Toast) kann den Knopf kurz überdecken – direkt auslösen
  const moreBtn = await d.wait(until.elementLocated(By.xpath("//button[@aria-label='Weitere Aktionen']")), 8000);
  await d.executeScript('arguments[0].click()', moreBtn);
  const undoBtn = await d.wait(until.elementLocated(By.xpath("//button[normalize-space(.)='Letzten Import rückgängig machen']")), 8000);
  await d.executeScript('arguments[0].click()', undoBtn);
  await d.wait(until.elementLocated(By.xpath("//*[contains(normalize-space(.),'importierte Buchungen entfernt')]")), 8000);
  await click(By.xpath("//nav//button[@aria-label='Übersicht']"));
});

test('WebKit: PDF-Import – Kontoauszug mit pdf.js lesen, Kontostand-Kontrolle', async () => {
  // erfundener Auszug (pdf-lib): Kontostand alt/neu, zwei Buchungen, mehrzeiliger Text
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create(); const f = await doc.embedFont(StandardFonts.Helvetica);
  const pg = doc.addPage([595, 842]);
  const t = (s, x, y) => pg.drawText(s, { x, y, size: 9, font: f });
  const r = (s, x, y) => pg.drawText(s, { x: x - f.widthOfTextAtSize(s, 9), y, size: 9, font: f });
  t('Alter Kontostand', 50, 780); r('1.000,00', 545, 780);
  t('Datum', 50, 760); t('Text', 120, 760); r('Betrag', 545, 760);
  t('03.11.2026', 50, 740); t('Kartenzahlung', 120, 740); r('-12,50', 545, 740); t('Bäckerei Probe', 120, 729);
  t('05.11.2026', 50, 710); t('Gutschrift', 120, 710); r('100,00', 545, 710); t('Rückzahlung Probe', 120, 699);
  t('Neuer Kontostand', 50, 670); r('1.087,50', 545, 670);
  const b64 = Buffer.from(await doc.save()).toString('base64');
  await click(By.xpath("//nav//button[@aria-label='Mehr']"));
  await click(By.xpath("//button[contains(normalize-space(.),'Import')]"));
  await d.wait(until.elementLocated(By.css('input[aria-label="Kontoauszug (CSV oder PDF)"]')), 8000);
  await d.executeScript(`const inp = document.querySelector('input[aria-label="Kontoauszug (CSV oder PDF)"]');
    const bin = atob(arguments[0]); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u], 'auszug.pdf', { type: 'application/pdf' }));
    inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));`, b64);
  const ok = await d.wait(until.elementLocated(By.css('.pdfcheck.ok')), 20000);
  results.pdfImport = await ok.getText();
  assert.match(results.pdfImport, /Kontostand stimmt/);
  const page = await d.findElement(By.css('main')).getText();
  assert.match(page, /12,50/);
  await d.executeScript('[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Abbrechen"))?.click()');
  await click(By.xpath("//nav//button[@aria-label='Übersicht']"));
});

test('WebKit: Buchungen – Suchfeld nutzt die volle Höhe, kein eigenes Suchfeld-Aussehen', async () => {
  await click(By.xpath("//nav//button[@aria-label='Buchungen']"));
  await d.wait(until.elementLocated(By.css('label.search input')), 8000);
  const r = JSON.parse(await d.executeScript(`const l = document.querySelector('label.search'), i = l.querySelector('input');
    const a = l.getBoundingClientRect(), b = i.getBoundingClientRect(), cs = getComputedStyle(i);
    return JSON.stringify({ box: a.height, inp: b.height, top: b.top - a.top, app: cs.webkitAppearance || cs.appearance, right: b.right <= a.right + 0.5 });`));
  results.search = r;
  assert.ok(r.inp >= r.box - 2 && r.top >= -0.5 && r.right && r.app === 'none', JSON.stringify(r));
  await click(By.xpath("//nav//button[@aria-label='Übersicht']"));
});

test('WebKit: Übersicht – Herunterziehen bringt die Monatsauswahl mit unscharfem Hintergrund', async () => {
  await click(By.xpath("//nav//button[@aria-label='Übersicht']"));
  await d.wait(until.elementLocated(By.css('.ovcenter')), 8000);
  const r = await d.executeAsyncScript(`const done = arguments[arguments.length - 1];
    const el = document.querySelector('.ovcenter'); const b = el.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top;
    const ev = (t, yy, tgt) => tgt.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: x, clientY: yy }));
    ev('pointerdown', y, el);
    let i = 0, mid = null;
    const step = () => {
      i++; ev('pointermove', y + i * 22, window);
      if (i === 5) { const dd = document.querySelector('.dbd'); const cs = dd && getComputedStyle(dd); mid = { has: !!dd, blur: cs ? (cs.webkitBackdropFilter || cs.backdropFilter) : '', p: document.querySelector('.drop')?.style.getPropertyValue('--p') }; }
      if (i < 12) return setTimeout(step, 16);
      ev('pointerup', y + i * 22, window);
      setTimeout(() => done(JSON.stringify({ mid, open: !!document.querySelector('.drop.open'), cells: document.querySelectorAll('.drop .mpcell').length })), 600);
    };
    setTimeout(step, 16);`);
  results.pullDrop = r;
  const o = JSON.parse(r);
  assert.ok(o.mid.has && /blur\(/.test(o.mid.blur) && Number(o.mid.p) > 0 && Number(o.mid.p) < 1, r);
  assert.ok(o.open && o.cells === 12, r);
  await d.executeScript("document.querySelector('.dbd').click()");
  await d.wait(async () => (await d.findElements(By.css('.drop'))).length === 0, 3000);
});

test('WebKit: Alltag – Unterkategorie gedrückt halten und ziehen', async () => {
  await click(By.xpath("//nav//button[@aria-label='Alltag']"));
  const more = await d.findElements(By.css('.morecats'));
  if (more.length && /weitere/.test(await more[0].getText())) { await d.executeScript('arguments[0].click()', more[0]); await sleep(200); }
  const names = async () => d.executeScript(`const card=[...document.querySelectorAll('.card')].find(c=>c.querySelector('.ghead b')?.textContent==='Lebensmittel');return [...card.querySelectorAll('.subrow .sub span:first-child')].map(x=>x.textContent)`);
  const before = await names();
  const rows = await d.executeScript(`const card=[...document.querySelectorAll('.card')].find(c=>c.querySelector('.ghead b')?.textContent==='Lebensmittel');card.scrollIntoView({block:'center'});return [...card.querySelectorAll('.subrow')]`);
  await sleep(200);
  const a = await rows[2].getRect(), b = await rows[0].getRect();
  const actions = d.actions({ async: true });
  await actions.move({ origin: rows[2] }).press().pause(650)
    .move({ origin: 'pointer', x: 0, y: -Math.round((a.y - b.y) / 2) }).move({ origin: 'pointer', x: 0, y: -Math.round((a.y - b.y) / 2) - 6 }).release().perform();
  await sleep(500);
  const after = await names();
  results.dragSort = { before: before.slice(0, 3), after: after.slice(0, 3) };
  assert.deepEqual(after.slice(0, 3), [before[2], before[0], before[1]]);
  assert.equal((await d.findElements(By.css('.sheetwrap'))).length, 0);
});

test('WebKit: untere Leiste vollständig sichtbar', async () => {
  const r = await d.executeScript("const r=document.querySelector('.nav').getBoundingClientRect();return [r.top,r.bottom,window.innerHeight]");
  results.nav = r;
  assert.ok(r[1] <= r[2] + 0.5 && r[0] >= 0, JSON.stringify(r));
});

test('WebKit: Service Worker und Update-Prüfung', async () => {
  const sw = await d.executeAsyncScript(`const done = arguments[arguments.length - 1];
    if (!('serviceWorker' in navigator)) { done('nicht vorhanden'); return; }
    Promise.race([navigator.serviceWorker.ready.then(() => 'aktiv'), new Promise((r) => setTimeout(() => r('nicht bereit nach 8 s'), 8000))]).then(done);`);
  results.serviceWorker = sw;
  await click(By.xpath("//nav//button[@aria-label='Mehr']"));
  await click(By.xpath("//button[contains(@class,'link')][contains(normalize-space(.),'Daten & Backup')]"));
  await click(byText('button', 'Nach Updates suchen'));
  const msg = await d.wait(until.elementLocated(By.xpath("//span[@role='status'][contains(.,'Version') or contains(.,'fehlgeschlagen')]")), 10000);
  results.updateCheck = await msg.getText();
  assert.match(results.updateCheck, /neueste Version|bereit/);
});

test('WebKit: Röhrenfernseher-Effekt läuft und hinterlässt nichts', async () => {
  // Wir sind auf „Daten & Backup“: lange auf die Versionsnummer drücken (per Pointer-Ereignis)
  const r = await d.executeAsyncScript(`const done = arguments[arguments.length - 1];
    const el = document.querySelector('[data-crt]');
    if (!el) { done('kein Element'); return; }
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true }));
    let seen = 0, line = false, card = false, snow = false;
    const log = []; const t0 = performance.now(); const t = setInterval(() => { seen = Math.max(seen, document.querySelectorAll('.crt').length); if (document.querySelector('.crt-line')) line = true; if (document.querySelector('.tb-clock')?.textContent) card = true; if (document.querySelector('.tb-snow')) snow = true; const s = document.getElementById('root').style.opacity + '|' + document.querySelectorAll('.crt').length; if (log[log.length-1]?.[1] !== s) log.push([Math.round(performance.now()-t0), s]); }, 20);
    // kurz halten, dann los – das Extra läuft von selbst weiter
    setTimeout(() => el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true })), 650);
    setTimeout(() => {
      clearInterval(t);
      const root = document.getElementById('root');
      done(JSON.stringify({ log, seen, line, card, snow, waapi: typeof root.animate, style: root.style.cssText, anims: root.getAnimations().length, left: document.querySelectorAll('.crt').length }));
    }, 14500);`);
  results.crt = r;
  const o = JSON.parse(r);
  assert.equal(o.waapi, 'function');
  assert.ok(o.seen >= 1 && o.line && o.card && o.snow, r);
  assert.equal(o.style, '', r);
  assert.equal(o.anims, 0, r);
  assert.equal(o.left, 0, r);
});
