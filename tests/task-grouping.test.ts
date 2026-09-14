import { describe, expect, it } from 'vitest';

import { resolveGroupByDivision } from '@/lib/task-grouping-shared';

describe('resolveGroupByDivision', () => {
  it('honours an explicit param over the default, both ways', () => {
    expect(resolveGroupByDivision('division', false)).toBe(true);
    expect(resolveGroupByDivision('none', true)).toBe(false);
  });

  it('falls back to the caller default when the param is absent', () => {
    for (const absent of [undefined, null]) {
      expect(resolveGroupByDivision(absent, true)).toBe(true);
      expect(resolveGroupByDivision(absent, false)).toBe(false);
    }
  });

  it('a Super Admin opens /tasks grouped, everyone else flat', () => {
    // No query string at all — the landing case this feature is about.
    expect(resolveGroupByDivision(undefined, true)).toBe(true);
    expect(resolveGroupByDivision(undefined, false)).toBe(false);
  });

  it('treats an unrecognised value as absent', () => {
    expect(resolveGroupByDivision('sideways', true)).toBe(true);
    expect(resolveGroupByDivision('', false)).toBe(false);
  });
});
