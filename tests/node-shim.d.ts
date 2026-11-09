// Minimale Typen für die wenigen Node-Funktionen in den Tests (die App selbst läuft nur im Browser)
declare module 'node:child_process' { export function execFileSync(cmd: string, args?: string[]): unknown }
declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string;
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: Uint8Array | string): void;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
}
declare module 'node:os' { export function tmpdir(): string }
declare module 'node:path' {
  export function join(...p: string[]): string;
  export function resolve(...p: string[]): string;
  export function dirname(p: string): string;
  export function relative(from: string, to: string): string;
}
declare const __dirname: string;
declare const process: { env: Record<string, string | undefined> };
