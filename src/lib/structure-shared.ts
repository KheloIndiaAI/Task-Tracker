import type { DivisionKind } from '@prisma/client';

/**
 * Structure & hierarchy — the pure rules for the organization tree.
 *
 * Client-safe (type-only Prisma import, no database), so the admin UI, the
 * server actions and the unit tests share one definition — the same split as
 * the other `*-shared.ts` modules.
 *
 * The tree, top down:
 *
 *   organization  root. "Ministry Headquarter" holds the original ministry
 *                 structure; each Regional Centre is another organization.
 *   directorate   optional middle layer an Assistant Director heads.
 *   division      carries tasks. Parent: an organization or a directorate.
 *   sub_division  categorises within a division.
 *   section       categorises within a sub-division.
 *   pmu           a PMU team, attached to a division.
 */

export type StructureKind = DivisionKind;

/** Every kind, in tree order from the root down. */
export const STRUCTURE_KINDS: readonly StructureKind[] = [
  'organization',
  'directorate',
  'division',
  'sub_division',
  'section',
  'pmu',
];

/** Sentence-case display names, one source for every surface. */
export const STRUCTURE_KIND_LABEL: Record<StructureKind, string> = {
  organization: 'Organization',
  directorate: 'Directorate',
  division: 'Division',
  sub_division: 'Sub-division',
  section: 'Section',
  pmu: 'PMU team',
};

/**
 * Levels that exist only to GROUP divisions. They carry no tasks, no members'
 * home placement, and no task board of their own; heading one means heading
 * every division beneath it (see expandHeadedToDescendants).
 */
export function isStructuralKind(kind: StructureKind): boolean {
  return kind === 'organization' || kind === 'directorate';
}

/**
 * The only kinds a task may live on. Everything that writes a task's
 * `division_id` — create, move, Timeline-File spawn — refuses any other kind,
 * so an organization or directorate can never end up holding a task.
 */
export function isTaskBoardKind(kind: StructureKind): boolean {
  return kind === 'division' || kind === 'pmu';
}

/**
 * Which kinds may be a node's parent. `null` in the list means "may be a root".
 * A PMU is not in this matrix: it attaches by `pmu_parent_division_id`, to a
 * division, and is validated separately.
 *
 * A division's parent is REQUIRED from 2026-09-21: every division sits in an
 * organization, directly (Ministry Headquarter's divisions) or through a
 * directorate (a Regional Centre's KIC, STC, NCOE, KISCE).
 */
export function allowedParentKinds(kind: StructureKind): ReadonlyArray<StructureKind | null> {
  switch (kind) {
    case 'organization':
      return [null];
    case 'directorate':
      return ['organization'];
    case 'division':
      return ['organization', 'directorate'];
    case 'sub_division':
      return ['division'];
    case 'section':
      return ['sub_division'];
    case 'pmu':
      return [];
  }
}

/** The shape the tree rules need from a `divisions` row. */
export type StructureTreeNode = {
  id: string;
  kind: StructureKind;
  parentId: string | null;
  pmuParentDivisionId: string | null;
};

/** A node's parent in the tree — a PMU by its PMU parent, falling back. */
function parentOf(n: StructureTreeNode): string | null {
  return n.kind === 'pmu' ? n.pmuParentDivisionId ?? n.parentId : n.parentId;
}

/**
 * The organization a node sits in — walking up from any node to the root.
 * `null` when the chain ends without reaching one (a legacy root, or a broken
 * chain), so a caller fails closed rather than guessing. Cycle-safe.
 */
export function organizationOf(
  nodeId: string,
  nodes: readonly StructureTreeNode[],
): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  let cur = byId.get(nodeId);
  while (cur && !seen.has(cur.id)) {
    if (cur.kind === 'organization') return cur.id;
    seen.add(cur.id);
    const up = parentOf(cur);
    cur = up ? byId.get(up) : undefined;
  }
  return null;
}

/**
 * The cascade: heading an organization or a directorate means heading every
 * DIVISION beneath it.
 *
 * Returns the input ids plus, for each organization / directorate among them,
 * every division in its subtree. Anything else passes through untouched —
 * which is the point. A division head's powers are EXACTLY what they were:
 * this never adds a division's PMUs, sub-divisions or sections, and never
 * touches a division id that came in directly.
 *
 * Deliberately divisions only, not PMUs: an organization head becomes, in
 * effect, the head of each division beneath them, and so reaches those
 * divisions' PMUs through the same rules any division head already does
 * (PMU boards folded into visibility, PMUs offered as create targets) — no
 * new PMU semantics, no second definition of what a head may do.
 *
 * Cycle-safe; order of the result is not significant.
 */
export function expandHeadedToDescendants(
  headedIds: readonly string[],
  nodes: readonly StructureTreeNode[],
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    const up = parentOf(n);
    if (!up) continue;
    const list = children.get(up) ?? [];
    list.push(n.id);
    children.set(up, list);
  }

  const out = new Set(headedIds);
  const seen = new Set<string>();
  const stack = headedIds.filter((id) => {
    const n = byId.get(id);
    return n !== undefined && isStructuralKind(n.kind);
  });
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const childId of children.get(id) ?? []) {
      const child = byId.get(childId);
      if (!child) continue;
      if (child.kind === 'division') out.add(child.id);
      // Only structural levels are walked into; a division is a leaf here.
      else if (isStructuralKind(child.kind)) stack.push(child.id);
    }
  }
  return [...out];
}
