import { describe, expect, it } from 'vitest';

import {
  canGroupTasksByDivision,
  opensTasksGrouped,
  resolveGroupByDivision,
  type TaskGroupingActor,
} from '@/lib/task-grouping-shared';

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

const DIV_A = 'div-a';
const DIV_B = 'div-b';

function actor(over: Partial<TaskGroupingActor> = {}): TaskGroupingActor {
  return {
    isSuperAdmin: false,
    hierarchySlot: 'section_officer',
    headedDivisionIds: [],
    memberDivisionIds: [DIV_A],
    ...over,
  };
}

describe('canGroupTasksByDivision', () => {
  it('offers the grouped view to leadership', () => {
    expect(canGroupTasksByDivision(actor({ isSuperAdmin: true }))).toBe(true);
    expect(canGroupTasksByDivision(actor({ hierarchySlot: 'osd' }))).toBe(true);
    expect(canGroupTasksByDivision(actor({ hierarchySlot: 'js' }))).toBe(true);
  });

  it('offers it to a division head, whatever their slot', () => {
    // The head of one division, sitting in that single division — the case the
    // flat view used to trap, hiding the Notice board and lane board from the
    // very person who may edit them.
    expect(
      canGroupTasksByDivision(
        actor({ hierarchySlot: 'director', headedDivisionIds: [DIV_A] }),
      ),
    ).toBe(true);
    expect(
      canGroupTasksByDivision(
        actor({ hierarchySlot: 'under_secretary', headedDivisionIds: [DIV_A] }),
      ),
    ).toBe(true);
  });

  it('offers it to an active delegate, since headedDivisionIds covers both', () => {
    // A delegate heads a division they are not a member of.
    expect(
      canGroupTasksByDivision(
        actor({ headedDivisionIds: [DIV_B], memberDivisionIds: [DIV_A] }),
      ),
    ).toBe(true);
  });

  it('offers it to a multi-division member', () => {
    expect(canGroupTasksByDivision(actor({ memberDivisionIds: [DIV_A, DIV_B] }))).toBe(true);
  });

  it('withholds it from a single-division non-head', () => {
    expect(canGroupTasksByDivision(actor())).toBe(false);
    expect(canGroupTasksByDivision(actor({ hierarchySlot: 'director' }))).toBe(false);
  });
});

describe('opensTasksGrouped', () => {
  it('lands leadership and division heads on the division board', () => {
    expect(opensTasksGrouped(actor({ isSuperAdmin: true }))).toBe(true);
    expect(opensTasksGrouped(actor({ hierarchySlot: 'osd' }))).toBe(true);
    expect(opensTasksGrouped(actor({ hierarchySlot: 'js' }))).toBe(true);
    expect(opensTasksGrouped(actor({ headedDivisionIds: [DIV_A] }))).toBe(true);
  });

  it('lands a multi-division member flat, though they may still group', () => {
    const multi = actor({ memberDivisionIds: [DIV_A, DIV_B] });
    expect(canGroupTasksByDivision(multi)).toBe(true);
    expect(opensTasksGrouped(multi)).toBe(false);
  });

  it('lands a single-division non-head flat', () => {
    expect(opensTasksGrouped(actor())).toBe(false);
  });

  it('never defaults anyone into a view they cannot have', () => {
    const cases: TaskGroupingActor[] = [
      actor(),
      actor({ isSuperAdmin: true }),
      actor({ hierarchySlot: 'osd' }),
      actor({ hierarchySlot: 'js' }),
      actor({ hierarchySlot: 'director' }),
      actor({ headedDivisionIds: [DIV_A] }),
      actor({ headedDivisionIds: [DIV_B], memberDivisionIds: [DIV_A] }),
      actor({ memberDivisionIds: [DIV_A, DIV_B] }),
    ];
    for (const a of cases) {
      if (opensTasksGrouped(a)) expect(canGroupTasksByDivision(a)).toBe(true);
    }
  });
});
