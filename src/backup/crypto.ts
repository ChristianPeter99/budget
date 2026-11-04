// Verschlüsselung ausschließlich mit der Web Crypto API des Browsers (keine eigene Kryptografie):
//   Schlüsselableitung: PBKDF2 mit HMAC-SHA-256, zufälliger 16-Byte-Salt pro Export
//   Verschlüsselung:   AES-256-GCM, zufälliger 12-Byte-IV pro Export
// Die Kopfdaten (Format, Version, KDF-Parameter, Salt, IV) werden als „Additional Authenticated Data“
// mitgeschützt: Wer sie nachträglich verändert, macht die Entschlüsselung unmöglich.

export const FORMAT = 'budget-backup';
export const FORMAT_VERSION = 1;
/** Ausgangswert nach aktueller OWASP-Empfehlung für PBKDF2-HMAC-SHA256. Wird beim Export im Backup gespeichert, so dass spätere Erhöhungen alte Backups nicht ungültig machen. */
export const DEFAULT_ITERATIONS = 600_000;
export const MIN_ITERATIONS = 100_000;
export const MAX_ITERATIONS = 10_000_000;
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

export type BackupErrorCode = 'format' | 'version' | 'password' | 'corrupt' | 'invalid' | 'size' | 'unsupported';
export class BackupError extends Error {
  readonly code: BackupErrorCode;
  readonly userMessage: string;
  constructor(code: BackupErrorCode, userMessage: string) {
    super(userMessage);
    this.name = 'BackupError';
    this.code = code;
    this.userMessage = userMessage;
  }
}

export interface BackupEnvelope {
  format: typeof FORMAT;
  formatVersion: number;
  createdAt: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; keyLength: 256; iv: string };
  ciphertext: string;
}

const te = new TextEncoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) throw new BackupError('corrupt', 'Die Backup-Datei ist beschädigt.');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function ensureCrypto(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle) throw new BackupError('unsupported', 'Dieser Browser unterstützt die Verschlüsselung nicht (Web Crypto fehlt). Öffne die App über https.');
  return crypto.subtle;
}

function aad(h: Omit<BackupEnvelope, 'ciphertext'>): Uint8Array {
  return te.encode(JSON.stringify([h.format, h.formatVersion, h.createdAt, h.kdf.name, h.kdf.hash, h.kdf.iterations, h.kdf.salt, h.cipher.name, h.cipher.keyLength, h.cipher.iv]));
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const subtle = ensureCrypto();
  const base = await subtle.importKey('raw', te.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptText(plaintext: string, password: string, iterations: number = DEFAULT_ITERATIONS): Promise<BackupEnvelope> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new BackupError('password', `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`);
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new BackupError('invalid', 'Ungültige Iterationszahl.');
  const subtle = ensureCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const head: Omit<BackupEnvelope, 'ciphertext'> = {
    format: FORMAT, formatVersion: FORMAT_VERSION, createdAt: new Date().toISOString(),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', keyLength: 256, iv: toBase64(iv) }
  };
  const key = await deriveKey(password, salt, iterations);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(head) as BufferSource, tagLength: 128 }, key, te.encode(plaintext));
  return { ...head, ciphertext: toBase64(new Uint8Array(ct)) };
}

/** Liest und prüft den Dateikopf, ohne zu entschlüsseln. */
export function parseEnvelope(text: string): BackupEnvelope {
  if (text.length > MAX_FILE_BYTES) throw new BackupError('size', 'Die Datei ist zu groß für ein Backup.');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new BackupError('format', 'Das ist keine gültige Backup-Datei.'); }
  const e = raw as Partial<BackupEnvelope> | null;
  if (!e || typeof e !== 'object' || e.format !== FORMAT) throw new BackupError('format', 'Das ist keine Backup-Datei dieser App.');
  if (e.formatVersion !== FORMAT_VERSION) {
    throw new BackupError('version', typeof e.formatVersion === 'number' && e.formatVersion > FORMAT_VERSION
      ? 'Dieses Backup stammt aus einer neueren App-Version. Bitte aktualisiere die App.'
      : 'Diese Backup-Version wird nicht unterstützt.');
  }
  const k = e.kdf, c = e.cipher;
  if (!k || k.name !== 'PBKDF2' || k.hash !== 'SHA-256' || !Number.isInteger(k.iterations) || k.iterations < MIN_ITERATIONS || k.iterations > MAX_ITERATIONS
    || typeof k.salt !== 'string' || !c || c.name !== 'AES-GCM' || c.keyLength !== 256 || typeof c.iv !== 'string'
    || typeof e.ciphertext !== 'string' || !e.ciphertext || typeof e.createdAt !== 'string') throw new BackupError('format', 'Die Backup-Datei ist unvollständig oder beschädigt.');
  if (fromBase64(k.salt).length < 16 || fromBase64(c.iv).length !== 12) throw new BackupError('corrupt', 'Die Backup-Datei ist beschädigt.');
  return e as BackupEnvelope;
}

export async function decryptEnvelope(env: BackupEnvelope, password: string): Promise<string> {
  const subtle = ensureCrypto();
  const { ciphertext, ...head } = env;
  const key = await deriveKey(password, fromBase64(env.kdf.salt), env.kdf.iterations);
  try {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(env.cipher.iv) as BufferSource, additionalData: aad(head) as BufferSource, tagLength: 128 }, key, fromBase64(ciphertext) as BufferSource);
    return new TextDecoder('utf-8', { fatal: true }).decode(pt);
  } catch (e) {
    if (e instanceof BackupError) throw e;
    // AES-GCM kann „falsches Passwort“ und „veränderte Datei“ nicht unterscheiden.
    throw new BackupError('password', 'Das Passwort ist falsch oder die Datei wurde verändert.');
  }
}
