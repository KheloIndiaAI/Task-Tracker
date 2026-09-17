import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { PullToRefresh, type TaskCardInteractiveProps } from '@/components/ui';
import { auth } from '@/lib/auth';
import { isMediaAndIt } from '@/lib/divisions';
import { prisma } from '@/lib/db';
import { formatDue, initialsOf } from '@/lib/format';
import { canEditDivisionNotice, canManageTask, canSetJsPriorityLane, getHeadedDivisionIds } from '@/lib/rbac';
import { getPmuTeamMemberIds } from '@/lib/pmu-team';
import { getContributorTaskIds } from '@/lib/task-participants';
import { resolveGroupByDivision } from '@/lib/task-grouping-shared';
import { canAccessReportGeneration } from '@/lib/reports-shared';
import { fetchTaskCounts, fetchVisibleTasks, getPmuParentDivisionHeadId, type TaskFilter, type TaskSort } from '@/lib/visibility';

import { DivisionControls } from './_components/DivisionControls';
import { type LaneBoardTask } from './_components/DivisionLaneBoard';
import { DivisionNoticeBoard } from './_components/DivisionNoticeBoard';
import { DivisionSubFilter } from './_components/DivisionSubFilter';
import { ReportGenerationDialog } from './_components/ReportGenerationDialog';
import { StatsStrip } from './_components/StatsStrip';
import { TaskListItem } from './_components/TaskListItem';
import { TaskGroupStateProvider, GroupedDivisionAccordion } from './_components/TaskListState';
import { TasksQuickSearch } from './_components/TasksQuickSearch';
import { QuickCreatePrimary } from './_components/QuickCreate';

import type { PillJsLane, PillPriorityTone, PillStatusTone } from '@/components/ui/Pill';

const VALID_FILTERS: TaskFilter[] = ['all', 'today', 'overdue', 'mine', 'urgent', 'completed', 'js_priority'];
const VALID_SORTS: TaskSort[] = ['default', 'latest', 'alpha'];

type PageProps = {
  searchParams?: { filter?: string; division?: string; group?: string; sort?: string };
};

