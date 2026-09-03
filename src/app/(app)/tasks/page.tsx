import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PullToRefresh } from '@/components/ui';
import { auth } from '@/lib/auth';
import { isMediaAndIt } from '@/lib/divisions';
import { prisma } from '@/lib/db';
import { formatDue, initialsOf } from '@/lib/format';
import { canManageTask, getHeadedDivisionIds } from '@/lib/rbac';
import { getPmuTeamMemberIds } from '@/lib/pmu-team';
import { cn } from '@/lib/utils';
import { fetchTaskCounts, fetchVisibleTasks, getPmuParentDivisionHeadId, type TaskFilter, type TaskSort } from '@/lib/visibility';

import { DivisionControls } from './_components/DivisionControls';
import { FilterChips } from './_components/FilterChips';
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
  const requestedGroupByDivision = searchParams?.group === 'division';
  // Default sort is "Recently modified" (latest) when the user has not chosen
  // one — the list opens most-recently-active first across the platform, and
  // only changes when the user picks another sort. The smart order is still
  // available explicitly via ?sort=default.
  const sort: TaskSort = VALID_SORTS.includes((searchParams?.sort as TaskSort) ?? 'latest')
    ? ((searchParams?.sort as TaskSort) ?? 'latest')
    : 'latest';

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      divisionId: true,
      isSuperAdmin: true,
      hierarchySlot: true,
      isPmu: true,
      pmuId: true,
      divisionAccess: { select: { divisionId: true } },
    },
  });
  if (!me) redirect('/login');

  // Member divisions (home + admin-granted extras) — drives the per-card
  // management gate and whether Group-by-division is offered.
  const memberDivisionIds = [me.divisionId, ...me.divisionAccess.map((a) => a.divisionId)];

  // Group-by-division is a cross-division view. It is offered to leadership
  // (Super Admin / OSD / JS) and to any multi-division member, whose flat list
  // now spans more than one division. A single-division user's ?group=division
  // param is ignored.
  const canGroupByDivision =
    me.isSuperAdmin ||
    me.hierarchySlot === 'osd' ||
    me.hierarchySlot === 'js' ||
    memberDivisionIds.length > 1;
  const groupByDivision = canGroupByDivision && requestedGroupByDivision;

  const [taskResult, counts, divisions, pmuParentHeadId, headedDivisionIds, pmuTeamMemberIds] = await Promise.all([
    fetchVisibleTasks({ callerId: me.id, filter, divisionId: divisionFilter || undefined, sort }),
    fetchTaskCounts(me.id),
    prisma.division.findMany({
      // Divisions and their PMUs, so PMU-owned tasks are filterable too.
      where: { kind: { in: ['division', 'pmu'] } },
      select: { id: true, name: true },
      orderBy: [{ kind: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
    }),
    me.isPmu && me.pmuId
      ? getPmuParentDivisionHeadId(me.pmuId)
      : Promise.resolve<string | null>(null),
    // Head/delegate divisions — powers the per-card "change status" gate for
    // the mobile long-press action modal (mirrors the server canEditTask rule).
    getHeadedDivisionIds(me.id),
    // A PMU team leader's team (empty otherwise) — same per-card gate, so the
    // leader can act on their team's tasks from the list.
    me.isPmu ? getPmuTeamMemberIds(me.id) : Promise.resolve<string[]>([]),
  ]);

  // Mobile task-card action permissions. `canWatchlist` (Add to Priority Board
  // Watchlist) is OSD / Super Admin only; `canChangeStatus` is decided per card
  // via canManageTask below. Both only gate what the UI offers — the server
  // actions re-authorize independently.
  const canWatchlist = me.isSuperAdmin || me.hierarchySlot === 'osd';
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
  const segments = groupByDivision
    ? null
    : segmentTasksByRelation(tasks, me.id, me.isPmu, me.pmuId, isExcludedPmuHead);

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
            <div className="hidden md:block">
              <QuickCreatePrimary />
            </div>
          </div>

          <FilterChips active={filter} />
          <Suspense fallback={null}>
            <DivisionControls divisions={divisions} canGroupByDivision={canGroupByDivision} />
          </Suspense>
          <StatsStrip counts={counts} />
        </div>

        {/* Task list — Quick Search overlays matching cards in this panel while
            a query is active, and the normal list returns when it is cleared. */}
        <TasksQuickSearch storageKey={listStateKey}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="section-label">Tasks</h2>
            <span className="text-[11px] text-ink-3">
              {capped ? `Showing ${tasks.length} of ${total}` : `${tasks.length} ${tasks.length === 1 ? 'item' : 'items'}`}
            </span>
          </div>

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
                      <DivisionTaskNameList tasks={group.tasks} />
                      <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-3">
                        {group.tasks.map((t) => (
                          <TaskRow key={t.id} task={t} caller={permCaller} canWatchlist={canWatchlist} />
                        ))}
                      </ul>
                    </GroupedDivisionAccordion>
                  ))}
                </div>
              </TaskGroupStateProvider>
            )
          ) : (
            // Always render all three segments — even empty ones — so the
            // three-part structure is visible on every login.
            <div className="space-y-6">
              {segments!.map((segment) => (
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
                    <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-3">
                      {segment.tasks.map((t) => (
                        <TaskRow key={t.id} task={t} caller={permCaller} canWatchlist={canWatchlist} />
                      ))}
                    </ul>
                  )}
                </section>
              ))}
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
  canWatchlist,
}: {
  task: VisibleTask;
  caller: PermCaller;
  canWatchlist: boolean;
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
    visibility: t.visibility,
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
        canWatchlist={canWatchlist}
      />
    </li>
  );
}

