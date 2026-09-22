import type { StructureKind } from '@/lib/structure-shared';

/**
 * "Sort by division" ordering for the Super Admin → Users list.
 *
 * Pure, database-free so it can be unit-tested in isolation (the DB-backed
 * page passes it the already-fetched users + divisions).
 *
 * Ordering, per the product spec:
 *   1. Group users under their top-level division (structure display order,
 *      then name) so everyone in a division sits together.
 *   2. Within a division, order by placement tier:
 *        0 — division-direct members
 *        1 — sub-division members
 *        2 — section members
 *        3 — PMU team members
 *   3. Within a tier, cluster by the specific sub-unit (its display order,
 *      then name) so one sub-division / section / PMU stays contiguous.
 *   4. Finally alphabetical by person name, then username as a stable
 *      tiebreaker.
 */

export type OrderableUser = {
  id: string;
  name: string;
  username: string;
  divisionId: string;
  subDivisionId: string | null;
  sectionId: string | null;
  pmuId: string | null;
  isPmu: boolean;
};

export type OrderableDivision = {
  id: string;
  name: string;
  kind: StructureKind;
  parentId: string | null;
  pmuParentDivisionId: string | null;
  displayOrder: number;
};

/** Placement tier within a division — lower sorts first. */
export const DIVISION_TIER = { division: 0, subDivision: 1, section: 2, pmu: 3 } as const;

type DivIndex = Map<string, OrderableDivision>;

/**
 * Walk up parent / PMU-parent links until a top-level division is reached.
 * Falls back to the starting id if the chain is broken or missing (so an
 * orphaned record still groups deterministically rather than throwing).
 */
function topDivisionId(divId: string, byId: DivIndex): string {
  let cur = byId.get(divId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    if (cur.kind === 'division') return cur.id;
    seen.add(cur.id);
    const nextId = cur.kind === 'pmu' ? cur.pmuParentDivisionId : cur.parentId;
    if (!nextId) return cur.id;
    cur = byId.get(nextId);
  }
  return divId;
}

function tierOf(u: OrderableUser): number {
  // A PMU member is flagged either by isPmu or by carrying a pmuId; the
  // team always sorts last within its division.
  if (u.isPmu || u.pmuId) return DIVISION_TIER.pmu;
  if (u.sectionId) return DIVISION_TIER.section;
  if (u.subDivisionId) return DIVISION_TIER.subDivision;
  return DIVISION_TIER.division;
}

/** The id of the sub-unit a user sits in for its tier, or null at division level. */
function subUnitId(u: OrderableUser, tier: number): string | null {
  if (tier === DIVISION_TIER.pmu) return u.pmuId;
  if (tier === DIVISION_TIER.section) return u.sectionId;
  if (tier === DIVISION_TIER.subDivision) return u.subDivisionId;
  return null;
}

/**
 * Return a new array of the users ordered "by division". Stable and pure —
 * the input array is not mutated.
 */
export function orderUsersByDivision<T extends OrderableUser>(
  users: T[],
  divisions: OrderableDivision[],
): T[] {
  const byId: DivIndex = new Map(divisions.map((d) => [d.id, d]));

  const keyFor = (u: T) => {
    const topId = topDivisionId(u.divisionId, byId);
    const top = byId.get(topId);
    const tier = tierOf(u);
    const subId = subUnitId(u, tier);
    const sub = subId ? byId.get(subId) : undefined;
    return {
      topOrder: top?.displayOrder ?? 0,
      topName: top?.name ?? '',
      topId,
      tier,
      subOrder: sub?.displayOrder ?? 0,
      subName: sub?.name ?? '',
      subId: subId ?? '',
    };
  };

  const keyed = users.map((u) => ({ u, k: keyFor(u) }));

  keyed.sort((a, b) => {
    const ka = a.k;
    const kb = b.k;
    if (ka.topOrder !== kb.topOrder) return ka.topOrder - kb.topOrder;
    if (ka.topName !== kb.topName) return ka.topName.localeCompare(kb.topName);
    if (ka.topId !== kb.topId) return ka.topId.localeCompare(kb.topId);
    if (ka.tier !== kb.tier) return ka.tier - kb.tier;
    if (ka.subOrder !== kb.subOrder) return ka.subOrder - kb.subOrder;
    if (ka.subName !== kb.subName) return ka.subName.localeCompare(kb.subName);
    if (ka.subId !== kb.subId) return ka.subId.localeCompare(kb.subId);
    const byName = a.u.name.localeCompare(b.u.name);
    if (byName !== 0) return byName;
    return a.u.username.localeCompare(b.u.username);
  });

  return keyed.map((x) => x.u);
}
