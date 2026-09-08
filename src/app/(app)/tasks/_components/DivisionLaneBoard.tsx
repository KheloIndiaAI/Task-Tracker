'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { setJsPriorityLaneAction } from '@/app/actions/tasks';
import { cn } from '@/lib/utils';

/**
 * Daily / Weekly / Fortnight / Monthly columns for one division on the grouped
 * tasks list.
 *
 * These four columns ARE the JS Priority Board's lanes, read from the same
 * `tasks.js_priority_lane` column — one field, two surfaces. So clicking a pill
 * here also puts the task on the board, which is the point: a division buckets
 * its own work here, and the JS sees it there. (Fortnight is the lane the board
 * used to call Watchlist; it was renamed rather than adding a fifth lane.)
 *
 * A task in no lane sits in the "Not scheduled" strip under the columns with no
 * pill lit.
 *
 * Past the md breakpoint the columns are a slider: exactly three are in view and
 * the arrows step through them, so a panel keeps enough width for real task
 * names. Below md they stack and the arrows disappear — three columns on a phone
 * would be unreadable.
 *
 * Pills are interactive only for callers who pass `canCurate` (Super Admin, OSD,
 * or the division's head / Director — see `canSetJsPriorityLane`). Everyone else
 * sees the same state as static chips, so no one is offered a control the server
 * would refuse.
 */

export type LaneKey = 'today' | 'week' | 'fortnight' | 'month';

export type LaneBoardTask = {
  id: string;
  name: string;
  /** null means the task sits in no lane at all — every lane has a column. */
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
    // Warm orange rather than the mockup's red: --urgent already means "overdue
    // or urgent" on the task names inside these very rows, and one colour must
    // not carry two meanings a few pixels apart.
    key: 'fortnight',
    label: 'FortNight',
    icon: 'ti-calendar-due',
    head: 'bg-high-soft text-high',
    pillOn: 'bg-high text-white',
  },
  {
    key: 'month',
    label: 'Monthly',
    icon: 'ti-calendar-month',
    head: 'bg-primary-soft text-primary',
    pillOn: 'bg-primary text-white',
  },
];

const PILL_LETTER: Record<LaneKey, string> = {
  today: 'D',
  week: 'W',
  fortnight: 'F',
  month: 'M',
};
const PILL_TITLE: Record<LaneKey, string> = {
  today: 'Daily',
  week: 'Weekly',
  fortnight: 'FortNight',
  month: 'Monthly',
};

