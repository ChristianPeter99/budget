import { describe, expect, it } from 'vitest';
import { catArea } from '../src/domain/types';

describe('catArea', () => {
  it('ordnet Kategorien den Bereichen zu', () => {
    expect(catArea({ kind: 'expense', group: 'alltag' })).toBe('alltag');
    expect(catArea({ kind: 'expense', group: 'fix' })).toBe('fix');
    expect(catArea({ kind: 'expense', group: 'spar' })).toBe('fix');
    expect(catArea({ kind: 'income', group: 'einnahme' })).toBe('einnahme');
    expect(catArea({ kind: 'expense', group: 'alltag', scope: 'joint' })).toBe('joint');
  });
});
