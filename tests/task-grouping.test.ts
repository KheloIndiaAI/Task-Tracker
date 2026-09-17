import { describe, expect, it } from 'vitest';

import { resolveGroupByDivision } from '@/lib/task-grouping-shared';

/**
 * The per-role gate this file used to cover (`canGroupTasksByDivision` /
 * `opensTasksGrouped`) is gone: every user lands on the division board, so
 * there is nothing left to decide per caller and the page passes `true`
 * outright. What survives is the `?group=` override, which is what keeps the
 * flat card list reachable for anyone who wants it.
 */
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

  it('opens grouped with no query string at all — the landing case', () => {
    // The page passes `true`, so this is what every user gets on /tasks.
    expect(resolveGroupByDivision(undefined, true)).toBe(true);
  });

  it('?group=none is the opt-out, and survives the always-on default', () => {
    // The whole reason the param stays tri-state: without it, switching off
    // would drop the param and immediately re-apply the default.
    expect(resolveGroupByDivision('none', true)).toBe(false);
  });

  it('treats an unrecognised value as absent', () => {
    expect(resolveGroupByDivision('sideways', true)).toBe(true);
    expect(resolveGroupByDivision('', true)).toBe(true);
    expect(resolveGroupByDivision('', false)).toBe(false);
  });
});
