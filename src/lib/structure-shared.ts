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

/** A tree node plus the name the pickers show. */
export type NamedStructureNode = StructureTreeNode & { name: string };

/** Where a unit sits: its organization and the containers in between. */
export type UnitPlacement = {
  /** `null` when the chain reaches no organization (a legacy root, a broken chain). */
  organization: { id: string; name: string } | null;
  /**
   * The containers between the organization and the unit's division, top
   * down: empty for a division directly under its organization,
   * `[RC Bengaluru]` for one inside that directorate.
   */
  path: { id: string; name: string }[];
};

/**
 * Where a division or PMU team sits. A PMU sits wherever its parent division
 * does (pmu_parent_division_id, falling back to parent_id) — it is placed
 * with that division, never on its own. Cycle-safe.
 */
export function placementOf(
  unitId: string,
  nodes: readonly NamedStructureNode[],
): UnitPlacement {
  return placeIn(new Map(nodes.map((n) => [n.id, n])), unitId);
}

/** placementOf over a prebuilt id map — so a batch builds the map once. */
function placeIn(byId: ReadonlyMap<string, NamedStructureNode>, unitId: string): UnitPlacement {
  const unit = byId.get(unitId);
  // A PMU is placed through its division; everything else from itself.
  const anchor = unit && unit.kind === 'pmu' ? byId.get(parentOf(unit) ?? '') : unit;
  const path: { id: string; name: string }[] = [];
  if (!anchor) return { organization: null, path };

  const seen = new Set<string>([anchor.id]);
  let up = parentOf(anchor);
  while (up && !seen.has(up)) {
    seen.add(up);
    const p = byId.get(up);
    if (!p) break;
    if (p.kind === 'organization') return { organization: { id: p.id, name: p.name }, path };
    path.unshift({ id: p.id, name: p.name });
    up = parentOf(p);
  }
  return { organization: null, path };
}

/** Units that share one place in the tree. */
export type PlacedGroup<T> = {
  /** Stable key for lists and pickers. */
  key: string;
  /** See UnitPlacement.path — empty means directly under the organization. */
  path: { id: string; name: string }[];
  units: T[];
};

export type PlacedOrganization<T> = {
  /** `null` collects units that sit in no organization; always listed last. */
  organization: { id: string; name: string } | null;
  /** Directly under the organization first, then each directorate. */
  groups: PlacedGroup<T>[];
  unitCount: number;
};

/**
 * Units grouped by the organization they sit in, then by the directorate(s)
 * above them — one grouping for every picker that must tell apart two
 * divisions both called "NCOE". Pass the units in display order; they keep it
 * inside their group.
 *
 * Organizations follow the tree's input order (callers pass it sorted by
 * kind, display order and name). With `includeEmptyOrganizations` every
 * organization is listed, even with no units — the user form offers one
 * before its first division exists; without it only organizations holding a
 * unit appear — Quick Create offers only where the caller may create.
 * Directorate groups follow the directorates' own tree order.
 */
export function groupByPlacement<T extends { id: string }>(
  units: readonly T[],
  nodes: readonly NamedStructureNode[],
  opts: { includeEmptyOrganizations?: boolean } = {},
): PlacedOrganization<T>[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const rank = (id: string) => order.get(id) ?? Number.MAX_SAFE_INTEGER;

  const byOrg = new Map<string | null, PlacedOrganization<T>>();
  const orgOrder: (string | null)[] = [];
  for (const n of nodes) {
    if (n.kind !== 'organization') continue;
    byOrg.set(n.id, { organization: { id: n.id, name: n.name }, groups: [], unitCount: 0 });
    orgOrder.push(n.id);
  }

  for (const unit of units) {
    const { organization, path } = placeIn(byId, unit.id);
    const orgId = organization?.id ?? null;
    let entry = byOrg.get(orgId);
    if (!entry) {
      entry = { organization: null, groups: [], unitCount: 0 };
      byOrg.set(orgId, entry);
      orgOrder.push(orgId);
    }
    const key = `${orgId ?? 'none'}:${path.map((p) => p.id).join('/')}`;
    let group = entry.groups.find((g) => g.key === key);
    if (!group) {
      group = { key, path, units: [] };
      entry.groups.push(group);
    }
    group.units.push(unit);
    entry.unitCount += 1;
  }

  const result: PlacedOrganization<T>[] = [];
  for (const id of orgOrder) {
    const entry = byOrg.get(id)!;
    if (entry.unitCount === 0 && !opts.includeEmptyOrganizations) continue;
    // Direct units first, then directorates in their own tree order.
    entry.groups.sort((a, b) => {
      const len = Math.min(a.path.length, b.path.length);
      for (let i = 0; i < len; i += 1) {
        const diff = rank(a.path[i].id) - rank(b.path[i].id);
        if (diff !== 0) return diff;
      }
      return a.path.length - b.path.length;
    });
    result.push(entry);
  }
  return result;
}

/** Divisions that share one place in the tree. */
export type DivisionGroup = {
  /** Stable key for lists. */
  key: string;
  /**
   * The containers between the organization and these divisions, top down:
   * empty for divisions directly under the organization, `[RC Bengaluru]`
   * for divisions inside that directorate.
   */
  path: { id: string; name: string }[];
  divisions: { id: string; name: string }[];
};

export type OrganizationDivisions = {
  /** `null` collects divisions that sit in no organization (a legacy root). */
  organization: { id: string; name: string } | null;
  /** Divisions directly under the organization first, then each directorate. */
  groups: DivisionGroup[];
  divisionCount: number;
};

/**
 * Every division, grouped by the organization it sits in and then by the
 * directorate(s) above it — what the user form needs to tell apart three
 * divisions all called "NCOE".
 *
 * Every organization is listed, even with no divisions yet, so one can be
 * chosen before its first division exists. Only `division` rows are grouped —
 * sub-divisions, sections and PMUs are placed through their division. A thin
 * view over groupByPlacement.
 */
export function groupDivisionsByOrganization(
  nodes: readonly NamedStructureNode[],
): OrganizationDivisions[] {
  const divisions = nodes
    .filter((n) => n.kind === 'division')
    .map((n) => ({ id: n.id, name: n.name }));
  return groupByPlacement(divisions, nodes, { includeEmptyOrganizations: true }).map((o) => ({
    organization: o.organization,
    groups: o.groups.map((g) => ({ key: g.key, path: g.path, divisions: g.units })),
    divisionCount: o.unitCount,
  }));
}
