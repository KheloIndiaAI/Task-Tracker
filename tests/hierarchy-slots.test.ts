import { HierarchySlot } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { DIRECTOR_GRADE_SLOTS, isDirectorGrade } from '@/lib/hierarchy-slots';
import { HIERARCHY_SLOT_LABEL, HIERARCHY_SLOT_LEVEL } from '@/lib/labels';
import { canManageTask, canSetJsPriorityLane } from '@/lib/rbac/rules';

const SGM = 'div-sgm';
const KI = 'div-ki';

describe('Director-grade hierarchy slots (2026-09-22)', () => {
  it('Director, Regional Director and Assistant Director are Director grade', () => {
    expect([...DIRECTOR_GRADE_SLOTS]).toEqual(['director', 'regional_director', 'assistant_director']);
    for (const slot of DIRECTOR_GRADE_SLOTS) expect(isDirectorGrade(slot)).toBe(true);
  });

  it('no other slot is — least of all the platform-wide ones', () => {
    const others = Object.values(HierarchySlot).filter(
      (s) => !(DIRECTOR_GRADE_SLOTS as readonly string[]).includes(s),
    );
    expect(others.sort()).toEqual(
      [
        'aso',
        'consultant',
        'deputy_secretary',
        'hmyas',
        'js',
        'osd',
        'section_officer',
        'under_secretary',
      ].sort(),
    );
    for (const slot of others) expect(isDirectorGrade(slot)).toBe(false);
  });

  it('ranks Regional Director with Director and Assistant Director with Under Secretary', () => {
    expect(HIERARCHY_SLOT_LABEL.regional_director).toBe('Regional Director');
    expect(HIERARCHY_SLOT_LABEL.assistant_director).toBe('Assistant Director');
    expect(HIERARCHY_SLOT_LEVEL.regional_director).toBe(HIERARCHY_SLOT_LEVEL.director);
    expect(HIERARCHY_SLOT_LEVEL.assistant_director).toBe(HIERARCHY_SLOT_LEVEL.under_secretary);
  });

  it('gives every slot in the database enum a label', () => {
    for (const slot of Object.values(HierarchySlot)) {
      expect(HIERARCHY_SLOT_LABEL[slot], slot).toBeTruthy();
    }
  });

  describe.each(DIRECTOR_GRADE_SLOTS)('%s has exactly the Director powers', (slot) => {
    const caller = {
      id: 'officer',
      isSuperAdmin: false,
      hierarchySlot: slot,
      memberDivisionIds: [SGM],
      headedDivisionIds: [] as string[],
    };
    const inSgm = { ownerId: 'someone', createdById: 'someone-else', divisionId: SGM };
    const inKi = { ownerId: 'someone', createdById: 'someone-else', divisionId: KI };

    it('manages and schedules every task in a division they belong to', () => {
      expect(canManageTask(caller, inSgm)).toBe(true);
      expect(canSetJsPriorityLane(caller, inSgm)).toBe(true);
    });

    it('but not in a division they do not belong to', () => {
      expect(canManageTask(caller, inKi)).toBe(false);
      expect(canSetJsPriorityLane(caller, inKi)).toBe(false);
    });
  });

  it('a Deputy Secretary — not Director grade — gets neither', () => {
    const caller = {
      id: 'ds',
      isSuperAdmin: false,
      hierarchySlot: 'deputy_secretary',
      memberDivisionIds: [SGM],
      headedDivisionIds: [] as string[],
    };
    const task = { ownerId: 'someone', createdById: 'someone-else', divisionId: SGM };
    expect(canManageTask(caller, task)).toBe(false);
    expect(canSetJsPriorityLane(caller, task)).toBe(false);
  });
});
