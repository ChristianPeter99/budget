import type { CatGroup } from '../domain/types';

export const GROUP_TILE: Record<CatGroup, string> = { einnahme: 't-in', fix: 't-fix', alltag: 't-all', spar: 't-spar' };
export const GROUP_LABEL: Record<CatGroup, string> = { einnahme: 'Einnahme', fix: 'Fixkosten', alltag: 'Alltag', spar: 'Sparen' };
