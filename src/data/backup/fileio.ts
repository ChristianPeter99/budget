/**
 * Gibt eine Datei an den Nutzer aus. Auf dem iPhone öffnet sich das Teilen-Menü („In Dateien sichern“).
 * Rückgabe: 'shared' (Teilen-Menü wurde bestätigt), 'downloaded' (Download ausgelöst, ob er tatsächlich gespeichert
 * wurde, kann der Browser nicht melden) oder 'cancelled' (Nutzer hat abgebrochen).
 */
export async function saveFile(filename: string, text: string, mime = 'application/json'): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = new Blob([text], { type: mime });
  try {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'));
    r.readAsText(file);
  });
}
