import type { Prisma, Task } from '@prisma/client';

import { startOfDayIST, endOfDayIST } from '@/lib/date';
import { prisma } from '@/lib/db';
import { USER_SUMMARY_SELECT } from '@/lib/prisma-selects';
import { getPmuTeamMemberIds } from '@/lib/pmu-team';
import { getHeadedDivisionIds, getMemberDivisionIds } from '@/lib/rbac';
import {
  buildVisibilityClausesFrom,
  type CallerSummary,
} from '@/lib/visibility-rules';

/**
 * Server-side visibility scoper for tasks.
 *
 * Division-wide model: every ministry (non-PMU) officer sees all
 * non-personal tasks in their own division, regardless of hierarchy slot —
 * a newly created division user sees the division's tasks from first
 * login. JS and OSD keep their wider surfaces; PMU isolation is unchanged.
 *
 * Division heads additionally see every division they head — direct
 * headship (divisions.head_user_id) plus active access delegations. That
 * is how Mohd Zuber (home: Autonomous Bodies) also sees NSDF, and how a
 * delegate sees the delegated division for the window's duration.
 *
 * Personal-visibility tasks are NEVER returned to anyone but their owner,
 * including Super Admin and OSD.
 */

export type TaskFilter = 'all' | 'today' | 'overdue' | 'mine' | 'urgent' | 'completed' | 'js_priority';

/**
 * List ordering:
 *   - `default` — the smart order (JS Priority lane, then due date, then
 *     priority, then newest).
 *   - `latest`  — "Recently modified": most recent meaningful activity first
 *     (Task.lastActivityAt desc). A freshly created task has
 *     lastActivityAt = createdAt, so new tasks also land on top.
 *   - `alpha`   — A–Z by task name.
 */
export type TaskSort = 'default' | 'latest' | 'alpha';

/**
 * Prisma `orderBy` for the tasks list, by sort mode. Pure and exported so the
 * ordering is unit-testable without a database. Every branch ends with a
 * deterministic tiebreaker so equal leading keys never reorder run to run.
 */
export function taskListOrderBy(
  sort: TaskSort,
): Prisma.TaskOrderByWithRelationInput[] {
  switch (sort) {
    case 'latest':
      return [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }];
    case 'alpha':
      return [{ name: 'asc' }, { createdAt: 'desc' }];
    case 'default':
    default:
      return [
        { jsPriorityLane: { sort: 'asc', nulls: 'last' } },
        { dueDate: { sort: 'asc', nulls: 'last' } },
        { priority: 'desc' },
        { createdAt: 'desc' },
      ];
  }
}

export { buildVisibilityClausesFrom };
export type { CallerSummary };

/**
 * Every active user in the caller's PMU — themselves plus their PMU
 * teammates (same `pmu_id`). Empty when the caller is not a PMU member or
 * their PMU is unset. Drives the owner-scoped PMU visibility clause so a
 * PMU team member sees their team's tasks but not the whole division.
 */
export async function getPmuTeammateIds(userId: string): Promise<string[]> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { pmuId: true },
  });
  if (!me?.pmuId) return [];
  const teammates = await prisma.user.findMany({
    where: { pmuId: me.pmuId, isActive: true },
    select: { id: true },
  });
  return teammates.map((u) => u.id);
}

/**
 * The user id of the head of a PMU's home (parent) ministry division, or
 * null when the PMU or its parent has no head. A PMU (`kind = 'pmu'`) never
 * carries its own `head_user_id`; its head is the head of the division named
 * by `pmu_parent_division_id` (falling back to `parent_id` for legacy rows).
 * This is the "Division head" excluded from a whole-PMU-team share.
 */
/**
 * The PMUs attached to any of `divisionIds` — the reverse of
 * `getPmuParentDivisionHeadId`. Empty when the caller holds no divisions.
 *
 * A PMU is matched on EITHER `pmu_parent_division_id` or `parent_id`, not the
 * `??` fallback used when resolving a PMU's single "home". That is deliberate:
 * where the two fields name different divisions, both divisions' officers see
 * the PMU — which is how one PMU serves a pair of related divisions (KI PMU
 * across Khelo India and Khelo India Mission). It mirrors the placement check
 * in admin-users.ts, which likewise accepts a user whose division matches
 * either field.
 *
 * Used to fold a division's PMUs into its people's visibility: the create side
 * already treats "divisions I head plus those divisions' PMUs" as one set (see
 * the create targets in src/app/(app)/layout.tsx), and this is the read side of
 * the same idea.
 */
