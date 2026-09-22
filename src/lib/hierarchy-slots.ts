import type { HierarchySlot } from '@prisma/client';

/**
 * Hierarchy slots that carry the Director's powers.
 *
 * `regional_director` and `assistant_director` were added on 2026-09-22 for
 * Sports Authority of India officers. By product decision they have exactly
 * the Director's slot powers, in the divisions they are a member of (home or
 * admin-granted extra): manage and redefine every task there, set the
 * Daily / Weekly / Fortnight / Monthly / Watchlist lanes, change a Timeline
 * File's status, priority and documents — and they receive the notifications
 * Directors receive. Every rule that used to test `hierarchySlot ===
 * 'director'` asks isDirectorGrade (or queries DIRECTOR_GRADE_SLOTS) instead,
 * so the three can never drift apart.
 *
 * Rank is separate — see HIERARCHY_SLOT_LEVEL in labels.ts: Regional Director
 * sits with Director (level 3), Assistant Director with Under Secretary
 * (level 5).
 *
 * Client-safe: a type-only Prisma import, no database.
 */
export const DIRECTOR_GRADE_SLOTS: readonly HierarchySlot[] = [
  'director',
  'regional_director',
  'assistant_director',
];

/** Whether a hierarchy slot carries the Director's powers. */
export function isDirectorGrade(slot: string): boolean {
  return (DIRECTOR_GRADE_SLOTS as readonly string[]).includes(slot);
}
