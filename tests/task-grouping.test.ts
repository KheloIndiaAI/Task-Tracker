import { describe, expect, it } from 'vitest';

import { groupParamFor, resolveGroupByDivision } from '@/lib/task-grouping-shared';

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

describe('groupParamFor', () => {
  it('writes an explicit off when grouping is on by default', () => {
    // The bug this guards: clearing the param would re-apply the default and
    // leave a Super Admin unable to turn grouping off.
    expect(groupParamFor(false, true)).toBe('none');
  });

  it('clears the param when grouping is off by default', () => {
    expect(groupParamFor(false, false)).toBe('');
  });

  it('always writes division when switching on', () => {
    expect(groupParamFor(true, true)).toBe('division');
    expect(groupParamFor(true, false)).toBe('division');
  });
});

describe('toggle round-trip', () => {
  // What the button actually does: write groupParamFor(!current), then the
  // page resolves that back. One flip must land on the opposite state, and a
  // second flip must return to the start — for both kinds of caller.
  for (const defaultGrouped of [true, false]) {
    it(`settles correctly for a caller whose default is ${defaultGrouped}`, () => {
      const start = resolveGroupByDivision(undefined, defaultGrouped);
      expect(start).toBe(defaultGrouped);

      const afterFirst = resolveGroupByDivision(
        groupParamFor(!start, defaultGrouped),
        defaultGrouped,
      );
      expect(afterFirst).toBe(!start);

      const afterSecond = resolveGroupByDivision(
        groupParamFor(!afterFirst, defaultGrouped),
        defaultGrouped,
      );
      expect(afterSecond).toBe(start);
    });
  }
});
