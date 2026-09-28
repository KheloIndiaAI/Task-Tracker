import {
  findMinistryHeadquarter,
  organizationOf,
  type StructureTreeNode,
} from '@/lib/structure-shared';

/**
 * Organization scope — the Super Admin's organization pills on the tasks
 * board, and the report dialog's Organization dropdown.
 *
 * Pure and prisma-free, so the page, the two routes it hands `?org=` to (the
 * KPI drill-downs and the report) and the unit tests share one rule — the same
 * split as task-grouping-shared.ts.
 *
 * `?org=` says which organization's boards to read:
 *
 *   'all'  → every organization — the board as it was before the pills.
 *   <id>   → that organization's divisions and PMU teams.
 *   absent → Ministry Headquarter, the default; every organization when no
 *            organization carries that name.
 *
 * It only ever NARROWS. Every read it scopes is visibility-scoped already, and
 * it adds `division_id IN (…)` on top, so it can never reveal a task the reader
 * could not otherwise see.
 */

/** The `?org=` value, and dropdown value, that means every organization. */
export const ALL_ORGANIZATIONS = 'all';

/** Sentence-case label for that choice, one source for every surface. */
export const ALL_ORGANIZATIONS_LABEL = 'All organizations';

/**
 * The organization a route handed `?org=` narrows to — `null` for none:
 * absent, empty, or 'all'. Anything else is returned as given; whether it
 * names an organization is the caller's lookup, and one that does not narrows
 * to nothing (see taskBoardIdsInOrganization).
 */
export function parseOrganizationParam(value: string | null | undefined): string | null {
  const v = value?.trim() ?? '';
  return v === '' || v === ALL_ORGANIZATIONS ? null : v;
}

/**
 * Which organization the Super Admin's tasks board shows — an id from
 * `organizations`, or `null` for every organization.
 *
 *   1. `?org=all` → every organization.
 *   2. `?division=` set → the organization that division sits in. A link
 *      straight to a division (the KPI panel's Open-tasks list) must land on a
 *      board that holds it, whatever `?org=` says; an organization it is not in
 *      would show an empty board. A division in no listed organization — a
 *      legacy root, a broken chain, an unknown id — opens every organization,
 *      so a division asked for by name is never hidden by the default.
 *   3. `?org=<id>` naming a listed organization → that one.
 *   4. Otherwise (absent, stale, or hand-typed) → Ministry Headquarter, or
 *      every organization when none carries that name.
 */
export function resolveBoardOrganization(
  params: { org?: string | null; division?: string | null },
  organizations: readonly { id: string; name: string }[],
  nodes: readonly StructureTreeNode[],
): string | null {
  const org = params.org?.trim() ?? '';
  const division = params.division?.trim() ?? '';
  const listed = (id: string | null): id is string =>
    id !== null && organizations.some((o) => o.id === id);

  if (org === ALL_ORGANIZATIONS) return null;
  if (division !== '') {
    const home = organizationOf(division, nodes);
    return listed(home) ? home : null;
  }
  if (listed(org)) return org;
  return findMinistryHeadquarter(organizations)?.id ?? null;
}

/**
 * The report dialog's opening organization: Ministry Headquarter when it is
 * offered, else the first organization offered, else every organization (the
 * dialog then has no organization to choose).
 */
export function defaultReportOrganization(
  organizations: readonly { id: string; name: string }[],
): string {
  return (
    findMinistryHeadquarter(organizations)?.id ?? organizations[0]?.id ?? ALL_ORGANIZATIONS
  );
}
