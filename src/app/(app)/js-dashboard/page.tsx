import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Avatar, Pill } from '@/components/ui';
import { auth } from '@/lib/auth';
import { nowIST, startOfDayIST, endOfDayIST } from '@/lib/date';
import { prisma } from '@/lib/db';
import { USER_SUMMARY_SELECT } from '@/lib/prisma-selects';
import { initialsOf, formatDue } from '@/lib/format';
import { TASK_STATUS_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';

import type { PillJsLane, PillStatusTone } from '@/components/ui/Pill';

/**
 * JS Dashboard — per PRD §5.5.
 *
 * Read-only dashboard for the Joint Secretary. Combines:
 *   - Personal task counters (mine, priority board, due today)
 *   - JS Priority lanes as compact tap-to-view panels (no drag-and-drop)
 *   - Personal task list (owned by JS, not completed)
 *
 * Access: hierarchySlot === 'js' | isSuperAdmin | hierarchySlot === 'osd'.
 * Everyone else is redirected to /tasks.
 */

const LANE_META: Record<PillJsLane, { label: string; icon: string }> = {
  today: { label: 'Today', icon: 'ti-clock-hour-4' },
  week: { label: 'This week', icon: 'ti-calendar-week' },
  month: { label: 'This month', icon: 'ti-calendar-month' },
  fortnight: { label: 'Fortnight', icon: 'ti-calendar-due' },
};

const LANES: PillJsLane[] = ['today', 'week', 'month', 'fortnight'];

export default async function JsDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const isJs =
    session.user.hierarchySlot === 'js' ||
    session.user.hierarchySlot === 'osd' ||
    session.user.isSuperAdmin;
  if (!isJs) redirect('/tasks');

  const now = nowIST();
  const startOfToday = startOfDayIST();
  const endOfToday = endOfDayIST();

  const userId = session.user.id;
  const baseFilter = { archivedAt: null, parentTaskId: null };
  // Ministry-wide aggregates (priority board) stay division-only
  // so another user's Personal task never leaks into a count or list. The
  // viewer's own-task widgets keep using baseFilter — they are already
  // scoped to this user, who owns those personal tasks.
  const divisionFilter = { ...baseFilter, visibility: 'division' as const };

  const [
    myTasksCount,
    jsPriorityCount,
    dueTodayCount,
    allPriorityTasks,
    myTasks,
    me,
  ] = await Promise.all([
    // My open tasks (owned by this user)
    prisma.task.count({
      where: {
        ...baseFilter,
        ownerId: userId,
        status: { not: 'completed' },
      },
    }),
    // Total JS Priority board tasks
    prisma.task.count({
      where: { ...divisionFilter, jsPriorityLane: { not: null } },
    }),
    // Tasks due today, owned by or assigned to the JS user
    prisma.task.count({
      where: {
        ...baseFilter,
        dueDate: { gte: startOfToday, lte: endOfToday },
        status: { not: 'completed' },
        OR: [
          { ownerId: userId },
          { collaborators: { some: { userId } } },
        ],
      },
    }),
    // All priority board tasks (grouped by lane below)
    prisma.task.findMany({
      where: { ...divisionFilter, jsPriorityLane: { not: null } },
      include: {
        owner: { select: USER_SUMMARY_SELECT },
        division: true,
      },
      orderBy: [{ priority: 'desc' }, { dueDate: { sort: 'asc', nulls: 'last' } }],
    }),
    // Personal tasks owned by JS, not completed (up to 8)
    prisma.task.findMany({
      where: {
        ...baseFilter,
        ownerId: userId,
        status: { not: 'completed' },
      },
      include: {
        owner: { select: USER_SUMMARY_SELECT },
        division: true,
      },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }],
      take: 8,
    }),
    // Fetch name for greeting
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    }),
  ]);

  // Group priority tasks by lane (max 4 per lane shown in dashboard)
  const tasksByLane: Record<PillJsLane, typeof allPriorityTasks> = {
    today: [],
    week: [],
    month: [],
    fortnight: [],
  };
  for (const t of allPriorityTasks) {
    if (!t.jsPriorityLane) continue;
    tasksByLane[t.jsPriorityLane as PillJsLane].push(t);
  }

  const firstName = (me?.name ?? '').split(' ')[0] || 'there';

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 pt-4 md:pt-6 pb-12">
      {/* Page header */}
      <header className="mb-5">
        <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-1 inline-flex items-center gap-1">
          <i className="ti ti-bookmark-filled text-[11px] text-accent" aria-hidden="true" />
          JS view
        </p>
        <h1 className="font-serif text-[24px] md:text-[30px] leading-tight text-ink">
          JS Dashboard
        </h1>
        <p className="mt-1.5 text-[13px] text-ink-2">
          Good {timeOfDay(now)}, {firstName}. Here is your priority board and assigned work.
        </p>
      </header>

      {/* Stats strip */}
      <section
        aria-label="Personal task counters"
        className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6"
      >
        <Stat
          label="My tasks"
          value={myTasksCount}
          href="/tasks?filter=mine"
          icon="ti-list-check"
        />
        <Stat
          label="JS Priority"
          value={jsPriorityCount}
          tone="accent"
          href="/priority-board"
          icon="ti-bookmark-filled"
        />
        <Stat
          label="Due today"
          value={dueTodayCount}
          tone={dueTodayCount > 0 ? 'accent' : 'neutral'}
          href="/tasks?filter=today"
          icon="ti-clock"
        />
      </section>

      {/* Priority lanes */}
      <section aria-labelledby="jsd-lanes" className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2
            id="jsd-lanes"
            className="font-serif text-[18px] md:text-[20px] text-ink leading-none"
          >
            Priority board
          </h2>
          <Link
            href="/priority-board"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-primary px-2 py-1 rounded-md hover:bg-primary-soft"
          >
            Full board
            <i className="ti ti-arrow-right text-[13px]" aria-hidden="true" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {LANES.map((lane) => {
            const tasks = tasksByLane[lane];
            const meta = LANE_META[lane];
            return (
              <LanePanel key={lane} lane={lane} meta={meta} tasks={tasks} />
            );
          })}
        </div>
      </section>

      {/* My tasks */}
      <div className="grid grid-cols-1 gap-5">
        {/* My assigned tasks */}
        <section
          aria-labelledby="jsd-mine"
          className="bg-panel border border-line rounded-xl"
        >
          <header className="flex items-center justify-between px-4 py-3 border-b border-line-2">
            <div>
              <h2
                id="jsd-mine"
                className="font-serif text-[18px] text-ink leading-none"
              >
                My tasks
              </h2>
              <p className="text-[10px] text-ink-3 mt-1">
                Open tasks you own, sorted by due date
              </p>
            </div>
            <Link
              href="/tasks?filter=mine"
              className="text-[11px] font-medium text-primary px-2 py-0.5 rounded-md hover:bg-primary-soft"
            >
              View all
            </Link>
          </header>

          {myTasks.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <i className="ti ti-list-check text-[28px] text-ink-3 block mb-2" aria-hidden="true" />
              <p className="text-[12px] text-ink-2">
                No open tasks assigned to you right now.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line-2">
              {myTasks.map((t) => {
                const due = formatDue(t.dueDate, now);
                return (
                  <li key={t.id}>
                    <Link
                      href={`/tasks/${t.id}`}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-bg transition-colors"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'w-1 self-stretch rounded-full shrink-0',
                          t.priority === 'urgent' && 'bg-urgent',
                          t.priority === 'high' && 'bg-high',
                          t.priority === 'medium' && 'bg-medium',
                          t.priority === 'low' && 'bg-low',
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-ink leading-snug truncate">
                          {t.name}
                        </p>
                        <p className="text-[10px] text-ink-3 mt-0.5 truncate">
                          {t.division.name}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Pill
                            variant="status"
                            tone={t.status as PillStatusTone}
                            label={TASK_STATUS_LABEL[t.status] ?? t.status}
                          />
                          {t.jsPriorityLane ? (
                            <Pill variant="js" lane={t.jsPriorityLane as PillJsLane} />
                          ) : null}
                          {due.tone !== 'none' ? (
                            <span
                              className={cn(
                                'text-[10px]',
                                due.tone === 'overdue' && 'text-urgent font-medium',
                                due.tone === 'today' && 'text-accent font-medium',
                                (due.tone === 'soon' || due.tone === 'future') && 'text-ink-3',
                              )}
                            >
                              {due.label}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <Avatar
                        initials={initialsOf(t.owner.name)}
                        colour={t.owner.division.avatarColour}
                        size="sm"
                        ariaLabel={`Owner ${t.owner.name}`}
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Footer — quick-link strip */}
      <nav
        aria-label="Quick links"
        className="mt-6 flex flex-wrap gap-2 text-[12px] text-ink-3"
      >
        <span className="font-medium text-ink-2">Jump to:</span>
        <Link href="/tasks" className="text-primary hover:underline">
          All tasks
        </Link>
        <span>·</span>
        <Link href="/priority-board" className="text-primary hover:underline">
          Priority board
        </Link>
        <span>·</span>
        <Link href="/tasks?filter=today" className="text-primary hover:underline">
          Due today
        </Link>
      </nav>
    </div>
  );
}

// ------------------------------------------------------------
// Lane panel — compact card group for one priority lane
// ------------------------------------------------------------

type LanePanelTask = {
  id: string;
  name: string;
  status: string;
  priority: string;
  jsPriorityLane: string | null;
  dueDate: Date | null;
  division: { name: string };
  owner: { name: string; division: { avatarColour: string } };
};

function LanePanel({
  lane,
  meta,
  tasks,
}: {
  lane: PillJsLane;
  meta: { label: string; icon: string };
  tasks: LanePanelTask[];
}) {
  const shown = tasks.slice(0, 4);
  const overflow = tasks.length - shown.length;

  return (
    <div className="bg-panel border border-line rounded-xl flex flex-col">
      {/* Lane header */}
      <header className="flex items-center justify-between px-3 py-2.5 border-b border-line-2">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 grid place-items-center rounded-md bg-accent-soft text-accent shrink-0">
            <i className={cn('ti', meta.icon, 'text-[13px]')} aria-hidden="true" />
          </span>
          <h3 className="text-[13px] font-medium text-ink leading-none">{meta.label}</h3>
        </div>
        <span className="text-[10px] font-medium text-accent bg-accent-soft px-1.5 py-0.5 rounded-full border border-accent-line">
          {tasks.length}
        </span>
      </header>

      {/* Task list */}
      {shown.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-8 px-3">
          <p className="text-[11px] text-ink-3 text-center">Nothing on this lane.</p>
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-line-2">
          {shown.map((t) => {
            const due = formatDue(t.dueDate);
            return (
              <li key={t.id}>
                <Link
                  href={`/tasks/${t.id}`}
                  className="flex items-start gap-2 px-3 py-2.5 hover:bg-bg transition-colors"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'w-1 self-stretch rounded-full shrink-0',
                      t.priority === 'urgent' && 'bg-urgent',
                      t.priority === 'high' && 'bg-high',
                      t.priority === 'medium' && 'bg-medium',
                      t.priority === 'low' && 'bg-low',
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-ink leading-snug line-clamp-2">
                      {t.name}
                    </p>
                    <p className="text-[10px] text-ink-3 mt-0.5 truncate">
                      {t.division.name}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Pill
                        variant="status"
                        tone={t.status as PillStatusTone}
                        label={TASK_STATUS_LABEL[t.status] ?? t.status}
                      />
                      {due.tone !== 'none' ? (
                        <span
                          className={cn(
                            'text-[10px]',
                            due.tone === 'overdue' && 'text-urgent font-medium',
                            due.tone === 'today' && 'text-accent font-medium',
                            (due.tone === 'soon' || due.tone === 'future') && 'text-ink-3',
                          )}
                        >
                          {due.label}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Avatar
                    initials={initialsOf(t.owner.name)}
                    colour={t.owner.division.avatarColour}
                    size="xs"
                    ariaLabel={`Owner ${t.owner.name}`}
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* View all footer */}
      {(overflow > 0 || tasks.length > 0) && (
        <div className="px-3 py-2 border-t border-line-2">
          <Link
            href="/priority-board"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
          >
            {overflow > 0 ? `+${overflow} more` : 'View all on board'}
            <i className="ti ti-arrow-right text-[11px]" aria-hidden="true" />
          </Link>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Stat card
// ------------------------------------------------------------

function Stat({
  label,
  value,
  tone = 'neutral',
  href,
  icon,
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'accent' | 'urgent' | 'primary';
  href: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'block bg-panel border border-line rounded-xl p-4 md:p-5 transition-shadow hover:shadow-sm',
        tone === 'accent' && 'border-accent-line bg-accent-soft/30',
        tone === 'primary' && 'border-primary/20 bg-primary-soft/30',
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.06em] text-ink-3 font-medium">
          {label}
        </p>
        <i
          className={cn(
            'ti',
            icon,
            'text-[14px]',
            tone === 'accent' && 'text-accent',
            tone === 'urgent' && 'text-urgent',
            tone === 'primary' && 'text-primary',
            tone === 'neutral' && 'text-ink-3',
          )}
          aria-hidden="true"
        />
      </div>
      <p
        className={cn(
          'font-serif font-medium leading-none mt-2 text-[28px] md:text-[34px]',
          tone === 'urgent' && 'text-urgent',
          tone === 'accent' && 'text-accent',
          tone === 'primary' && 'text-primary',
          tone === 'neutral' && 'text-ink',
        )}
      >
        {value}
      </p>
    </Link>
  );
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function timeOfDay(now: Date): string {
  const h = now.getUTCHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}
