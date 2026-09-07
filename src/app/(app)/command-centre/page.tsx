import Link from 'next/link';
import { redirect } from 'next/navigation';
import { format, formatDistanceToNow } from 'date-fns';

import { Avatar, Pill } from '@/components/ui';
import { auth } from '@/lib/auth';
import { nowIST, startOfDayIST, endOfDayIST } from '@/lib/date';
import { prisma } from '@/lib/db';
import { USER_SUMMARY_SELECT } from '@/lib/prisma-selects';
import { initialsOf, formatDue } from '@/lib/format';
import { TASK_STATUS_LABEL } from '@/lib/labels';
import { describeNotification } from '@/lib/notifications';
import { cn } from '@/lib/utils';

import type { PillJsLane, PillStatusTone } from '@/components/ui/Pill';

/**
 * OSD Command Centre — per PRD §5.6.
 *
 * Read-only dashboard surface that aggregates:
 *   - Ministry-wide task counters
 *   - JS Priority "Today" lane snapshot
 *   - Recent mentions of OSD across task comments
 *   - Recent notifications
 *
 * Only OSD and Super Admin can land here (others get bounced to /tasks).
 */
export default async function CommandCentrePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const isOsd =
    session.user.hierarchySlot === 'osd' || session.user.isSuperAdmin;
  if (!isOsd) redirect('/tasks');

  const now = nowIST();
  const startOfToday = startOfDayIST();
  const endOfToday = endOfDayIST();

  // Division-only, deliberately. OSD and Super Admin CAN read personal tasks
  // (see buildVisibilityClausesFrom), but these counters measure official
  // division work — folding personal tasks in would inflate them and break
  // comparison with previously reported figures. Kept out on purpose, not
  // because they are unreachable.
  const baseFilter = { archivedAt: null, parentTaskId: null, visibility: 'division' as const };

  const [
    openTotal,
    jsTotal,
    overdueTotal,
    dueTodayTotal,
    todayLaneTasks,
    recentMentions,
    recentNotifications,
    unreadNotifications,
    me,
  ] = await Promise.all([
    prisma.task.count({
      where: { ...baseFilter, status: { not: 'completed' } },
    }),
    prisma.task.count({
      where: { ...baseFilter, jsPriorityLane: { not: null } },
    }),
    prisma.task.count({
      where: {
        ...baseFilter,
        dueDate: { lt: now },
        status: { not: 'completed' },
      },
    }),
    prisma.task.count({
      where: {
        ...baseFilter,
        dueDate: { gte: startOfToday, lte: endOfToday },
        status: { not: 'completed' },
      },
    }),
    prisma.task.findMany({
      where: { ...baseFilter, jsPriorityLane: 'today' },
      include: {
        owner: { select: USER_SUMMARY_SELECT },
        division: true,
      },
      orderBy: [{ priority: 'desc' }, { dueDate: { sort: 'asc', nulls: 'last' } }],
      take: 6,
    }),
    prisma.taskComment.findMany({
      where: { mentions: { has: session.user.id } },
      include: {
        user: { select: USER_SUMMARY_SELECT },
        task: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 6,
    }),
    prisma.notification.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.notification.count({
      where: { userId: session.user.id, readAt: null },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true },
    }),
  ]);

  const firstName = (me?.name ?? '').split(' ')[0] || 'there';

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 pt-4 md:pt-6 pb-12">
      {/* Header */}
      <header className="mb-5">
        <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-1 inline-flex items-center gap-1">
          <i className="ti ti-radar-2 text-[11px] text-primary" aria-hidden="true" />
          OSD view
        </p>
        <h1 className="font-serif text-[24px] md:text-[30px] leading-tight text-ink">
          Command Centre
        </h1>
        <p className="mt-1.5 text-[13px] text-ink-2">
          Good {timeOfDay(now)}, {firstName}. Here is everything on the ministry today.
        </p>
      </header>

      {/* Stats strip */}
      <section
        aria-label="Ministry-wide counters"
        className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6"
      >
        <Stat label="Open tasks" value={openTotal} href="/tasks" icon="ti-list-check" />
        <Stat
          label="JS Priority"
          value={jsTotal}
          tone="accent"
          href="/priority-board"
          icon="ti-bookmark-filled"
        />
        <Stat
          label="Due today"
          value={dueTodayTotal}
          tone={dueTodayTotal > 0 ? 'accent' : 'neutral'}
          href="/tasks?filter=today"
          icon="ti-clock"
        />
        <Stat
          label="Overdue"
          value={overdueTotal}
          tone={overdueTotal > 0 ? 'urgent' : 'neutral'}
          href="/tasks?filter=overdue"
          icon="ti-alert-triangle"
        />
      </section>

      {/* Two-column body */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-5">
        {/* JS Priority Today */}
        <section
          aria-labelledby="cc-today"
          className="bg-panel border border-line rounded-xl"
        >
          <header className="flex items-center justify-between px-4 py-3 border-b border-line-2">
            <div>
              <h2
                id="cc-today"
                className="font-serif text-[18px] text-ink leading-none"
              >
                Today on the board
              </h2>
              <p className="text-[10px] text-ink-3 mt-1">
                JS Priority — today lane
              </p>
            </div>
            <Link
              href="/priority-board"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-primary px-2 py-1 rounded-md hover:bg-primary-soft"
            >
              Open board
              <i className="ti ti-arrow-right text-[13px]" aria-hidden="true" />
            </Link>
          </header>

          {todayLaneTasks.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <i className="ti ti-bookmark text-[28px] text-ink-3 block mb-2" aria-hidden="true" />
              <p className="text-[12px] text-ink-2">
                Nothing on the Today lane right now. Promote a task from{' '}
                <Link href="/priority-board" className="text-primary font-medium">
                  the board
                </Link>
                .
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line-2">
              {todayLaneTasks.map((t) => {
                const due = formatDue(t.dueDate);
                return (
                  <li key={t.id}>
                    <Link
                      href={`/tasks/${t.id}`}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-bg transition-colors"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'w-1 self-stretch rounded-full',
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
                          <Pill variant="js" lane={t.jsPriorityLane as PillJsLane} />
                          {due.tone !== 'none' ? (
                            <span
                              className={cn(
                                'text-[10px]',
                                due.tone === 'overdue' && 'text-urgent font-medium',
                                due.tone === 'today' && 'text-accent font-medium',
                                (due.tone === 'soon' || due.tone === 'future') &&
                                  'text-ink-3',
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

        {/* Right column — Mentions + Notifications */}
        <aside className="flex flex-col gap-5">
          {/* Mentions of OSD */}
          <section
            aria-labelledby="cc-mentions"
            className="bg-panel border border-line rounded-xl"
          >
            <header className="flex items-center justify-between px-4 py-3 border-b border-line-2">
              <h2
                id="cc-mentions"
                className="font-serif text-[16px] text-ink leading-none"
              >
                Mentions
              </h2>
              <span className="text-[10px] text-ink-3">Last {recentMentions.length}</span>
            </header>
            {recentMentions.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <i className="ti ti-at text-[24px] text-ink-3 block mb-1.5" aria-hidden="true" />
                <p className="text-[12px] text-ink-2">No mentions yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line-2">
                {recentMentions.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/tasks/${c.task.id}`}
                      className="flex items-start gap-2.5 px-4 py-3 hover:bg-bg transition-colors"
                    >
                      <Avatar
                        initials={initialsOf(c.user.name)}
                        colour={c.user.division.avatarColour}
                        size="xs"
                        ariaLabel={c.user.name}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11.5px] text-ink-2 leading-snug">
                          <span className="font-medium text-ink">{c.user.name}</span> on{' '}
                          <span className="text-primary">{c.task.name}</span>
                        </p>
                        <p className="text-[12px] text-ink mt-0.5 leading-snug line-clamp-2">
                          {snippetWithoutMentions(c.body)}
                        </p>
                        <time
                          className="text-[10px] text-ink-3 mt-1 block"
                          dateTime={c.createdAt.toISOString()}
                        >
                          {formatDistanceToNow(c.createdAt, { addSuffix: true })}
                        </time>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Notifications strip */}
          <section
            aria-labelledby="cc-notifs"
            className="bg-panel border border-line rounded-xl"
          >
            <header className="flex items-center justify-between px-4 py-3 border-b border-line-2">
              <h2
                id="cc-notifs"
                className="font-serif text-[16px] text-ink leading-none"
              >
                Notifications
              </h2>
              <Link
                href="/notifications"
                className="text-[11px] font-medium text-primary px-2 py-0.5 rounded-md hover:bg-primary-soft"
              >
                {unreadNotifications > 0 ? `${unreadNotifications} unread` : 'View all'}
              </Link>
            </header>
            {recentNotifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <i
                  className="ti ti-bell-off text-[24px] text-ink-3 block mb-1.5"
                  aria-hidden="true"
                />
                <p className="text-[12px] text-ink-2">No notifications yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line-2">
                {recentNotifications.map((n) => {
                  const d = describeNotification(
                    n.type,
                    n.payload as Record<string, unknown> | null,
                  );
                  const isUnread = !n.readAt;
                  return (
                    <li key={n.id}>
                      <Link
                        href={d.href}
                        className={cn(
                          'flex items-start gap-2.5 px-4 py-2.5 hover:bg-bg transition-colors',
                          isUnread && 'bg-bg/50',
                        )}
                      >
                        <span
                          className={cn(
                            'w-6 h-6 grid place-items-center rounded-md shrink-0',
                            'bg-line-2',
                          )}
                        >
                          <i
                            className={cn('ti', d.icon, 'text-[12px]', d.iconClass)}
                            aria-hidden="true"
                          />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p
                            className={cn(
                              'text-[12px] leading-snug',
                              isUnread ? 'text-ink font-medium' : 'text-ink-2',
                            )}
                          >
                            {d.text}
                          </p>
                          <time
                            className="text-[10px] text-ink-3 mt-0.5 block"
                            dateTime={n.createdAt.toISOString()}
                          >
                            {formatDistanceToNow(n.createdAt, { addSuffix: true })}
                          </time>
                        </div>
                        {isUnread ? (
                          <span
                            aria-hidden="true"
                            className="w-1.5 h-1.5 rounded-full bg-urgent mt-1.5 shrink-0"
                          />
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
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
        <Link href="/admin/users" className="text-primary hover:underline">
          Users
        </Link>
        <span>·</span>
        <Link href="/admin/structure" className="text-primary hover:underline">
          Structure
        </Link>
      </nav>
    </div>
  );
}

// ------------------------------------------------------------
// Bits
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
  tone?: 'neutral' | 'accent' | 'urgent';
  href: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'block bg-panel border border-line rounded-xl p-4 md:p-5 transition-shadow hover:shadow-sm',
        tone === 'accent' && 'bg-gradient-to-b from-accent-tint to-panel border-accent-line',
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
          tone === 'neutral' && 'text-ink',
        )}
      >
        {value}
      </p>
    </Link>
  );
}

function timeOfDay(now: Date): string {
  const h = now.getUTCHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function snippetWithoutMentions(body: string): string {
  // Drop @handle markers for the preview, normalise whitespace.
  const stripped = body.replace(/@[a-z0-9._-]+/gi, '').replace(/\s+/g, ' ').trim();
  return stripped.length > 140 ? `${stripped.slice(0, 140)}…` : stripped;
}