export default async function TasksPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const filter: TaskFilter = VALID_FILTERS.includes(
    (searchParams?.filter as TaskFilter) ?? 'all',
  )
    ? ((searchParams?.filter as TaskFilter) ?? 'all')
    : 'all';

  const divisionFilter = searchParams?.division ?? '';
  // Tri-state, because a Super Admin opens this page grouped by default and
  // still has to be able to turn it off: 'division' forces grouping on, 'none'
  // forces it off, and an absent param falls through to the per-role default
  // resolved below (once `me` is known).
  const groupParam = searchParams?.group;
  // Default sort is "Recently modified" (latest) when the user has not chosen
  // one — the list opens most-recently-active first across the platform, and
  // only changes when the user picks another sort. The smart order is still
  // available explicitly via ?sort=default.
  const sort: TaskSort = VALID_SORTS.includes((searchParams?.sort as TaskSort) ?? 'latest')
    ? ((searchParams?.sort as TaskSort) ?? 'latest')
    : 'latest';

  // Head/delegate divisions are fetched alongside `me` rather than with the
  // main query batch below — they gate the Notice board, the report button and
  // the per-card management rights, all needed before the batch's results are
  // shaped. Both only need the session id, so this costs no extra round trip.
  const [me, headedDivisionIds] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        divisionId: true,
        isSuperAdmin: true,
        hierarchySlot: true,
        isPmu: true,
        pmuId: true,
        canAddJsComment: true,
        canGenerateReports: true,
        divisionAccess: { select: { divisionId: true } },
      },
    }),
    getHeadedDivisionIds(session.user.id),
  ]);
  if (!me) redirect('/login');

  // Member divisions (home + admin-granted extras) — drives the per-card
  // management gate.
  const memberDivisionIds = [me.divisionId, ...me.divisionAccess.map((a) => a.divisionId)];

  // Everyone lands on the division board. It is the only task-list design now
  // — the Notice board, sub-division pills and lane board are each already
  // permissioned per user, so a reader who may change none of them still gets
  // a far better read of their division's work than a wall of cards. See
  // task-grouping-shared.ts; `?group=none` is the explicit opt-out.
  const groupByDivision = resolveGroupByDivision(groupParam, true);

  const [
    taskResult,
    counts,
    divisions,
    pmuParentHeadId,
    pmuTeamMemberIds,
    completedResult,
  ] = await Promise.all([
    fetchVisibleTasks({ callerId: me.id, filter, divisionId: divisionFilter || undefined, sort }),
    fetchTaskCounts(me.id),
    prisma.division.findMany({
      // Divisions, their PMUs (so PMU-owned tasks are filterable too), and
      // sub-divisions (for the per-card sub-division/PMU filter pills below
      // — see childrenByDivision). noticeBoard rides along here (not a
      // separate query) purely for the grouped view's Notice board panel —
      // see DivisionNoticeBoard below.
      where: { kind: { in: ['division', 'pmu', 'sub_division'] } },
      select: {
        id: true,
        name: true,
        kind: true,
        parentId: true,
        pmuParentDivisionId: true,
        noticeBoard: true,
      },
      orderBy: [{ kind: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
    }),
    me.isPmu && me.pmuId
      ? getPmuParentDivisionHeadId(me.pmuId)
      : Promise.resolve<string | null>(null),
    // A PMU team leader's team (empty otherwise) — same per-card gate, so the
    // leader can act on their team's tasks from the list.
    me.isPmu ? getPmuTeamMemberIds(me.id) : Promise.resolve<string[]>([]),
    // Completed work, listed after each division's active cards. Only the
    // grouped view has a per-division place to put it, and the "Completed"
    // filter already shows it on its own, so this query is skipped otherwise.
    // Under "My tasks" it is scoped to the caller too, so both halves of a
    // card describe the same person.
    groupByDivision && filter !== 'completed'
      ? fetchVisibleTasks({
          callerId: me.id,
          filter: 'completed',
          divisionId: divisionFilter || undefined,
          sort,
          ownerId: filter === 'mine' ? me.id : undefined,
        })
      : Promise.resolve(null),
  ]);

  // Mobile task-card action permissions. `canSetFortnight` (Add to Priority Board
  // Fortnight lane) is OSD / Super Admin only; `canChangeStatus` is decided per card
  // via canManageTask below. Both only gate what the UI offers — the server
  // actions re-authorize independently.
  const canSetFortnight = me.isSuperAdmin || me.hierarchySlot === 'osd';
  // JS Comment (the board's own field, distinct from Latest status) is Super
  // Admin, or a user carrying the can_add_js_comment grant — see
  // updateTaskJsCommentAction. Unrelated to task contribution rights below.
  const canEditJsComment = me.isSuperAdmin || me.canAddJsComment;
  // Super Admin, OSD, and any division head always have this; canGenerateReports
  // only ever widens it further — see canAccessReportGeneration's doc comment.
  const canAccessReports = canAccessReportGeneration(me, headedDivisionIds);
  // Notice board edit rights are per-division (a head power) — same actor
  // shape canEditDivisionNotice expects, reused per group below.
  const noticeBoardActor = {
    isSuperAdmin: me.isSuperAdmin,
    isOsd: me.hierarchySlot === 'osd',
    headedDivisionIds,
  };
  const noticeByDivision = new Map(divisions.map((d) => [d.id, d.noticeBoard]));
  // The Division filter dropdown and the report dialog only ever offered
  // top-level divisions + PMUs — sub-divisions rode along in the same query
  // above purely to build childrenByDivision below, so they're filtered back
  // out here rather than widening those two unrelated pickers.
  const topLevelDivisions = divisions
    .filter((d) => d.kind === 'division' || d.kind === 'pmu')
    .map((d) => ({ id: d.id, name: d.name }));
  // Per-division sub-division + PMU pills on the grouped view (DivisionSubFilter
  // below) — a PMU's parent is its own pmuParentDivisionId, falling back to
  // parentId, same resolution getPmuDivisionIdsFor uses elsewhere.
  const childrenByDivision = new Map<
    string,
    { subDivisions: { id: string; name: string }[]; pmus: { id: string; name: string }[] }
  >();
  for (const d of divisions) {
    if (d.kind === 'sub_division' && d.parentId) {
      const entry = childrenByDivision.get(d.parentId) ?? { subDivisions: [], pmus: [] };
      entry.subDivisions.push({ id: d.id, name: d.name });
      childrenByDivision.set(d.parentId, entry);
    } else if (d.kind === 'pmu') {
      const parentId = d.pmuParentDivisionId ?? d.parentId;
      if (parentId) {
        const entry = childrenByDivision.get(parentId) ?? { subDivisions: [], pmus: [] };
        entry.pmus.push({ id: d.id, name: d.name });
        childrenByDivision.set(parentId, entry);
      }
    }
  }
  const permCaller = {
    id: me.id,
    isSuperAdmin: me.isSuperAdmin,
    hierarchySlot: me.hierarchySlot,
    memberDivisionIds,
    headedDivisionIds,
    pmuTeamMemberIds,
  };

  // The PMU's home-division head is not treated as a whole-team share
  // recipient, so a task shared with the PMU team is not lifted into their
  // "assigned" segment (they still see it under "other tasks").
  const isExcludedPmuHead = pmuParentHeadId !== null && pmuParentHeadId === me.id;

  const { tasks, total, capped } = taskResult;

  const grouped = groupByDivision ? groupTasksByDivision(tasks) : null;
  // Which divisions actually have a card on this page. A PMU pill scrolls to
  // the PMU's own card, so a PMU with nothing visible here gets no pill —
  // otherwise it would point at a card that does not exist.
  const cardDivisionIds = new Set(grouped?.map((g) => g.divisionId) ?? []);
  // Completed tasks keyed by division, so each group can list its own after the
  // active ones. A division whose work is entirely finished has no active tasks
  // and so forms no group — its completed tasks stay under the Completed filter.
  const completedByDivision = new Map<string, VisibleTask[]>();
  for (const t of completedResult?.tasks ?? []) {
    const list = completedByDivision.get(t.divisionId) ?? [];
    list.push(t);
    completedByDivision.set(t.divisionId, list);
  }
  const segments = groupByDivision
    ? null
    : segmentTasksByRelation(tasks, me.id, me.isPmu, me.pmuId, isExcludedPmuHead);

  // Who may edit Latest status from the board's Status row — the same
  // contribute right the task detail page uses (owner/creator via
  // canManageTask, or an explicit collaborator/mention via
  // getContributorTaskIds). Computed once, batched across every task on the
  // board rather than per task: two queries total instead of 2×N. The flat
  // opt-out view has no lane board, so it needs no query.
  const laneBoardTaskIds = grouped
    ? grouped.flatMap((g) => g.tasks.map((t) => t.id))
    : [];
  const contributorTaskIds =
    laneBoardTaskIds.length > 0
      ? await getContributorTaskIds(me.id, laneBoardTaskIds)
      : new Set<string>();

  // Stable identity of this exact list view — used to scope the preserved scroll
  // position and quick-search query so Back restores them only for the same
  // filters/sort/group, never bleeding across unrelated views. router.back()
  // restores the URL, so these params are identical on return.
  const listStateKey = `filter=${filter}&division=${divisionFilter}&sort=${sort}&group=${
    groupByDivision ? 'division' : ''
  }`;

  return (
      <PullToRefresh>
      <div className="pb-24 md:pb-10">
        {/* Page header */}
        <div className="px-4 md:px-6 lg:px-8 pt-4 md:pt-6">
          <div className="flex items-end justify-between gap-4 mb-4 md:mb-5">
            <div>
              <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-1">
                Workspace
              </p>
              <h1 className="font-serif text-[22px] md:text-[26px] leading-tight text-ink">
                Active tasks
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {canAccessReports ? <ReportGenerationDialog divisions={topLevelDivisions} /> : null}
              <div className="hidden md:block">
                <QuickCreatePrimary />
              </div>
            </div>
          </div>

          {/* Wraps rather than overflowing: two pills plus the KPI pill is
              close to a 390px phone's width. */}
          <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
            <Suspense fallback={null}>
              <DivisionControls divisions={topLevelDivisions} />
            </Suspense>
            <StatsStrip counts={counts} />
          </div>
        </div>

        {/* Task list — Quick Search overlays matching cards in this panel while
            a query is active, and the normal list returns when it is cleared. */}
        <TasksQuickSearch storageKey={listStateKey}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="section-label">Tasks</h2>
            <span className="text-[11px] text-ink-3">
              {capped
                ? `Showing ${tasks.length} of ${total}`
                : `${tasks.length} ${tasks.length === 1 ? 'item' : 'items'}`}
            </span>
          </div>

          {/* A truncated list must say so loudly. Quietly dropping the tail
              makes every per-division count below it wrong, which reads as
              missing tasks rather than a page limit. */}
          {capped ? (
            <p
              role="status"
              className="mb-2 flex items-start gap-2 rounded-lg border border-accent-line bg-accent-soft px-3 py-2 text-[12px] text-ink"
            >
              <i
                className="ti ti-alert-triangle mt-[1px] text-[14px] text-accent shrink-0"
                aria-hidden="true"
              />
              <span>
                Showing the {tasks.length} most recently active of {total} tasks. The
                counts below cover only these — narrow by division, or use a filter or
                search, to see the rest.
              </span>
            </p>
          ) : null}

          {grouped ? (
            grouped.length === 0 ? (
              <EmptyState filter={filter} />
            ) : (
              <TaskGroupStateProvider scrollKey={listStateKey}>
                <div className="flex flex-col gap-3">
                  {grouped.map((group) => (
                    <GroupedDivisionAccordion
                      key={group.divisionId}
                      persistId={group.divisionId}
                      name={group.divisionName}
                      colour={group.colour}
                      count={group.tasks.length}
                      unit="task"
                    >
                      <DivisionNoticeBoard
                        divisionId={group.divisionId}
                        notice={noticeByDivision.get(group.divisionId) ?? null}
                        canEdit={canEditDivisionNotice(noticeBoardActor, group.divisionId)}
                      />
                      <DivisionSubFilter
                        divisionName={group.divisionName}
                        subDivisions={childrenByDivision.get(group.divisionId)?.subDivisions ?? []}
                        pmus={(childrenByDivision.get(group.divisionId)?.pmus ?? []).filter(
                          (p) => cardDivisionIds.has(p.id),
                        )}
                        laneBoardTasks={toLaneBoardTasks(group.tasks, permCaller, contributorTaskIds)}
                        canCurate={canSetJsPriorityLane(permCaller, {
                          divisionId: group.divisionId,
                        })}
                        canEditJsComment={canEditJsComment}
                        activeGridTasks={group.tasks.map((t) =>
                          toGridTaskProps(t, permCaller, canSetFortnight),
                        )}
                        completedGridTasks={(completedByDivision.get(group.divisionId) ?? []).map((t) =>
                          toGridTaskProps(t, permCaller, canSetFortnight),
                        )}
                      />
                    </GroupedDivisionAccordion>
                  ))}
                </div>
              </TaskGroupStateProvider>
            )
          ) : (
            // Always render both segments — even empty ones — so the
            // structure is visible on every login.
            <div className="space-y-6">
              {segments!.map((segment) => {
                // Built once and placed either on its own (the long-standing
                // layout) or behind the lane board's Show-task-cards toggle,
                // so the two paths can never drift apart.
                const cards = (
                  <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-3">
                    {segment.tasks.map((t) => (
                      <TaskRow key={t.id} task={t} caller={permCaller} canSetFortnight={canSetFortnight} />
                    ))}
                  </ul>
                );
                return (
                  <section key={segment.key} aria-label={segment.label}>
                    <div className="flex items-center gap-2 mb-2">
                      <i
                        className={`ti ${segment.icon} text-[14px] text-ink-3`}
                        aria-hidden="true"
                      />
                      <h3 className="section-label">
                        {segment.label}
                      </h3>
                      <span className="text-[11px] text-ink-3">
                        {segment.tasks.length}
                      </span>
                      {segment.subtitle ? (
                        <span className="text-[11px] text-ink-3 normal-case tracking-normal font-normal">
                          · {segment.subtitle}
                        </span>
                      ) : null}
                    </div>
                    {segment.tasks.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-line bg-panel px-3 py-3 text-[12px] text-ink-3">
                        {segment.emptyLabel}
                      </p>
                    ) : (
                      cards
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </TasksQuickSearch>

      </div>
      </PullToRefresh>
  );
}

type VisibleTask = Awaited<ReturnType<typeof fetchVisibleTasks>>['tasks'][number];

/** Caller shape for canManageTask — computed once in TasksPage, reused per row. */
type PermCaller = {
  id: string;
  isSuperAdmin: boolean;
  hierarchySlot: string;
  memberDivisionIds: string[];
  headedDivisionIds: string[];
  pmuTeamMemberIds: string[];
};

function TaskRow({
  task: t,
  caller,
  canSetFortnight,
}: {
  task: VisibleTask;
  caller: PermCaller;
  canSetFortnight: boolean;
}) {
  const subtaskTotal = t.subtasks.length;
  const subtaskDone = t.subtasks.filter((s) => s.status === 'completed').length;
  const due = formatDue(t.dueDate);

  // Whether this caller may change THIS task's status — the same rule the
  // server enforces in canEditTask/updateTaskStatusAction. Gates the mobile
  // long-press action modal's status options.
  const canChangeStatus = canManageTask(caller, {
    ownerId: t.ownerId,
    createdById: t.createdById,
    divisionId: t.divisionId,
  });

  return (
    <li>
      <TaskListItem
        taskId={t.id}
        refNumber={t.refNumber}
        name={t.name}
        description={t.description}
        attachmentNames={t.attachmentNames}
        attachmentDocs={t.attachments}
        division={{ name: t.division.name }}
        status={t.status as PillStatusTone}
        priority={t.priority as PillPriorityTone}
        jsPriorityLane={t.jsPriorityLane as PillJsLane | null}
        due={due}
        owner={{
          initials: initialsOf(t.owner.name),
          colour: t.owner.division.avatarColour,
          name: t.owner.name,
        }}
        subtasks={subtaskTotal > 0 ? { done: subtaskDone, total: subtaskTotal } : undefined}
        hasAttachment={t.hasAttachment}
        primaryDivisionName={
          t.collaborators.some((c) => c.role === 'division_lead')
            ? t.division.name
            : undefined
        }
        mobileSplit
        href={`/tasks/${t.id}`}
        canChangeStatus={canChangeStatus}
        canSetFortnight={canSetFortnight}
      />
    </li>
  );
}

/**
 * Shape the division's tasks for the Daily / Weekly / Fortnight / Monthly
 * columns. The lane is the task's JS Priority lane verbatim — every lane now
 * has a column, so nothing collapses to null but "no lane at all". A task is
 * drawn in the urgent tone when it is overdue or flagged urgent.
 *
 * canEditStatus mirrors the task detail page's Latest-status edit right
 * exactly: canManageTask covers owner/creator/head/OSD/etc. (pure, no extra
 * query — permCaller already carries everything it needs), OR the task's id
 * is in contributorTaskIds (an explicit collaborator or @mention, resolved in
 * bulk by getContributorTaskIds before this runs).
 */
function toLaneBoardTasks(
  tasks: VisibleTask[],
  permCaller: PermCaller,
  contributorTaskIds: Set<string>,
): LaneBoardTask[] {
  return tasks.map((t) => {
    const lane = t.jsPriorityLane;
    return {
      id: t.id,
      name: t.name,
      subDivisionId: t.subDivisionId,
      lane:
        lane === 'today' ||
        lane === 'week' ||
        lane === 'fortnight' ||
        lane === 'month' ||
        lane === 'watchlist'
          ? lane
          : null,
      needsAttention: formatDue(t.dueDate).tone === 'overdue' || t.priority === 'urgent',
      latestStatus: t.latestStatus,
      jsComment: t.jsComment,
      canEditStatus:
        canManageTask(permCaller, {
          ownerId: t.ownerId,
          createdById: t.createdById,
          divisionId: t.divisionId,
        }) || contributorTaskIds.has(t.id),
    };
  });
}

/**
 * Same view-model TaskRow builds, but as a plain data object rather than
 * JSX — DivisionSubFilter (a client component) needs the full set of a
 * division's tasks in hand so it can filter them by the sub-division pills
 * without a server round-trip, then render whichever are visible itself.
 * subDivisionId is the one field TaskCardInteractiveProps doesn't carry;
 * everything else is identical to TaskRow's own props.
 */
function toGridTaskProps(
  t: VisibleTask,
  caller: PermCaller,
  canSetFortnight: boolean,
): TaskCardInteractiveProps & { subDivisionId: string | null } {
  const subtaskTotal = t.subtasks.length;
  const subtaskDone = t.subtasks.filter((s) => s.status === 'completed').length;
  const due = formatDue(t.dueDate);
  const canChangeStatus = canManageTask(caller, {
    ownerId: t.ownerId,
    createdById: t.createdById,
    divisionId: t.divisionId,
  });

  return {
    taskId: t.id,
    subDivisionId: t.subDivisionId,
    refNumber: t.refNumber,
    name: t.name,
    description: t.description,
    attachmentNames: t.attachmentNames,
    attachmentDocs: t.attachments,
    division: { name: t.division.name },
    status: t.status as PillStatusTone,
    priority: t.priority as PillPriorityTone,
    jsPriorityLane: t.jsPriorityLane as PillJsLane | null,
    due,
    owner: {
      initials: initialsOf(t.owner.name),
      colour: t.owner.division.avatarColour,
      name: t.owner.name,
    },
    subtasks: subtaskTotal > 0 ? { done: subtaskDone, total: subtaskTotal } : undefined,
    hasAttachment: t.hasAttachment,
    primaryDivisionName: t.collaborators.some((c) => c.role === 'division_lead')
      ? t.division.name
      : undefined,
    mobileSplit: true,
    href: `/tasks/${t.id}`,
    canChangeStatus,
    canSetFortnight,
  };
}

/**
 * The two segments of the tasks view, in display order:
 *   1. Tasks assigned to me — tasks I currently own (including any handed or
 *                             transferred to me)
 *   2. Other tasks of my division — the rest of the division's tasks (or, for
 *                             a PMU member, the rest of their PMU team's)
 *
 * There used to be a third, "Personal tasks", holding personal-visibility
 * work. The personal/division split was removed on 2026-09-17 — every task
 * belongs to a division and the whole division reads it — so those tasks now
 * fall into one of the two segments by ownership like everything else.
 *
 * Every visible task falls in exactly one segment. Both are always shown, even
 * when empty, so the structure is consistent on every login.
 */
type RelationSegment = {
  key: 'assigned' | 'others';
  label: string;
  subtitle?: string;
  emptyLabel: string;
  icon: string;
  tasks: VisibleTask[];
};

function segmentTasksByRelation(
  tasks: VisibleTask[],
  meId: string,
  isPmu: boolean,
  myPmuId: string | null,
  isExcludedPmuHead: boolean,
): RelationSegment[] {
  // A task the PMU team leader shared with the whole team counts as
  // "assigned to me" for every PMU member of that team — except the PMU's
  // home-division head, for whom it stays an "other" task.
  const isSharedToMyPmuTeam = (t: VisibleTask) =>
    isPmu &&
    !isExcludedPmuHead &&
    myPmuId !== null &&
    t.sharedWithPmuTeam &&
    t.divisionId === myPmuId;

  const assigned = tasks.filter((t) => t.ownerId === meId || isSharedToMyPmuTeam(t));
  const others = tasks.filter((t) => t.ownerId !== meId && !isSharedToMyPmuTeam(t));

  return [
    {
      key: 'assigned',
      label: 'Tasks assigned to me',
      emptyLabel: 'No tasks are assigned to you.',
      icon: 'ti-user-check',
      tasks: assigned,
    },
    {
      key: 'others',
      label: isPmu ? 'Other tasks of my PMU team' : 'Other tasks of my division',
      emptyLabel: isPmu
        ? 'No other tasks in your PMU team.'
        : 'No other tasks in your division.',
      icon: 'ti-building',
      tasks: others,
    },
  ];
}

type DivisionGroup = {
  divisionId: string;
  divisionName: string;
  colour: string;
  kind: string;
  displayOrder: number;
  tasks: VisibleTask[];
};

/** Sort key: regular divisions (0), then Media & IT (1), then PMUs (2). */
function divisionGroupRank(kind: string, name: string): number {
  if (kind === 'pmu') return 2;
  if (isMediaAndIt(name)) return 1;
  return 0;
}

function groupTasksByDivision(tasks: VisibleTask[]): DivisionGroup[] {
  const map = new Map<string, DivisionGroup>();
  for (const t of tasks) {
    let group = map.get(t.divisionId);
    if (!group) {
      group = {
        divisionId: t.divisionId,
        divisionName: t.division.name,
        colour: t.division.avatarColour,
        kind: t.division.kind,
        displayOrder: t.division.displayOrder,
        tasks: [],
      };
      map.set(t.divisionId, group);
    }
    group.tasks.push(t);
  }
  // Media & IT sinks below the other divisions; the PMUs follow it, each set
  // ordered by the division's own displayOrder then name.
  return Array.from(map.values()).sort((a, b) => {
    const ra = divisionGroupRank(a.kind, a.divisionName);
    const rb = divisionGroupRank(b.kind, b.divisionName);
    if (ra !== rb) return ra - rb;
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
    return a.divisionName.localeCompare(b.divisionName);
  });
}

function EmptyState({ filter }: { filter: TaskFilter }) {
  const copy: Record<TaskFilter, string> = {
    all: 'No tasks yet. Use the + button or "New task" to create one.',
    today: 'Nothing due today.',
    overdue: 'No overdue tasks. Stay on top.',
    mine: 'Nothing is assigned to you here. Turn off My tasks to see the whole board.',
    urgent: 'No urgent tasks right now.',
    js_priority: 'No JS Priority tasks.',
    completed: 'No completed tasks.',
  };
  return (
    <div className="rounded-xl border border-dashed border-line p-10 text-center bg-panel">
      <i className="ti ti-inbox text-[28px] text-ink-3 mb-2 block" aria-hidden="true" />
      <p className="text-[13px] text-ink-2">{copy[filter]}</p>
    </div>
  );
}
