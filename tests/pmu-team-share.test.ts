import { describe, expect, it } from 'vitest';

import { resolvePmuTeamShareOnCreate } from '@/lib/pmu-team-shared';

/** Shorthand — every case names only what it cares about. */
function resolve(over: Partial<Parameters<typeof resolvePmuTeamShareOnCreate>[0]> = {}) {
  return resolvePmuTeamShareOnCreate({
    targetIsPmu: false,
    divisionHasPmu: false,
    requested: undefined,
    ...over,
  });
}

describe('resolvePmuTeamShareOnCreate — a PMU’s own board', () => {
  it('shares by DEFAULT when no switch was shown', () => {
    // The point of the rule: a task created on a PMU board is the team's work,
    // so every member has it in their assigned list from the moment it exists.
    expect(resolve({ targetIsPmu: true, requested: undefined })).toBe(true);
  });

  it('honours an explicit on', () => {
    expect(resolve({ targetIsPmu: true, requested: true })).toBe(true);
  });

  it('honours an explicit OFF — the default is a default, not a forced value', () => {
    expect(resolve({ targetIsPmu: true, requested: false })).toBe(false);
  });

  it('ignores divisionHasPmu — a PMU has no PMUs under it', () => {
    for (const divisionHasPmu of [true, false]) {
      expect(resolve({ targetIsPmu: true, divisionHasPmu, requested: undefined })).toBe(true);
      expect(resolve({ targetIsPmu: true, divisionHasPmu, requested: false })).toBe(false);
    }
  });
});

describe('resolvePmuTeamShareOnCreate — a division’s board', () => {
  it('is OFF unless asked for — isolation is the norm', () => {
    expect(resolve({ divisionHasPmu: true, requested: undefined })).toBe(false);
    expect(resolve({ divisionHasPmu: true, requested: false })).toBe(false);
  });

  it('shares when asked for and the division has a PMU', () => {
    expect(resolve({ divisionHasPmu: true, requested: true })).toBe(true);
  });

  it('refuses when the division has no PMU — there is no audience', () => {
    // Matches the switch never being offered in that case, and the server
    // refusing it from setPmuTeamShareAction.
    expect(resolve({ divisionHasPmu: false, requested: true })).toBe(false);
  });

  it('treats "no switch shown" as off, never as a default on', () => {
    // The asymmetry with the PMU branch above, stated outright: a Timeline-File
    // spawn or a bulk import must not silently punch a hole in PMU isolation.
    expect(resolve({ divisionHasPmu: true, requested: undefined })).toBe(false);
  });
});
