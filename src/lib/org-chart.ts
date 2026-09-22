import type { StructureKind } from '@/lib/structure-shared';

/**
 * Pure org-chart partition — no React, no DB, so it is unit-testable.
 *
 * Splits a flat officer list into the three regions the hierarchy mapper
 * renders: the Unassigned pool, the chart roots, and each supervisor's
 * direct reports. The contract is TOTALITY: every input id appears
 * exactly once across (unassigned ∪ roots ∪ all children). No officer can
 * be silently dropped from the chart — the failure that hid PMU members
 * whose reporting line passed through someone outside the current view.
 */

export type ChartNodeInput = {
  id: string;
  /** null → no supervisor; may point outside the given node set. */
  supervisorId: string | null;
};

export type OrgPartition = {
  /** Officers with no supervisor — rendered in the Unassigned pool. */
  unassignedIds: string[];
  /** Top-of-chart officers (supervisor outside the view, or promoted). */
  rootIds: string[];
  /** parentId → direct-report ids, in input order; only reachable edges. */
  childrenByParent: Map<string, string[]>;
};

export function partitionOrgChart(nodes: ChartNodeInput[]): OrgPartition {
  const inView = new Set(nodes.map((n) => n.id));

  const unassignedIds: string[] = [];
  const chart: ChartNodeInput[] = [];
  for (const n of nodes) {
    if (!n.supervisorId) unassignedIds.push(n.id);
    else chart.push(n);
  }

  // Edges only between two in-view officers.
  const childrenByParent = new Map<string, string[]>();
  for (const n of chart) {
    if (n.supervisorId && inView.has(n.supervisorId)) {
      const list = childrenByParent.get(n.supervisorId) ?? [];
      list.push(n.id);
      childrenByParent.set(n.supervisorId, list);
    }
  }

  // Roots: supervisor is not another in-view officer.
  const rootIds = chart
    .filter((n) => !n.supervisorId || !inView.has(n.supervisorId))
    .map((n) => n.id);

  // Reachability sweep. Anything the roots cannot reach — a subtree whose
  // top reports to someone in the Unassigned pool, or a supervisor cycle —
  // is promoted to a root so it still renders, and its dangling child edge
  // is dropped so it is not ALSO nested somewhere.
  const reached = new Set<string>();
  const sweep = (startId: string) => {
    const stack = [startId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (reached.has(id)) continue;
      reached.add(id);
      for (const kid of childrenByParent.get(id) ?? []) stack.push(kid);
    }
  };
  for (const id of rootIds) sweep(id);

  for (const n of chart) {
    if (reached.has(n.id)) continue;
    rootIds.push(n.id);
    if (n.supervisorId) {
      const siblings = childrenByParent.get(n.supervisorId);
      if (siblings) {
        childrenByParent.set(
          n.supervisorId,
          siblings.filter((k) => k !== n.id),
        );
      }
    }
    sweep(n.id);
  }

  return { unassignedIds, rootIds, childrenByParent };
}

/**
 * Collect an officer plus their entire reporting subtree (all transitive
 * subordinates) — the "team" that moves together when the officer is
 * dragged onto a different unit. Cycle-safe: each id is visited once.
 * The root is always included, even with no reports (a team of one).
 */
export function collectReportingSubtree(
  edges: ChartNodeInput[],
  rootId: string,
): string[] {
  const children = new Map<string, string[]>();
  for (const e of edges) {
    if (!e.supervisorId) continue;
    const list = children.get(e.supervisorId) ?? [];
    list.push(e.id);
    children.set(e.supervisorId, list);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    for (const kid of children.get(id) ?? []) stack.push(kid);
  }
  return result;
}

/**
 * A structural unit — the shape needed to resolve a full placement for
 * someone moved into it.
 */
export type UnitNode = {
  id: string;
  kind: StructureKind;
  parentId: string | null;
  pmuParentDivisionId: string | null;
};

/**
 * The complete, self-consistent placement a user takes when moved into a
 * unit. Every ancestor field is set so the division/sub-division/section
 * chain stays valid, and PMU membership is mutually exclusive with the
 * sub-division/section ladder.
 */
export type UnitPlacement = {
  divisionId: string;
  subDivisionId: string | null;
  sectionId: string | null;
  pmuId: string | null;
  isPmu: boolean;
};

/**
 * Resolve the placement for dropping a team onto `target`. Returns an
 * error message when the unit's ancestor chain is broken (e.g. a section
 * whose sub-division or division is missing), so the caller can refuse
 * the move rather than write an inconsistent row.
 */
export function resolveUnitPlacement(
  target: UnitNode,
  nodeById: Map<string, UnitNode>,
): UnitPlacement | { error: string } {
  switch (target.kind) {
    // People are placed in divisions. An organization or directorate only
    // groups divisions, so dropping someone on one would leave their home
    // division pointing at a container — refused here rather than written.
    case 'organization':
    case 'directorate':
      return {
        error:
          'People belong to a division. Drop them onto a division, sub-division, section or PMU inside it.',
      };
    case 'division':
      return {
        divisionId: target.id,
        subDivisionId: null,
        sectionId: null,
        pmuId: null,
        isPmu: false,
      };
    case 'sub_division': {
      if (!target.parentId) return { error: 'This sub-division has no parent division.' };
      return {
        divisionId: target.parentId,
        subDivisionId: target.id,
        sectionId: null,
        pmuId: null,
        isPmu: false,
      };
    }
    case 'section': {
      const sub = target.parentId ? nodeById.get(target.parentId) : undefined;
      if (!sub || !sub.parentId) {
        return { error: 'This section is missing its sub-division or division.' };
      }
      return {
        divisionId: sub.parentId,
        subDivisionId: sub.id,
        sectionId: target.id,
        pmuId: null,
        isPmu: false,
      };
    }
    case 'pmu': {
      const home = target.pmuParentDivisionId ?? target.parentId;
      if (!home) return { error: 'This PMU is not attached to a division.' };
      return {
        divisionId: home,
        subDivisionId: null,
        sectionId: null,
        pmuId: target.id,
        isPmu: true,
      };
    }
    default:
      return { error: 'Unknown unit type.' };
  }
}
