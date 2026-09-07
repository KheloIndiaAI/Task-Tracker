'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { setJsPriorityLaneAction } from '@/app/actions/tasks';
import { cn } from '@/lib/utils';

/**
 * Daily / Weekly / Monthly columns for one division on the grouped tasks list.
 *
 * These three columns ARE the JS Priority Board's `today` / `week` / `month`
 * lanes, read from the same `tasks.js_priority_lane` column — one field, two
 * surfaces. So clicking a pill here also puts the task on the board, which is
 * the point: a division buckets its own work here, and the JS sees it there.
 *
 * A task in no lane sits in the "Not scheduled" strip under the columns with no
 * pill lit. Watchlist tasks land there too — this view has no watchlist column,
 * and the board keeps its own.
 *
 * Pills are interactive only for callers who pass `canCurate` (Super Admin, OSD,
 * or the division's head / Director — see `canSetJsPriorityLane`). Everyone else
 * sees the same state as static chips, so no one is offered a control the server
 * would refuse.
 */

export type LaneKey = 'today' | 'week' | 'month';

export type LaneBoardTask = {
  id: string;
  name: string;
  /** null covers both "no lane" and Watchlist — neither has a column here. */
  lane: LaneKey | null;
  /** Overdue, or urgent priority — drawn in the urgent tone, as on the board. */
  needsAttention: boolean;
};

const COLUMNS: {
  key: LaneKey;
  label: string;
  icon: string;
  /** Header wash. */
  head: string;
  /** Lit pill. */
  pillOn: string;
}[] = [
  {
    key: 'today',
    label: 'Daily',
    icon: 'ti-calendar-event',
    head: 'bg-medium-soft text-medium',
    pillOn: 'bg-medium text-white',
  },
  {
    key: 'week',
    label: 'Weekly',
    icon: 'ti-calendar-week',
    head: 'bg-success-soft text-success',
    pillOn: 'bg-success text-white',
  },
  {
    key: 'month',
    label: 'Monthly',
    icon: 'ti-calendar-month',
    head: 'bg-primary-soft text-primary',
    pillOn: 'bg-primary text-white',
  },
];

const PILL_LETTER: Record<LaneKey, string> = { today: 'D', week: 'W', month: 'M' };
const PILL_TITLE: Record<LaneKey, string> = { today: 'Daily', week: 'Weekly', month: 'Monthly' };