/**
 * Compact name-only list of every task in a division, above its card grid.
 * The cards below are the detailed view; a division with dozens of tasks
 * (Office of JS, Khelo India, …) is faster to scan as a dense list of names
 * than as a wall of cards, so this adds that view rather than replacing the
 * cards. Same responsive column count as the card grid so it fills the same
 * width. Each row links straight to the task. The leading number is a plain
 * per-division serial (1, 2, 3, …), not the task's ref number.
 */
function DivisionTaskNameList({ tasks }: { tasks: VisibleTask[] }) {
  return (
    <div className="mb-4 pb-3 border-b border-line-2">
      <h4 className="section-label mb-1.5">Task list</h4>
      <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4">
        {tasks.map((t, i) => {
          const due = formatDue(t.dueDate);
          const isCompleted = t.status === 'completed';
          return (
            <li key={t.id} className="min-w-0">
              <Link
                href={`/tasks/${t.id}`}
                className="group flex items-baseline gap-2 px-2 py-1.5 rounded-md hover:bg-bg transition-colors"
              >
                <span className="font-mono text-[10px] text-ink-3 tracking-wide tabular-nums shrink-0">
                  {i + 1}.
                </span>
                <span
                  className={cn(
                    'min-w-0 truncate text-[13px] leading-snug transition-colors group-hover:text-primary',
                    isCompleted && 'text-ink-3 line-through decoration-ink-4',
                    !isCompleted && due.tone === 'overdue' && 'text-urgent font-medium',
                    !isCompleted && due.tone !== 'overdue' && 'text-ink',
                  )}
                >
                  {t.name}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The three segments of the tasks view, in display order:
 *   1. Tasks assigned to me — division tasks I currently own (includes any
 *                             task transferred or handed to me)
 *   2. Personal tasks — personal-visibility tasks I own, created, or am a
 *                             collaborator on (visible to me and added
 *                             collaborators only)
 *   3. Other tasks of my division — the rest of the division's tasks (or,
 *                             for a PMU member, the rest of their PMU team's)
 * Personal tasks sit above the division's other tasks so a user's own
 * private work stays close to the tasks assigned to them, ahead of the
 * broader division board.
 * Every visible task falls in exactly one segment (personal vs division,
 * division split by ownership). All three segments are always shown, even
 * when empty, so the structure is consistent on every login.
 */
type RelationSegment = {
  key: 'assigned' | 'others' | 'personal';
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
    t.visibility === 'division' &&
    t.sharedWithPmuTeam &&
    t.divisionId === myPmuId;

  const personal = tasks.filter((t) => t.visibility === 'personal');
  const assigned = tasks.filter(
    (t) => t.visibility === 'division' && (t.ownerId === meId || isSharedToMyPmuTeam(t)),
  );
  const others = tasks.filter(
    (t) => t.visibility === 'division' && t.ownerId !== meId && !isSharedToMyPmuTeam(t),
  );

  return [
    {
      key: 'assigned',
      label: 'Tasks assigned to me',
      emptyLabel: 'No tasks are assigned to you.',
      icon: 'ti-user-check',
      tasks: assigned,
    },
    {
      key: 'personal',
      label: 'Personal tasks',
      subtitle: 'Visible to me and added collaborators only',
      emptyLabel: 'You have not created any personal tasks.',
      icon: 'ti-lock',
      tasks: personal,
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
    mine: 'No tasks owned by you in this view.',
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
