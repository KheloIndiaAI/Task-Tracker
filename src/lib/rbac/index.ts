import { prisma } from '@/lib/db';
import {
  expandHeadedToDescendants,
  isStructuralKind,
  organizationOf,
  type StructureTreeNode,
} from '@/lib/structure-shared';

import {
  canTransferTaskTo,
  type RbacActor,
  type RbacTarget,
} from './rules';

export * from './rules';

/**
 * DB-backed context builders for division-based RBAC.
 *
 * Everything here re-reads role state from the database — never from JWT
 * claims — so a head change, a delegation, or a division-membership grant takes
 * effect on the next request, not the next sign-in.
 *
 * Two distinct division sets per user, kept strictly separate:
 *   - `headedDivisionIds` — divisions the user holds HEAD powers over (direct
 *     headship + active delegations). Drives head-only powers: curation,
 *     delete, delegation, and creating division-visibility tasks. A member is
 *     never a head.
 *   - `memberDivisionIds` — divisions the user is a MEMBER of: their single
 *     home division (users.division_id) plus any admin-granted extra divisions
 *     (user_division_access). Drives member-level access: board visibility
 *     (tasks + Timeline Files), participation (collaborator / subtask assignee /
 *     @mention), being an assignment / transfer target, pulling unassigned
 *     tasks, and director-management. Membership NEVER confers head powers.
 *
 * The home `divisionId` alone still drives ownership, display, PMU home, and
 * reference-number identity. This admin-managed membership model replaces the
 * previously hardcoded cross-division link configs (KI↔NSDF allocation +
 * participant, and the per-username view grants) — cross-division reach is now
 * set per user via user_division_access, not in code.
 */

/** Every node in the organization tree — small (tens of rows), read whole. */
async function readStructureTree(): Promise<StructureTreeNode[]> {
  return prisma.division.findMany({
    select: { id: true, kind: true, parentId: true, pmuParentDivisionId: true },
  });
}

/**
 * Divisions the user holds head powers over right now:
 *
 *   - direct headships (divisions.head_user_id) — a division, or a
 *     directorate an Assistant Director heads;
 *   - active, unrevoked delegations of either;
 *   - the organization their home division sits in, when the Super-Admin-set
 *     "Organization head" toggle (users.is_organization_head) is on;
 *
 * and then, for every organization / directorate among those, every division
 * beneath it — heading a structural level means heading its divisions (see
 * expandHeadedToDescendants). This is the single place that cascade happens,
 * so every head check downstream — visibility, task management, delete,
 * notice board, lane curation, report access — inherits it without change.
 *
 * The hot path stays one round trip: the user's toggle is read alongside the
 * other two queries, and a user who heads only divisions (everyone before
 * 2026-09-21) gets back exactly the ids they always did. The tree is read —
 * a second round trip — only when a structural headship or the toggle exists.
 */
export async function getHeadedDivisionIds(
  userId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const [headed, delegated, user] = await Promise.all([
    prisma.division.findMany({
      where: { headUserId: userId },
      select: { id: true, kind: true },
    }),
    prisma.divisionAccessDelegation.findMany({
      where: {
        delegatedToId: userId,
        revokedAt: null,
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
      select: { divisionId: true, division: { select: { kind: true } } },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { divisionId: true, isOrganizationHead: true },
    }),
  ]);
  const ids = new Set<string>();
  let needsTree = user?.isOrganizationHead === true;
  for (const d of headed) {
    ids.add(d.id);
    if (isStructuralKind(d.kind)) needsTree = true;
  }
  for (const d of delegated) {
    ids.add(d.divisionId);
    if (isStructuralKind(d.division.kind)) needsTree = true;
  }
  if (!needsTree) return [...ids];

  const tree = await readStructureTree();
  if (user?.isOrganizationHead) {
    const org = organizationOf(user.divisionId, tree);
    if (org) ids.add(org);
  }
  return expandHeadedToDescendants([...ids], tree);
}

/**
 * Divisions the user is a MEMBER of right now: their single home division
 * (users.division_id) plus every admin-granted extra division
 * (user_division_access). Home is always included. This is the member set
 * consulted for board visibility, participation, assignment / transfer
 * targeting, pull, and director-management — NEVER for head powers.
 *
 * Returns `[homeDivisionId]` for the common case (no extra grants) plus any
 * extras, deduped. Returns [] only when the user is missing.
 */
export async function getMemberDivisionIds(userId: string): Promise<string[]> {
  const [user, extras] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { divisionId: true } }),
    prisma.userDivisionAccess.findMany({ where: { userId }, select: { divisionId: true } }),
  ]);
  if (!user) return [];
  const ids = new Set<string>([user.divisionId]);
  for (const e of extras) ids.add(e.divisionId);
  return [...ids];
}