export async function getPmuDivisionIdsFor(divisionIds: string[]): Promise<string[]> {
  if (divisionIds.length === 0) return [];
  const pmus = await prisma.division.findMany({
    where: {
      kind: 'pmu',
      OR: [
        { pmuParentDivisionId: { in: divisionIds } },
        { parentId: { in: divisionIds } },
      ],
    },
    select: { id: true },
  });
  return pmus.map((p) => p.id);
}

export async function getPmuParentDivisionHeadId(pmuId: string): Promise<string | null> {
  const pmu = await prisma.division.findUnique({
    where: { id: pmuId },
    select: { pmuParentDivisionId: true, parentId: true },
  });
  const parentId = pmu?.pmuParentDivisionId ?? pmu?.parentId ?? null;
  if (!parentId) return null;
  const parent = await prisma.division.findUnique({
    where: { id: parentId },
    select: { headUserId: true },
  });
  return parent?.headUserId ?? null;
}

/**
 * Build the OR-of-visibility-clauses for a caller.
 * Returns clauses that are then composed with the filter clause in the page.
 */
export async function buildVisibilityClauses(me: CallerSummary): Promise<Prisma.TaskWhereInput[]> {
  const [headedDivisionIds, memberDivisionIds, pmuMemberIds, pmuParentHeadId, pmuTeamLeaderMemberIds, personalGrant] = await Promise.all([
    getHeadedDivisionIds(me.id),
    // Member divisions (home + admin-granted extras). Resolved by id here so
    // every task-read caller (list, counts, stats, search, calendar, priority
    // board, attachments, profile, task detail) picks up multi-division board
    // visibility without touching its own `me` select.
    getMemberDivisionIds(me.id),
    me.isPmu ? getPmuTeammateIds(me.id) : Promise.resolve<string[]>([]),
    me.isPmu && me.pmuId
      ? getPmuParentDivisionHeadId(me.pmuId)
      : Promise.resolve<string | null>(null),
    // Owner-scoped read access for a PMU team leader over their team's tasks
    // (empty for everyone else). Resolved here so every task-read surface picks
    // it up uniformly.
    me.isPmu ? getPmuTeamMemberIds(me.id) : Promise.resolve<string[]>([]),
    // The Super-Admin-managed "Personal task visibility" grant. Resolved here,
    // by id, so every task-read surface picks it up without adding the column
    // to its own `me` select — same approach as memberDivisionIds above.
    prisma.user.findUnique({
      where: { id: me.id },
      select: { canSeePersonalTasks: true },
    }),
  ]);
  // PMUs hanging off the caller's own divisions. Resolved after the sets above,
  // since those name the divisions to look under. Skipped for Super Admin and
  // OSD, whose clauses already span the ministry — no point paying for the
  // lookup on every task read.
  const pmuDivisionIds =
    me.isSuperAdmin || me.hierarchySlot === 'osd'
      ? []
      : await getPmuDivisionIdsFor([...new Set([...headedDivisionIds, ...memberDivisionIds])]);

  return buildVisibilityClausesFrom(me, headedDivisionIds, pmuMemberIds, {
    isPmuParentDivisionHead: pmuParentHeadId !== null && pmuParentHeadId === me.id,
    memberDivisionIds,
    pmuTeamLeaderMemberIds,
    canSeePersonalTasks: personalGrant?.canSeePersonalTasks ?? false,
    pmuDivisionIds,
  });
}

/**
 * Filter clause derived from the `filter` chip.
 * Composed with the visibility OR — both must match.
 */
function buildFilterClause(filter: TaskFilter, callerId: string): Prisma.TaskWhereInput {
  const now = new Date();
  switch (filter) {
    case 'today': {
      return { dueDate: { gte: startOfDayIST(), lte: endOfDayIST() } };
    }
    case 'overdue':
      return { dueDate: { lt: startOfDayIST() }, status: { not: 'completed' } };
    case 'urgent':
      return { priority: 'urgent' };
    case 'mine':
      return { ownerId: callerId };
    case 'completed':
      return { status: 'completed' };
    case 'js_priority':
      return { jsPriorityLane: { not: null }, status: { not: 'completed' } };
    case 'all':
    default:
      return { status: { not: 'completed' } };
  }
}