export function DivisionLaneBoard({
  tasks,
  canCurate,
}: {
  tasks: LaneBoardTask[];
  canCurate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const setLane = (taskId: string, lane: LaneKey | null) => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('taskId', taskId);
      fd.set('lane', lane ?? '');
      const res = await setJsPriorityLaneAction(undefined, fd);
      if (!res.ok) {
        setError(res.error ?? 'Could not update the schedule.');
        setTimeout(() => setError(null), 4000);
      }
      router.refresh();
    });
  };

  const byLane = {
    today: tasks.filter((t) => t.lane === 'today'),
    week: tasks.filter((t) => t.lane === 'week'),
    month: tasks.filter((t) => t.lane === 'month'),
  };
  const unscheduled = tasks.filter((t) => t.lane === null);

  // Serial numbers run continuously across the columns — Daily, then Weekly,
  // then Monthly, then the unscheduled strip — so every task in the division
  // carries one number.
  const offsets = {
    today: 0,
    week: byLane.today.length,
    month: byLane.today.length + byLane.week.length,
  };
  const unscheduledOffset = offsets.month + byLane.month.length;

  const rowProps = { canCurate, busy: pending, onSet: setLane };

  return (
    <div className="mb-4 pb-3 border-b border-line-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h4 className="section-label">Task list</h4>
        {pending ? (
          <span className="text-[10px] text-ink-3" role="status">
            Saving…
          </span>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mb-2 rounded-lg border border-urgent/20 bg-urgent-soft px-2.5 py-1.5 text-[11px] text-urgent"
        >
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const items = byLane[col.key];
          return (
            <section
              key={col.key}
              aria-label={col.label}
              className="overflow-hidden rounded-lg border border-line bg-panel"
            >
              <header
                className={cn('flex items-center justify-between gap-2 px-2.5 py-1.5', col.head)}
              >
                <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">
                  <i className={cn('ti', col.icon, 'text-[14px]')} aria-hidden="true" />
                  {col.label}
                </span>
                <span className="rounded-pill bg-panel/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
                  {items.length} {items.length === 1 ? 'task' : 'tasks'}
                </span>
              </header>

              <div className="flex items-center gap-2 border-b border-line-2 px-2 py-1 text-[9px] uppercase tracking-[0.08em] text-ink-3">
                <span className="w-6 shrink-0 text-right">#</span>
                <span className="flex-1">Task</span>
              </div>

              {items.length === 0 ? (
                <p className="px-2.5 py-4 text-center text-[11px] italic text-ink-3">
                  {canCurate ? 'Tap D, W or M below to add a task' : 'Nothing here yet'}
                </p>
              ) : (
                <ul>
                  {items.map((t, i) => (
                    <LaneRow key={t.id} task={t} n={offsets[col.key] + i + 1} {...rowProps} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {unscheduled.length > 0 ? (
        <section
          aria-label="Not scheduled"
          className="mt-2.5 overflow-hidden rounded-lg border border-line bg-panel"
        >
          <header className="flex items-center justify-between gap-2 border-b border-line-2 px-2.5 py-1.5">
            <span className="section-label">Not scheduled</span>
            <span className="rounded-pill border border-line bg-bg px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-ink-2">
              {unscheduled.length} {unscheduled.length === 1 ? 'task' : 'tasks'}
            </span>
          </header>
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {unscheduled.map((t, i) => (
              <LaneRow key={t.id} task={t} n={unscheduledOffset + i + 1} {...rowProps} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function LaneRow({
  task,
  n,
  canCurate,
  busy,
  onSet,
}: {
  task: LaneBoardTask;
  n: number;
  canCurate: boolean;
  busy: boolean;
  onSet: (taskId: string, lane: LaneKey | null) => void;
}) {
  return (
    <li className="flex items-center gap-2 border-b border-line-2 px-2 py-1 last:border-b-0">
      <span className="w-6 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-3">
        {n}.
      </span>
      <Link
        href={`/tasks/${task.id}`}
        className={cn(
          'min-w-0 flex-1 truncate text-[12.5px] leading-snug hover:underline',
          task.needsAttention ? 'text-urgent' : 'text-ink',
        )}
      >
        {task.name}
      </Link>
      <span className="flex shrink-0 items-center gap-0.5">
        {COLUMNS.map((col) => {
          const on = task.lane === col.key;
          const base =
            'grid h-[17px] w-[17px] place-items-center rounded-[5px] text-[9px] font-medium leading-none transition-colors';
          if (!canCurate) {
            return (
              <span
                key={col.key}
                title={`${PILL_TITLE[col.key]}${on ? '' : ' — not set'}`}
                className={cn(base, on ? col.pillOn : 'bg-line-2 text-ink-3')}
              >
                {PILL_LETTER[col.key]}
              </span>
            );
          }
          return (
            <button
              key={col.key}
              type="button"
              disabled={busy}
              onClick={() => onSet(task.id, on ? null : col.key)}
              aria-pressed={on}
              title={
                on
                  ? `Remove from ${PILL_TITLE[col.key]} (and the priority board)`
                  : `Move to ${PILL_TITLE[col.key]} (also adds to the priority board)`
              }
              className={cn(
                base,
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-50',
                on ? col.pillOn : 'bg-line-2 text-ink-3 hover:bg-line hover:text-ink-2',
              )}
            >
              {PILL_LETTER[col.key]}
            </button>
          );
        })}
      </span>
    </li>
  );
}