/** Full RBAC view of one user, or null when the user is missing/disabled. */
export async function getRbacActor(userId: string): Promise<RbacActor | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      divisionId: true,
      isSuperAdmin: true,
      isActive: true,
      hierarchySlot: true,
    },
  });
  if (!user || !user.isActive) return null;
  const [headedDivisionIds, memberDivisionIds] = await Promise.all([
    getHeadedDivisionIds(userId),
    getMemberDivisionIds(userId),
  ]);
  return {
    id: user.id,
    divisionId: user.divisionId,
    isSuperAdmin: user.isSuperAdmin,
    isOsd: user.hierarchySlot === 'osd',
    headedDivisionIds,
    memberDivisionIds,
  };
}

/**
 * Who owns a task placed in a given division or PMU — resolved from
 * Structure & Hierarchy, the single source of truth:
 *   - PMU (kind = 'pmu')       → the active user with pmuRole
 *                                'pmu_team_leader' for that PMU.
 *   - Division / sub-div / section → the division's head
 *                                (divisions.head_user_id), if active.
 * Falls back to `fallbackOwnerId` (the creator, per product rule) when the
 * head or team leader is unset or inactive, so a task always has an owner.
 */
export async function resolveDivisionOwner(
  divisionId: string,
  fallbackOwnerId: string,
): Promise<string> {
  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    select: { kind: true, headUserId: true },
  });
  if (!division) return fallbackOwnerId;

  if (division.kind === 'pmu') {
    const leader = await prisma.user.findFirst({
      where: { pmuId: divisionId, pmuRole: 'pmu_team_leader', isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return leader?.id ?? fallbackOwnerId;
  }

  if (division.headUserId) {
    const head = await prisma.user.findUnique({
      where: { id: division.headUserId },
      select: { id: true, isActive: true },
    });
    if (head?.isActive) return head.id;
  }
  return fallbackOwnerId;
}

/**
 * Map of userId → divisions they head right now, for decorating candidate
 * lists without one query per user. The batch twin of getHeadedDivisionIds —
 * same three sources, same cascade — so a Regional Director is a head in a
 * transfer picker exactly when they are a head everywhere else.
 */
export async function getHeadedDivisionsByUser(
  now: Date = new Date(),
): Promise<Map<string, string[]>> {
  const [headRows, delegationRows, orgHeads, tree] = await Promise.all([
    prisma.division.findMany({
      where: { headUserId: { not: null } },
      select: { id: true, headUserId: true },
    }),
    prisma.divisionAccessDelegation.findMany({
      where: { revokedAt: null, startsAt: { lte: now }, endsAt: { gte: now } },
      select: { divisionId: true, delegatedToId: true },
    }),
    // Like head_user_id rows above, not filtered on isActive — the same
    // answer getHeadedDivisionIds gives for any one of these users.
    prisma.user.findMany({
      where: { isOrganizationHead: true },
      select: { id: true, divisionId: true },
    }),
    readStructureTree(),
  ]);
  const byUser = new Map<string, Set<string>>();
  const add = (userId: string, divisionId: string) => {
    const set = byUser.get(userId) ?? new Set<string>();
    set.add(divisionId);
    byUser.set(userId, set);
  };
  for (const r of headRows) if (r.headUserId) add(r.headUserId, r.id);
  for (const r of delegationRows) add(r.delegatedToId, r.divisionId);
  for (const u of orgHeads) {
    const org = organizationOf(u.divisionId, tree);
    if (org) add(u.id, org);
  }
  return new Map(
    [...byUser].map(([k, v]) => [k, expandHeadedToDescendants([...v], tree)]),
  );
}

/**
 * Map of userId → the divisions they are a MEMBER of (home division + granted
 * extras), for decorating candidate lists without one query per user. The
 * batch analogue of `getMemberDivisionIds`; mirrors `getHeadedDivisionsByUser`.
 * Keyed on active users; an access row for an inactive user is ignored.
 */
export async function getMemberDivisionsByUser(): Promise<Map<string, string[]>> {
  const [users, accessRows] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, divisionId: true } }),
    prisma.userDivisionAccess.findMany({ select: { userId: true, divisionId: true } }),
  ]);
  const byUser = new Map<string, Set<string>>();
  for (const u of users) byUser.set(u.id, new Set<string>([u.divisionId]));
  for (const a of accessRows) byUser.get(a.userId)?.add(a.divisionId);
  return new Map([...byUser].map(([k, v]) => [k, [...v]]));
}