/** Columns in view past the md breakpoint; the rest are a slide away. */
const VISIBLE_COLUMNS = 3;
const MAX_SLIDE_INDEX = Math.max(0, COLUMNS.length - VISIBLE_COLUMNS);

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
  const [slide, setSlide] = useState(0);
  // At most one row shows its scheduler at a time, so the options never
  // compete for attention and a stray click always lands somewhere sensible.
  const [openRow, setOpenRow] = useState<string | null>(null);

  // Clicking anywhere else puts the options away — the same dismissal the
  // division and sort dropdowns on this page already use.
  useEffect(() => {
    if (!openRow) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-lane-scheduler]')) setOpenRow(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenRow(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openRow]);

  // The slider only exists past md; below it the columns stack, so the arrows
  // and the transform must not apply. Tracked in state rather than by CSS
  // because the transform is an inline style — same approach the priority
  // board uses for its own breakpoint-dependent behaviour.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

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
    fortnight: tasks.filter((t) => t.lane === 'fortnight'),
    month: tasks.filter((t) => t.lane === 'month'),
  };
  const unscheduled = tasks.filter((t) => t.lane === null);

  // Serial numbers run continuously across the columns in display order —
  // Daily, Weekly, Fortnight, Monthly, then the unscheduled strip — so every
  // task in the division carries exactly one number.
  const offsets = {
    today: 0,
    week: byLane.today.length,
    fortnight: byLane.today.length + byLane.week.length,
    month: byLane.today.length + byLane.week.length + byLane.fortnight.length,
  };
  const unscheduledOffset = offsets.month + byLane.month.length;

  const rowProps = {
    canCurate,
    busy: pending,
    onSet: setLane,
    openRow,
    onOpenRow: setOpenRow,
  };

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

      {/* Slider: gutters on each side hold the arrows, so they sit beside the
          panels rather than on top of them. */}
      <div className="relative md:px-9">
        <SlideArrow
          side="left"
          disabled={slide === 0}
          onClick={() => setSlide((i) => Math.max(0, i - 1))}
        />
        <SlideArrow
          side="right"
          disabled={slide >= MAX_SLIDE_INDEX}
          onClick={() => setSlide((i) => Math.min(MAX_SLIDE_INDEX, i + 1))}
        />

        <div className="overflow-hidden">
          <div
            className={cn(
              'flex flex-col gap-2.5',
              // Past md: a row of fixed thirds. Gutters come from per-panel
              // padding, not `gap`, because three thirds plus gaps would
              // overflow the viewport and break the slide arithmetic.
              'md:flex-row md:gap-0 md:transition-transform md:duration-300 md:ease-out',
              'motion-reduce:transition-none',
            )}
            style={
              isDesktop
                ? { transform: `translateX(-${slide * (100 / VISIBLE_COLUMNS)}%)` }
                : undefined
            }
          >
            {COLUMNS.map((col) => {
              const items = byLane[col.key];
              return (
                <div key={col.key} className="md:w-1/3 md:shrink-0 md:px-[5px]">
                  <section
                    aria-label={col.label}
                    // No overflow-hidden: a row's scheduler confirmation sits
                    // just above the row and would be clipped by it. The header
                    // rounds its own top corners instead.
                    className="rounded-lg border border-line bg-panel"
                  >
                    <header
                      className={cn(
                        'flex items-center justify-between gap-2 rounded-t-[7px] px-2.5 py-1.5',
                        col.head,
                      )}
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
                        {canCurate ? 'Tap D, W, F or M below to add a task' : 'Nothing here yet'}
                      </p>
                    ) : (
                      <ul>
                        {items.map((t, i) => (
                          <LaneRow
                            key={t.id}
                            task={t}
                            n={offsets[col.key] + i + 1}
                            {...rowProps}
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {unscheduled.length > 0 ? (
        <section
          aria-label="Not scheduled"
          // No overflow-hidden — see the column sections above.
          className="mt-2.5 rounded-lg border border-line bg-panel"
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

/**
 * One slider arrow, parked in the gutter beside the panels. Both arrows are
 * always rendered past md and the unusable one is disabled rather than removed,
 * so the strip does not shift sideways as you page through it. Hidden below md,
 * where the columns stack and there is nothing to slide.
 */
function SlideArrow({
  side,
  disabled,
  onClick,
}: {
  side: 'left' | 'right';
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === 'left' ? 'Show previous columns' : 'Show next columns'}
      className={cn(
        'absolute top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 place-items-center rounded-lg',
        'border border-line bg-panel text-ink-2 shadow-card transition-colors md:grid',
        'hover:border-ink-4 hover:text-ink',
        'disabled:cursor-default disabled:opacity-35 disabled:hover:border-line disabled:hover:text-ink-2',
        side === 'left' ? 'left-0' : 'right-0',
      )}
    >
      <i
        className={cn('ti text-[15px]', side === 'left' ? 'ti-chevron-left' : 'ti-chevron-right')}
        aria-hidden="true"
      />
    </button>
  );
}

const PILL_BASE =
  'grid h-[17px] w-[17px] place-items-center rounded-[5px] text-[9px] font-medium leading-none transition-colors';

/**
 * One task row.
 *
 * The row is split down the middle: the left half is a link that opens the
 * task, the right half is the scheduler. At rest the scheduler is a single
 * clock icon — four pills on every row was a wall of controls that buried the
 * task names. Tapping it slides D / W / F / M in; picking one files the task
 * and slides them back out, briefly confirming which list it went to.
 *
 * Readers who cannot curate get no clock and no dead pills — just a static
 * chip showing where the task already sits, and nothing at all if it sits
 * nowhere.
 */
function LaneRow({
  task,
  n,
  canCurate,
  busy,
  onSet,
  openRow,
  onOpenRow,
}: {
  task: LaneBoardTask;
  n: number;
  canCurate: boolean;
  busy: boolean;
  onSet: (taskId: string, lane: LaneKey | null) => void;
  openRow: string | null;
  onOpenRow: (taskId: string | null) => void;
}) {
  const open = openRow === task.id;
  // What the caller just chose, held while the confirmation shows. `removed` is
  // the case where they tapped the lane the task was already in, which takes it
  // off the board — the pill must go dark, not light up.
  const [justPicked, setJustPicked] = useState<{ lane: LaneKey; removed: boolean } | null>(
    null,
  );
  const current = COLUMNS.find((c) => c.key === task.lane);

  // Confirm the pick in place for a beat, then put the options away. The list
  // refreshes underneath in the meantime and the row moves to its new column.
  useEffect(() => {
    if (!justPicked) return;
    const t = setTimeout(() => {
      setJustPicked(null);
      onOpenRow(null);
    }, 900);
    return () => clearTimeout(t);
  }, [justPicked, onOpenRow]);

  const pick = (lane: LaneKey) => {
    const removed = task.lane === lane;
    setJustPicked({ lane, removed });
    onSet(task.id, removed ? null : lane);
  };

  return (
    <li
      className={cn(
        'flex items-center gap-2 border-b border-line-2 px-2 py-1 last:border-b-0 transition-colors',
        open && 'bg-primary-soft/40',
      )}
    >
      <span className="w-6 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-3">
        {n}.
      </span>

      {/* Left half — opens the task. */}
      <Link
        href={`/tasks/${task.id}`}
        className={cn(
          'min-w-0 flex-1 basis-0 truncate py-1 text-[12.5px] leading-snug hover:underline',
          task.needsAttention ? 'text-urgent' : 'text-ink',
        )}
      >
        {task.name}
      </Link>

      {/* Right half — the scheduler. */}
      <div
        data-lane-scheduler=""
        className="relative flex flex-1 basis-0 items-center justify-end"
      >
        {!canCurate ? (
          current ? (
            <span
              title={`${PILL_TITLE[current.key]}`}
              className={cn(PILL_BASE, current.pillOn)}
            >
              {PILL_LETTER[current.key]}
            </span>
          ) : null
        ) : open ? (
          <div className="lane-options-in flex items-center gap-1">
            {justPicked ? (
              <span
                role="status"
                className="absolute -top-6 right-0 z-20 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[10px] font-medium text-onink shadow-card"
              >
                {justPicked.removed
                  ? `Removed from ${PILL_TITLE[justPicked.lane]}`
                  : `Added to ${PILL_TITLE[justPicked.lane]} tasks`}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onOpenRow(null)}
                aria-label="Hide scheduling options"
                className="grid h-[17px] w-[17px] place-items-center rounded-[5px] text-ink-3 transition-colors hover:text-ink"
              >
                <i className="ti ti-chevron-right text-[12px]" aria-hidden="true" />
              </button>
            )}

            {COLUMNS.map((col) => {
              const on = justPicked
                ? !justPicked.removed && justPicked.lane === col.key
                : task.lane === col.key;
              return (
                <button
                  key={col.key}
                  type="button"
                  disabled={busy}
                  onClick={() => pick(col.key)}
                  aria-pressed={on}
                  title={
                    task.lane === col.key
                      ? `Remove from ${PILL_TITLE[col.key]} (and the priority board)`
                      : `Add to ${PILL_TITLE[col.key]} (also adds to the priority board)`
                  }
                  className={cn(
                    PILL_BASE,
                    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-50',
                    on ? col.pillOn : 'bg-line-2 text-ink-3 hover:bg-line hover:text-ink-2',
                  )}
                >
                  {PILL_LETTER[col.key]}
                </button>
              );
            })}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onOpenRow(task.id)}
            aria-label={`Schedule ${task.name}`}
            aria-expanded={false}
            className="flex w-full items-center justify-end gap-1.5 py-1 text-ink-3 transition-colors hover:text-ink"
          >
            {current ? (
              <span className={cn(PILL_BASE, current.pillOn)}>{PILL_LETTER[current.key]}</span>
            ) : null}
            <i className="ti ti-clock text-[14px]" aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}
