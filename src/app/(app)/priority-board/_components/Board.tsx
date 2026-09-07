'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Sortable from 'sortablejs';

import { Avatar, Pill } from '@/components/ui';
import { setJsPriorityLaneAction, reorderBoardAction } from '@/app/actions/tasks';
import { formatDue } from '@/lib/format';
import { TASK_STATUS_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';

import { useRemoveMode } from './RemoveMode';
import { useAccordion } from './AccordionState';

import type { PillJsLane, PillStatusTone } from '@/components/ui/Pill';

/**
 * JS Priority Board — per PRD §5.3.
 *
 * Four lanes visible simultaneously, horizontally swipeable on narrow
 * viewports (snap scrolling). Cards drag between lanes when the caller is
 * OSD or Super Admin; everyone else sees the board read-only.
 *
 * Curators also get `BoardSearch` — a compact search box the page places in
 * its header (top-right on desktop, full-width on mobile). Results open in
 * an anchored popover; each result can be dragged straight onto a lane
 * (same Sortable group) or added with a tap on a lane chip.
 */

/** One Sortable group spans the lanes and the search popover, so a result
 *  chip can be dropped onto any lane. */
const BOARD_GROUP = 'js-priority-board';

export type BoardTask = {
  id: string;
  refNumber?: string | null;
  name: string;
  status: string;
  priority: string;
  jsPriorityLane: PillJsLane;
  divisionName: string;
  due: Date | null;
  owner: {
    name: string;
    initials: string;
    colour: string;
  };
};

/** A search-result candidate (due arrives as an ISO string from the API). */
type TrayTask = Omit<BoardTask, 'jsPriorityLane' | 'due'> & {
  jsPriorityLane: PillJsLane | null;
  due: string | null;
};

type BoardProps = {
  tasksByLane: Record<PillJsLane, BoardTask[]>;
  /** When true, drag-and-drop is enabled and OSD can curate */
  canCurate: boolean;
};

const LANES: { id: PillJsLane; label: string; sub: string }[] = [
  { id: 'today', label: 'Today', sub: 'Eyes on this now' },
  { id: 'week', label: 'This week', sub: 'Lands inside the week' },
  { id: 'month', label: 'This month', sub: 'On the monthly horizon' },
  { id: 'watchlist', label: 'Watchlist', sub: 'Hold open, revisit' },
];

const LANE_SHORT: Record<PillJsLane, string> = {
  today: 'Today',
  week: 'Week',
  month: 'Month',
  watchlist: 'Watch',
};

/**
 * Lane surfaces. Today → This month fades from the strongest indigo wash to
 * the lightest; Watchlist keeps its frosted glass panel (.glass-card) but
 * with an amber wash in place of the neutral corner tint.
 *
 * This intentionally inverts CLAUDE.md's two-accent rule (indigo is
 * otherwise Super Admin/Timeline File only, amber is otherwise the JS
 * Priority signal) — requested explicitly for this board's lane
 * backgrounds, 2026-07-09. Everything else amber (JS Priority badge,
 * lane counts, left-stripe on JS-priority cards) is unchanged.
 */
const LANE_TINT: Partial<Record<PillJsLane, React.CSSProperties>> = {
  today: {
    background:
      'linear-gradient(180deg, color-mix(in srgb, var(--primary-soft) 95%, transparent) 0%, color-mix(in srgb, var(--primary-soft) 58%, transparent) 100%)',
  },
  week: {
    background:
      'linear-gradient(180deg, color-mix(in srgb, var(--primary-soft) 60%, transparent) 0%, color-mix(in srgb, var(--primary-soft) 32%, transparent) 100%)',
  },
  month: {
    background:
      'linear-gradient(180deg, color-mix(in srgb, var(--primary-soft) 30%, transparent) 0%, color-mix(in srgb, var(--primary-soft) 12%, transparent) 100%)',
  },
  watchlist: {
    background:
      'linear-gradient(180deg, color-mix(in srgb, var(--accent-soft) 60%, transparent) 0%, color-mix(in srgb, var(--accent-soft) 32%, transparent) 100%)',
  },
};

const LANE_BORDER: Record<PillJsLane, string> = {
  today: 'border border-primary-line',
  week: 'border border-primary-line/70',
  month: 'border border-primary-line/40',
  watchlist: '', // .glass-card carries its own border
};

/** Touch-friendly Sortable options: press-and-hold to drag, so a swipe
 *  scrolls the board instead of grabbing a card. */
const TOUCH_OPTS = {
  delay: 150,
  delayOnTouchOnly: true,
  touchStartThreshold: 4,
} as const;

/** Auto-scroll while dragging. With `forceFallback` the built-in auto-scroll
 *  only kicks in when `forceAutoScrollFallback` is set — needed so the tall
 *  vertical mobile board scrolls the window as a card nears a viewport edge. */
const SCROLL_OPTS = {
  scroll: true,
  forceAutoScrollFallback: true,
  scrollSensitivity: 80,
  scrollSpeed: 14,
} as const;

/**
 * Persist a move: optionally change the task's lane, then (when an order
 * snapshot is provided) persist the lane's order. Returns an error message
 * or null. Shared by lane-to-lane drags, popover drops, and tap-to-add.
 */
async function persistLaneMove(
  taskId: string,
  toLane: PillJsLane,
  orderedIds: string[] | null,
  changeLane: boolean,
): Promise<string | null> {
  if (changeLane) {
    const fd = new FormData();
    fd.set('taskId', taskId);
    fd.set('lane', toLane);
    const laneResult = await setJsPriorityLaneAction(undefined, fd);
    if (!laneResult.ok) return laneResult.error ?? 'Could not update JS Priority.';
  }
  if (orderedIds && orderedIds.length > 0) {
    const reorderFd = new FormData();
    reorderFd.set('payload', JSON.stringify({ lane: toLane, taskIds: orderedIds }));
    const reorderResult = await reorderBoardAction(undefined, reorderFd);
    if (!reorderResult.ok) return reorderResult.error ?? 'Could not save order.';
  }
  return null;
}

/** Snapshot a lane list's task ids at their current DOM order (deduped —
 *  the task's existing card may already sit in the lane). */
function snapshotLaneOrder(laneEl: HTMLElement): string[] {
  return Array.from(
    new Set(
      Array.from(laneEl.querySelectorAll<HTMLElement>('[data-task-id]')).map(
        (n) => n.dataset.taskId!,
      ),
    ),
  );
}

// ------------------------------------------------------------
// Board — the four lanes
// ------------------------------------------------------------

export function Board({ tasksByLane, canCurate }: BoardProps) {
  const router = useRouter();
  const { removeMode } = useRemoveMode();
  const { collapsed, toggle, expand } = useAccordion();
  const [pending, startTransition] = useTransition();
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  // Past the md breakpoint every lane is shown (no accordion). Tracked in
  // state so the header's aria-expanded and tap-to-toggle reflect reality
  // rather than the collapse flag CSS ignores on desktop.
  const [isDesktop, setIsDesktop] = useState(false);

  const listRefs = useRef<Record<string, HTMLUListElement | null>>({});
  const sortablesRef = useRef<Sortable[]>([]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  /** Take a task off the board — unset its JS Priority lane (lane = ''). */
  const handleRemove = (taskId: string) => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('taskId', taskId);
      fd.set('lane', ''); // empty → null → drops off the board
      const res = await setJsPriorityLaneAction(undefined, fd);
      if (!res.ok) {
        setErrorBanner(res.error ?? 'Could not remove task.');
        setTimeout(() => setErrorBanner(null), 4000);
      }
      router.refresh();
    });
  };

  useEffect(() => {
    sortablesRef.current.forEach((s) => s.destroy());
    sortablesRef.current = [];
    if (!canCurate) return;

    LANES.forEach((lane) => {
      const el = listRefs.current[lane.id];
      if (!el) return;
      const s = Sortable.create(el, {
        group: BOARD_GROUP,
        animation: 200,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        forceFallback: true,
        fallbackOnBody: true,
        emptyInsertThreshold: 32,
        ...SCROLL_OPTS,
        // Neither the "Drop tasks here" placeholder nor the remove-mode X may
        // start a drag — clicking the X must fire its own handler instead.
        filter: '.lane-empty, .lane-remove-btn',
        preventOnFilter: false,
        ...TOUCH_OPTS,
        onStart: () => document.body.classList.add('sortable-dragging'),
        onEnd: (evt) => {
          document.body.classList.remove('sortable-dragging');
          const item = evt.item as HTMLElement;
          // The Sortable item is the <li> wrapper; the id may sit on it or on
          // a descendant (the card) — resolve either way.
          const taskId =
            item.dataset.taskId ??
            item.querySelector<HTMLElement>('[data-task-id]')?.dataset.taskId;
          const toLane = (evt.to as HTMLElement).dataset.laneId as PillJsLane | undefined;
          const fromLane = (evt.from as HTMLElement).dataset.laneId as PillJsLane | undefined;
          if (!taskId || !toLane) return;
          // Keep the lane that received the drop open once the drag ends.
          expand(toLane);
          if (toLane === fromLane && evt.newIndex === evt.oldIndex) return;

          // Snapshot the target order at the drop position BEFORE reverting.
          const orderedIds = snapshotLaneOrder(evt.to as HTMLElement);

          // Revert Sortable's cross-list DOM move so React reconciles from its
          // own tree when the refreshed server data arrives.
          const from = evt.from as HTMLElement;
          from.insertBefore(item, from.children[evt.oldIndex ?? 0] ?? null);

          startTransition(async () => {
            const error = await persistLaneMove(taskId, toLane, orderedIds, toLane !== fromLane);
            if (error) {
              setErrorBanner(error);
              setTimeout(() => setErrorBanner(null), 4000);
            }
            router.refresh();
          });
        },
      });
      sortablesRef.current.push(s);
    });

    return () => {
      sortablesRef.current.forEach((s) => s.destroy());
      sortablesRef.current = [];
    };
  }, [canCurate, tasksByLane, router, expand]);

  return (
    <div>
      {pending ? (
        <p className="text-[11px] text-ink-3 mb-2" role="status">Saving…</p>
      ) : null}
      {errorBanner ? (
        <p
          role="alert"
          className="mb-3 text-[12px] text-urgent bg-urgent-soft border border-urgent/20 rounded-lg px-3 py-2"
        >
          {errorBanner}
        </p>
      ) : null}

      <div
        className={cn(
          'board-print-area grid gap-3 md:gap-4',
          // Mobile: a single vertical column of collapsible accordion panels.
          // Tablet: 2 columns; laptop+: the classic 4-column board. Print
          // always lays out all four lanes side by side regardless of the
          // screen size the print was triggered from.
          'grid-cols-1 md:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 print:gap-2',
        )}
      >
        {LANES.map((lane) => (
          <Lane
            key={lane.id}
            lane={lane}
            tasks={tasksByLane[lane.id] ?? []}
            registerRef={(el) => (listRefs.current[lane.id] = el)}
            canCurate={canCurate}
            removeMode={canCurate && removeMode}
            onRemove={handleRemove}
            collapsed={collapsed[lane.id]}
            onToggle={toggle}
            isDesktop={isDesktop}
          />
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// PrintBoardButton — triggers the browser's print dialog; the
// board-print-area rules below (globals.css) format the four lanes
// for a landscape page in colour. "Save as PDF" in that dialog is
// how this becomes a shareable PDF, so no PDF library is needed.
// ------------------------------------------------------------

export function PrintBoardButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-line bg-panel text-[12.5px] font-medium text-ink-2 shadow-card transition-colors hover:border-ink-4 hover:text-ink"
    >
      <i className="ti ti-printer text-[14px]" aria-hidden="true" />
      Print board
    </button>
  );
}

// ------------------------------------------------------------
// BoardSearch — compact header search with an anchored results
// popover; rendered by the page in its top-right header slot.
// ------------------------------------------------------------

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_MIN_LENGTH = 2;

export function BoardSearch() {
  const router = useRouter();
  const { expand } = useAccordion();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<TrayTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // While a result is being dragged, hide the results popover so it doesn't
  // cover the board — the drag ghost floats on <body>, so the list can stay
  // mounted (kept as-is for Sortable) while being visually hidden.
  const [draggingHidden, setDraggingHidden] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (debounced.length < SEARCH_MIN_LENGTH) {
      setResults([]);
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    fetch(`/api/priority-board/search?q=${encodeURIComponent(debounced)}`, {
      signal: ctl.signal,
      cache: 'no-store',
    })
      .then(async (r) => {
        if (!r.ok) throw new Error('Search failed');
        return (await r.json()) as { tasks: TrayTask[] };
      })
      .then((data) => {
        // Never swap the results out from under an in-flight drag: doing so
        // would unmount the dragged chip's list, and Sortable.destroy() fires
        // no `end` event — stranding the global drag state (every lane would
        // stay force-expanded). Let the drop finish; results refresh after.
        if (document.body.classList.contains('sortable-dragging')) return;
        setResults(data.tasks);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setLoading(false);
      });
    return () => ctl.abort();
  }, [debounced]);

  const open = !dismissed && debounced.length >= SEARCH_MIN_LENGTH;

  // Close on Escape / outside mousedown — but never mid-drag (the drop lands
  // outside the popover by design).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDismissed(true);
    };
    const onDown = (e: MouseEvent) => {
      if (document.body.classList.contains('sortable-dragging')) return;
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setDismissed(true);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  /** Optimistically stamp a result's lane badge once it lands on the board. */
  const markOnBoard = (taskId: string, lane: PillJsLane) => {
    setResults((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, jsPriorityLane: lane } : t)),
    );
  };

  const apply = (taskId: string, toLane: PillJsLane, orderedIds: string[] | null) => {
    startTransition(async () => {
      const err = await persistLaneMove(taskId, toLane, orderedIds, true);
      if (err) {
        setError(err);
        setTimeout(() => setError(null), 4000);
      } else {
        markOnBoard(taskId, toLane);
      }
      router.refresh();
    });
  };

  // Drag OUT of the popover into any lane. `pull: 'clone'` keeps the list
  // intact; on drop we snapshot the target order, then put the DOM back
  // exactly as React rendered it before persisting — so React's tree is
  // never left mutated underneath it.
  const hasResults = results.length > 0;
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const s = Sortable.create(el, {
      group: { name: BOARD_GROUP, pull: 'clone', put: false },
      sort: false,
      animation: 200,
      forceFallback: true,
      fallbackOnBody: true,
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      ...SCROLL_OPTS,
      filter: 'button, a',
      preventOnFilter: false,
      ...TOUCH_OPTS,
      onStart: () => {
        document.body.classList.add('sortable-dragging');
        // Grabbing a result hides the popover, freeing the full screen so the
        // task can be dropped into any (now force-expanded) lane.
        setDraggingHidden(true);
      },
      onEnd: (evt) => {
        document.body.classList.remove('sortable-dragging');
        setDraggingHidden(false);
        const to = evt.to as HTMLElement;
        const toLane = to.dataset.laneId as PillJsLane | undefined;
        if (!toLane) return; // dropped back on the list — Sortable reverts

        const item = evt.item as HTMLElement;
        const taskId = item.dataset.taskId;
        const orderedIds = snapshotLaneOrder(to);

        // Restore the DOM for React: original chip back where the clone
        // sits, clone removed.
        const clone = evt.clone as HTMLElement | undefined;
        if (clone && clone.parentNode) {
          clone.parentNode.insertBefore(item, clone);
          clone.remove();
        } else {
          item.remove();
        }

        if (!taskId) return;

        // Keep the destination lane open so the dropped task is visible.
        expand(toLane);

        // Successful drop onto a lane — instantly close the results popover
        // and clear the typed query, rather than leaving stale results open.
        setQuery('');
        setDebounced('');
        setDismissed(true);

        apply(taskId, toLane, orderedIds);
      },
    });
    return () => {
      s.destroy();
      // Defensive: if this list unmounts mid-drag (Escape, or results emptied
      // by an in-flight fetch), destroy() dispatches no `end` event — so clear
      // the global drag state here, otherwise every lane stays force-expanded
      // and the popover can't be dismissed.
      document.body.classList.remove('sortable-dragging');
      setDraggingHidden(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasResults]);

  return (
    <div ref={wrapRef} className="relative w-full md:w-[340px] lg:w-[400px]">
      <div className="relative">
        <i
          className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-ink-3 pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setDismissed(false);
          }}
          onFocus={() => setDismissed(false)}
          placeholder="Search tasks to add…"
          aria-label="Search tasks to add to the board"
          role="combobox"
          aria-expanded={open}
          aria-controls="board-search-results"
          autoComplete="off"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-line bg-panel text-[13px] text-ink placeholder:text-ink-3 shadow-card outline-none transition-colors focus:border-ink"
        />
        {pending ? (
          <i
            className="ti ti-loader-2 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-ink-3"
            aria-hidden="true"
          />
        ) : null}
      </div>

      {open ? (
        <div
          id="board-search-results"
          className={cn(
            'glass-card absolute right-0 top-full mt-2 z-30 w-full md:w-[min(420px,calc(100vw-2rem))] rounded-xl p-2',
            // Hidden (but still mounted) while a result is being dragged.
            draggingHidden && 'invisible pointer-events-none',
          )}
        >
          <p className="px-2 pt-1 pb-1.5 text-[10px] uppercase tracking-[0.06em] font-medium text-ink-3">
            {loading && !hasResults
              ? 'Searching…'
              : hasResults
                ? `${results.length} ${results.length === 1 ? 'match' : 'matches'} — drag onto a lane, or tap a lane chip`
                : `No open tasks match "${debounced}"`}
          </p>

          {error ? (
            <p role="alert" className="mx-2 mb-1.5 text-[11px] text-urgent">
              {error}
            </p>
          ) : null}

          {hasResults ? (
            <ul
              ref={listRef}
              className="flex flex-col gap-1.5 max-h-[min(46dvh,380px)] overflow-y-auto overscroll-contain p-0.5"
            >
              {results.map((t) => (
                <TrayCard
                  key={t.id}
                  task={t}
                  disabled={pending}
                  onAdd={(lane) => apply(t.id, lane, null)}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TrayCard({
  task,
  disabled,
  onAdd,
}: {
  task: TrayTask;
  disabled: boolean;
  onAdd: (lane: PillJsLane) => void;
}) {
  return (
    <li
      data-task-id={task.id}
      className="rounded-xl border border-line bg-panel p-2.5 cursor-grab active:cursor-grabbing shadow-card"
    >
      <div className="flex items-start gap-1.5">
        <i className="ti ti-grip-vertical text-[13px] text-ink-3 mt-[2px] shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          {task.refNumber ? (
            <span className="font-mono text-[9px] text-ink-3 tracking-wide block">
              {task.refNumber}
            </span>
          ) : null}
          <span className="block text-[12.5px] font-medium text-ink leading-snug truncate">
            {task.name}
          </span>
          <span className="block text-[10px] text-ink-3 truncate mt-0.5">
            {task.divisionName} · {task.owner.name}
          </span>
        </div>
        <Avatar
          initials={task.owner.initials}
          colour={task.owner.colour}
          size="xs"
          ariaLabel={`Owner ${task.owner.name}`}
        />
      </div>

      <div className="mt-2 flex items-center gap-1 flex-wrap">
        {task.jsPriorityLane ? (
          <span className="inline-flex items-center gap-1 text-[9.5px] font-medium text-accent bg-accent-soft border border-accent-line px-1.5 py-0.5 rounded-pill">
            <i className="ti ti-bookmark-filled text-[8px]" aria-hidden="true" />
            On board · {LANE_SHORT[task.jsPriorityLane]}
          </span>
        ) : null}
        <span className="flex-1" />
        {LANES.map((lane) => (
          <button
            key={lane.id}
            type="button"
            disabled={disabled || task.jsPriorityLane === lane.id}
            onClick={() => onAdd(lane.id)}
            title={`Add to ${lane.label}`}
            className={cn(
              'px-1.5 py-0.5 rounded-md border text-[9.5px] font-medium transition-colors',
              task.jsPriorityLane === lane.id
                ? 'border-accent-line bg-accent-soft text-accent cursor-default'
                : 'border-line bg-bg text-ink-2 hover:border-ink-4 hover:text-ink disabled:opacity-50',
            )}
          >
            {LANE_SHORT[lane.id]}
          </button>
        ))}
      </div>
    </li>
  );
}

// ------------------------------------------------------------
// Lane
// ------------------------------------------------------------

function Lane({
  lane,
  tasks,
  registerRef,
  canCurate,
  removeMode,
  onRemove,
  collapsed,
  onToggle,
  isDesktop,
}: {
  lane: { id: PillJsLane; label: string; sub: string };
  tasks: BoardTask[];
  registerRef: (el: HTMLUListElement | null) => void;
  canCurate: boolean;
  removeMode: boolean;
  onRemove: (taskId: string) => void;
  collapsed: boolean;
  onToggle: (lane: PillJsLane) => void;
  isDesktop: boolean;
}) {
  const isGlass = lane.id === 'watchlist';
  const bodyId = `lane-body-${lane.id}`;
  // Desktop shows every lane regardless of the collapse flag, so the header
  // reflects "expanded" there; mobile mirrors the actual collapse state.
  const expanded = isDesktop || !collapsed;
  return (
    <section
      aria-labelledby={`lane-${lane.id}`}
      style={LANE_TINT[lane.id]}
      className={cn(
        // Taller lanes so the board reads as a substantial working surface
        // rather than a strip with a lot of dead space beneath 1-2 items.
        // Print drops the floor back to the lane's real content height —
        // a shared handout should be dense, not padded with blank paper.
        'rounded-2xl overflow-hidden md:flex md:flex-col md:min-h-[600px] print:min-h-0',
        LANE_BORDER[lane.id],
        isGlass && 'glass-card',
      )}
    >
      {/* Header — a full-width accordion toggle on mobile, a plain lane header
          on desktop (the tap-to-collapse is a no-op past the md breakpoint). */}
      <button
        type="button"
        onClick={() => {
          // Desktop always shows every lane; only toggle on mobile widths.
          if (isDesktop) return;
          onToggle(lane.id);
        }}
        aria-expanded={expanded}
        aria-controls={bodyId}
        aria-label={`${lane.label}, ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}
        className={cn(
          'w-full flex items-center justify-between gap-2 text-left p-3 select-none',
          'cursor-pointer md:cursor-default transition-colors active:bg-ink/5 md:active:bg-transparent',
          !collapsed && 'border-b border-line/60',
          'md:border-b md:border-line/60',
        )}
      >
        <div className="min-w-0">
          <h2 id={`lane-${lane.id}`} className="font-serif text-[17px] text-ink leading-none">
            {lane.label}
          </h2>
          <p className="text-[10px] text-ink-3 mt-1">{lane.sub}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={cn(
              'text-[11px] font-medium px-2 py-0.5 rounded-pill border',
              tasks.length > 0
                ? 'bg-accent-soft text-accent border-accent-line'
                : 'bg-bg text-ink-3 border-line',
            )}
          >
            {tasks.length}
          </span>
          <i
            className={cn(
              'ti ti-chevron-down text-[16px] text-ink-3 transition-transform duration-[var(--dur-base)] md:hidden',
              collapsed ? '-rotate-90' : 'rotate-0',
            )}
            aria-hidden="true"
          />
        </div>
      </button>

      {/* Collapsible body. Open state animates via grid-template-rows (see
          globals.css); desktop and in-drag force it open. */}
      <div id={bodyId} className={cn('pb-accordion-body', !collapsed && 'is-open')}>
        <div className="pb-accordion-inner">
          <ul
            ref={registerRef}
            data-lane-id={lane.id}
            className={cn(
              'flex flex-col gap-2 px-3 pb-3 min-h-[140px] md:flex-1 md:min-h-[200px] rounded-lg',
              canCurate && 'sortable-target',
            )}
          >
            {tasks.length === 0 ? (
              <li
                className="lane-empty text-center text-[11px] text-ink-3 italic rounded-lg border border-dashed border-line py-8"
                aria-hidden="true"
              >
                <i className="ti ti-inbox text-[22px] block mb-1 opacity-40" />
                {canCurate ? 'Drop tasks here' : 'Empty'}
              </li>
            ) : (
              tasks.map((t) => (
                // data-task-id on the <li> — it is the Sortable draggable item,
                // so evt.item.dataset.taskId resolves in the drag handler.
                <li key={t.id} data-task-id={t.id}>
                  <LaneCard
                    task={t}
                    canCurate={canCurate}
                    removeMode={removeMode}
                    onRemove={onRemove}
                  />
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------
// LaneCard — dense draggable list row for the board (was a padded
// card; a lane with a dozen tasks made the whole board unreadably
// tall). Keeps every piece of information and every interaction the
// card had — drag handle, priority dot, ref number, status, due
// date, owner avatar, remove-mode button, click-through to the task
// — just laid out as a two-line row instead of a boxed card.
// ------------------------------------------------------------

function LaneCard({
  task,
  canCurate,
  removeMode,
  onRemove,
}: {
  task: BoardTask;
  canCurate: boolean;
  removeMode: boolean;
  onRemove: (taskId: string) => void;
}) {
  const due = formatDue(task.due);
  return (
    <div
      className={cn(
        'relative flex flex-col gap-1 border-l-2 border-accent border-b border-line-2 py-1.5 pl-2.5 pr-2 transition-colors hover:bg-panel/70',
        canCurate ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        removeMode && 'pr-8',
      )}
    >
      {removeMode ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove(task.id);
          }}
          aria-label={`Remove ${task.name} from the board`}
          title="Remove from board"
          className="lane-remove-btn print:hidden absolute top-1 right-1 z-10 grid h-6 w-6 place-items-center rounded-full bg-urgent text-white shadow-card transition-colors hover:bg-urgent/90 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-urgent"
        >
          <i className="ti ti-x text-[13px]" aria-hidden="true" />
        </button>
      ) : null}

      {/* Line 1 — drag handle, priority, ref number, name, division (right) */}
      <div className="flex items-center gap-1.5">
        {canCurate ? (
          <i
            className="ti ti-grip-vertical text-[13px] text-ink-3 shrink-0 print:hidden"
            aria-hidden="true"
          />
        ) : null}
        <span
          className={cn(
            'w-2 h-2 rounded-full shrink-0',
            task.priority === 'urgent' && 'bg-urgent',
            task.priority === 'high' && 'bg-high',
            task.priority === 'medium' && 'bg-medium',
            task.priority === 'low' && 'bg-low',
          )}
          aria-label={`${task.priority} priority`}
        />
        {task.refNumber ? (
          <span className="font-mono text-[9.5px] text-ink-3 tracking-wide shrink-0">
            {task.refNumber}
          </span>
        ) : null}
        <Link
          href={`/tasks/${task.id}`}
          className="group flex-1 min-w-0 flex items-baseline justify-between gap-2"
        >
          <span className="truncate text-[13px] font-medium text-ink leading-snug group-hover:underline">
            {task.name}
          </span>
          <span className="shrink-0 max-w-[45%] truncate text-[10.5px] text-ink-3">
            {task.divisionName}
          </span>
        </Link>
      </div>

      {/* Line 2 — status, due date, owner */}
      <div className="flex items-center justify-between gap-2">
        <Pill
          variant="status"
          tone={task.status as PillStatusTone}
          label={TASK_STATUS_LABEL[task.status] ?? task.status}
        />
        <div className="flex items-center gap-2 text-[10px] text-ink-3 shrink-0">
          {due.tone !== 'none' ? (
            <span
              className={cn(
                due.tone === 'overdue' && 'text-urgent font-medium',
                due.tone === 'today' && 'text-accent font-medium',
              )}
            >
              {due.label}
            </span>
          ) : null}
          <Avatar
            initials={task.owner.initials}
            colour={task.owner.colour}
            size="xs"
            ariaLabel={`Owner ${task.owner.name}`}
          />
        </div>
      </div>
    </div>
  );
}
