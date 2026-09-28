import { prisma } from '@/lib/db';
import { parseOrganizationParam } from '@/lib/organization-scope-shared';
import { taskBoardIdsInOrganization, type NamedStructureNode } from '@/lib/structure-shared';

/**
 * Every node of the organization tree, named, in Structure & hierarchy's own
 * order (kind, display order, name). Small — tens of rows — so it is read whole.
 */
export async function readNamedStructureTree(): Promise<NamedStructureNode[]> {
  return prisma.division.findMany({
    select: { id: true, name: true, kind: true, parentId: true, pmuParentDivisionId: true },
    orderBy: [{ kind: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
  });
}

/**
 * What a route handed `?org=` narrows its task read to (see
 * organization-scope-shared.ts):
 *
 *   - `null` — no narrowing: the param is absent, empty or 'all'. The tree is
 *     not read at all.
 *   - otherwise the division / PMU-team ids inside that organization, and its
 *     name for the report's header. An id that is not an organization gives no
 *     ids and no name, so it narrows to nothing rather than widening.
 */
export async function resolveOrganizationScope(
  value: string | null | undefined,
): Promise<{ organizationName: string | null; divisionIds: string[] } | null> {
  const organizationId = parseOrganizationParam(value);
  if (!organizationId) return null;
  const tree = await readNamedStructureTree();
  const organization = tree.find((n) => n.id === organizationId && n.kind === 'organization');
  return {
    organizationName: organization?.name ?? null,
    divisionIds: taskBoardIdsInOrganization(organizationId, tree),
  };
}
