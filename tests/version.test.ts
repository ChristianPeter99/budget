import { describe, expect, it } from 'vitest';
import pkgRaw from '../package.json?raw';
import pubRaw from '../public/version.json?raw';
import { APP_VERSION } from '../src/version';

describe('Versionsnummer', () => {
  it('stimmt in App, package.json und public/version.json überein', () => {
    expect((JSON.parse(pkgRaw) as { version: string }).version).toBe(APP_VERSION);
    expect((JSON.parse(pubRaw) as { version: string }).version).toBe(APP_VERSION);
  });
});