export type VisibleTask = Task & {
  owner: { id: string; name: string; designation: string; division: { id: string; name: string; avatarColour: string } };
  division: { id: string; name: string; avatarColour: string; kind: string; displayOrder: number };
  subtasks: { status: string }[];
  collaborators: { role: string }[];
  hasAttachment: boolean;
  /** File names of the task's attachments, oldest first (for the hover preview). */
  attachmentNames: string[];
  /** Attachments (id + name), oldest first — power the tappable document list
   *  in the mobile swipe-left slide-over. */
  attachments: { id: string; fileName: string }[];
};

const TASK_PAGE_LIMIT = 200;

export async function fetchVisibleTasks(opts: {
  callerId: string;
  filter: TaskFilter;
  divisionId?: string;
  sort?: TaskSort;
}): Promise<{ tasks: VisibleTask[]; total: number; capped: boolean }> {
  const me = await prisma.user.findUnique({
    where: { id: opts.callerId },
    select: {
      id: true,
      hierarchySlot: true,
      isSuperAdmin: true,
      divisionId: true,
      isPmu: true,
      pmuId: true,
    },
  });
  if (!me) return { tasks: [], total: 0, capped: false };

  const visibilityClauses = await buildVisibilityClauses(me);
  const filterClause = buildFilterClause(opts.filter, me.id);

  const andClauses: Prisma.TaskWhereInput[] = [
    { OR: visibilityClauses },
    filterClause,
  ];
  if (opts.divisionId) {
    andClauses.push({ divisionId: opts.divisionId });
  }

  const where: Prisma.TaskWhereInput = {
    archivedAt: null,
    parentTaskId: null,
    AND: andClauses,
  };

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: {
        owner: { select: USER_SUMMARY_SELECT },
        division: true,
        subtasks: { select: { status: true } },
        collaborators: { select: { role: true } },
      },
      orderBy: taskListOrderBy(opts.sort ?? 'default'),
      take: TASK_PAGE_LIMIT,
    }),
    prisma.task.count({ where }),
  ]);

  const taskIds = tasks.map((t) => t.id);
  const docsByTask = new Map<string, { id: string; fileName: string }[]>();
  if (taskIds.length > 0) {
    const rows = await prisma.attachment.findMany({
      where: { ownerType: 'task', ownerId: { in: taskIds } },
      select: { id: true, ownerId: true, fileName: true },
      orderBy: { uploadedAt: 'asc' },
    });
    for (const r of rows) {
      const list = docsByTask.get(r.ownerId) ?? [];
      list.push({ id: r.id, fileName: r.fileName });
      docsByTask.set(r.ownerId, list);
    }
  }

  const mapped = tasks.map((t) => {
    const attachments = docsByTask.get(t.id) ?? [];
    return {
      ...t,
      hasAttachment: attachments.length > 0,
      attachmentNames: attachments.map((a) => a.fileName),
      attachments,
    };
  }) as VisibleTask[];

  return { tasks: mapped, total, capped: total > TASK_PAGE_LIMIT };
}

/**
 * Counters for the stats strip. Same scoping, different where clauses,
 * collapsed into a single query batch.
 */
export async function fetchTaskCounts(callerId: string): Promise<{
  open: number;
  dueToday: number;
  overdue: number;
  completed: number;
}> {
  const me = await prisma.user.findUnique({
    where: { id: callerId },
    select: {
      id: true,
      hierarchySlot: true,
      isSuperAdmin: true,
      divisionId: true,
      isPmu: true,
      pmuId: true,
    },
  });
  if (!me) return { open: 0, dueToday: 0, overdue: 0, completed: 0 };

  const visibilityClauses = await buildVisibilityClauses(me);
  const base: Prisma.TaskWhereInput = {
    archivedAt: null,
    parentTaskId: null,
    AND: [{ OR: visibilityClauses }],
  };

  const [open, dueToday, overdue, completed] = await Promise.all([
    prisma.task.count({ where: { ...base, status: { not: 'completed' } } }),
    prisma.task.count({
      where: { ...base, dueDate: { gte: startOfDayIST(), lte: endOfDayIST() }, status: { not: 'completed' } },
    }),
    prisma.task.count({
      where: { ...base, dueDate: { lt: startOfDayIST() }, status: { not: 'completed' } },
    }),
    prisma.task.count({ where: { ...base, status: 'completed' } }),
  ]);

  return { open, dueToday, overdue, completed };
}