/** RBAC view of a prospective transfer/assignment target. */
export async function getRbacTarget(userId: string): Promise<RbacTarget | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, divisionId: true, isSuperAdmin: true, isActive: true },
  });
  if (!user) return null;
  const [headedDivisionIds, memberDivisionIds] = await Promise.all([
    getHeadedDivisionIds(userId),
    getMemberDivisionIds(userId),
  ]);
  return {
    id: user.id,
    divisionId: user.divisionId,
    isSuperAdmin: user.isSuperAdmin,
    headedDivisionIds,
    memberDivisionIds,
    isActive: user.isActive,
  };
}

/**
 * Every user below `userId` in the supervisor chain (any depth). One
 * query over active users, BFS in memory — used to keep the legacy
 * "reassign downward within own chain" rule visible in pickers.
 */
export async function getSubordinateIds(userId: string): Promise<Set<string>> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, supervisorId: true },
  });
  const children = new Map<string, string[]>();
  for (const u of users) {
    if (!u.supervisorId) continue;
    const list = children.get(u.supervisorId) ?? [];
    list.push(u.id);
    children.set(u.supervisorId, list);
  }
  const result = new Set<string>();
  const queue = [...(children.get(userId) ?? [])];
  while (queue.length > 0) {
    const next = queue.pop()!;
    if (result.has(next)) continue;
    result.add(next);
    queue.push(...(children.get(next) ?? []));
  }
  return result;
}

export type TransferTargetRow = {
  id: string;
  name: string;
  designation: string;
  divisionName: string;
  divisionColour: string;
  /** Short role marker for the picker row: 'Super Admin' | 'Division head' | null. */
  badge: string | null;
};

/**
 * Everyone the actor may transfer a task to, per the transfer matrix in
 * rules.ts. One user-list query plus two role queries; filtering happens
 * in memory (the ministry has well under a thousand users).
 */
export async function fetchTransferTargets(actor: RbacActor): Promise<TransferTargetRow[]> {
  const [users, headedByUser, memberByUser] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, id: { not: actor.id } },
      select: {
        id: true,
        name: true,
        designation: true,
        divisionId: true,
        isSuperAdmin: true,
        division: { select: { name: true, avatarColour: true } },
      },
      orderBy: { name: 'asc' },
    }),
    getHeadedDivisionsByUser(),
    getMemberDivisionsByUser(),
  ]);

  return users
    .filter((u) =>
      canTransferTaskTo(actor, {
        id: u.id,
        divisionId: u.divisionId,
        isSuperAdmin: u.isSuperAdmin,
        headedDivisionIds: headedByUser.get(u.id) ?? [],
        memberDivisionIds: memberByUser.get(u.id) ?? [u.divisionId],
        isActive: true,
      }),
    )
    .map((u) => ({
      id: u.id,
      name: u.name,
      designation: u.designation,
      divisionName: u.division.name,
      divisionColour: u.division.avatarColour,
      badge: u.isSuperAdmin
        ? 'Super Admin'
        : (headedByUser.get(u.id) ?? []).length > 0
          ? 'Division head'
          : null,
    }));
}