const STAT_CALLER_SELECT = {
  id: true,
  hierarchySlot: true,
  isSuperAdmin: true,
  divisionId: true,
  isPmu: true,
  pmuId: true,
} as const;

/** One task row shown inside a stats popup (Due today / Overdue). */
export type StatTaskRow = {
  id: string;
  name: string;
  divisionName: string;
  divisionColour: string;
  ownerName: string;
  status: string;
  dueDate: string | null;
  href: string;
};

/**
 * Visibility-scoped list of tasks behind a stat tile: open tasks due today,
 * open tasks overdue, or the most recently completed tasks.
 */
export async function fetchStatTasks(
  callerId: string,
  kind: 'today' | 'overdue' | 'completed',
): Promise<StatTaskRow[]> {
  const me = await prisma.user.findUnique({ where: { id: callerId }, select: STAT_CALLER_SELECT });
  if (!me) return [];

  const visibilityClauses = await buildVisibilityClauses(me);
  // Completed drills into finished work; today/overdue stay scoped to open
  // tasks with a due-date window.
  const statusAndDue: Prisma.TaskWhereInput =
    kind === 'completed'
      ? { status: 'completed' }
      : kind === 'today'
        ? { status: { not: 'completed' }, dueDate: { gte: startOfDayIST(), lte: endOfDayIST() } }
        : { status: { not: 'completed' }, dueDate: { lt: startOfDayIST() } };

  const rows = await prisma.task.findMany({
    where: {
      archivedAt: null,
      parentTaskId: null,
      AND: [{ OR: visibilityClauses }, statusAndDue],
    },
    select: {
      id: true,
      name: true,
      status: true,
      dueDate: true,
      division: { select: { name: true, avatarColour: true } },
      owner: { select: { name: true } },
    },
    // No completedAt column, so most-recently-updated approximates
    // most-recently-completed for the Completed drill-down.
    orderBy: kind === 'completed' ? [{ updatedAt: 'desc' }] : [{ dueDate: 'asc' }],
    take: 200,
  });

  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    divisionName: t.division.name,
    divisionColour: t.division.avatarColour,
    ownerName: t.owner.name,
    status: t.status,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    href: `/tasks/${t.id}`,
  }));
}

/** Open-task counts grouped by division (and its sub-divisions). */
export type DivisionOpenBreakdown = {
  divisionId: string;
  divisionName: string;
  colour: string;
  count: number;
  subDivisions: { id: string; name: string; count: number }[];
};

/**
 * Visibility-scoped breakdown of open tasks by division and sub-division —
 * the drill-down behind the Open tasks stat tile. Sorted by count, so the
 * divisions carrying the most work surface first.
 */
export async function fetchOpenTasksByDivision(
  callerId: string,
): Promise<DivisionOpenBreakdown[]> {
  const me = await prisma.user.findUnique({ where: { id: callerId }, select: STAT_CALLER_SELECT });
  if (!me) return [];

  const visibilityClauses = await buildVisibilityClauses(me);
  const rows = await prisma.task.findMany({
    where: {
      archivedAt: null,
      parentTaskId: null,
      status: { not: 'completed' },
      AND: [{ OR: visibilityClauses }],
    },
    select: {
      divisionId: true,
      subDivisionId: true,
      division: { select: { name: true, avatarColour: true } },
      subDivision: { select: { name: true } },
    },
    take: 5000,
  });

  const map = new Map<string, DivisionOpenBreakdown>();
  for (const t of rows) {
    let d = map.get(t.divisionId);
    if (!d) {
      d = {
        divisionId: t.divisionId,
        divisionName: t.division.name,
        colour: t.division.avatarColour,
        count: 0,
        subDivisions: [],
      };
      map.set(t.divisionId, d);
    }
    d.count += 1;
    if (t.subDivisionId && t.subDivision) {
      let s = d.subDivisions.find((x) => x.id === t.subDivisionId);
      if (!s) {
        s = { id: t.subDivisionId, name: t.subDivision.name, count: 0 };
        d.subDivisions.push(s);
      }
      s.count += 1;
    }
  }

  const result = Array.from(map.values()).sort((a, b) => b.count - a.count);
  for (const d of result) d.subDivisions.sort((a, b) => b.count - a.count);
  return result;
}
