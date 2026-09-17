'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

import { DivisionAccordion } from '@/components/DivisionAccordion';

/**
 * Preserves the "Group by division" list state across Back navigation.
 *
 * When a user expands a division, scrolls, then opens a task, hitting Back must
 * return them to the same expanded division at the same scroll position — not a
 * reset page. The URL already carries group mode / filters / sort / division
 * (restored by `router.back()`), but two bits are client-only React state that
 * a remount would drop:
 *
 *   - which divisions are expanded — persisted in sessionStorage, hydrated
 *     before paint (a layout effect) so the list reopens at the same height;
 *   - the window scroll position — saved on leave, restored once on return
 *     after the expanded content has laid out.
 *
 * Expanded state is remembered for the browsing session (mirrors the Priority
 * Board's accordion memory in AccordionState.tsx). Scroll is keyed per list URL
 * and consumed on restore, so it only ever lands you back where you left this
 * exact list — never on an unrelated view.
 *
 * The provider only wraps the grouped view; the segmented (default) view has no
 * accordions and keeps the browser's native scroll restoration.
 */

const EXPANDED_KEY = 'tasks-group-expanded';
const SCROLL_PREFIX = 'tasks-group-scroll:';

/**
 * DOM id of a division's accordion. Derived from the division id so any
 * control on the page can address a group it does not render itself — the
 * per-division PMU pills use it to jump to that PMU's own card below.
 */
export function taskGroupAnchorId(divisionId: string): string {
  return `task-group-${divisionId}`;
}

// useLayoutEffect warns during SSR; fall back to useEffect on the server. The
// hydration read is client-only anyway (sessionStorage), so this is safe.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

type TaskGroupState = {
  isOpen: (divisionId: string) => boolean;
  toggle: (divisionId: string) => void;
  /**
   * Expand a group (never collapse it) and scroll it into view. For jumping
   * between cards on this page — a PMU pill inside its parent division opening
   * the PMU's own card further down.
   */
  openAndReveal: (divisionId: string) => void;
};

const TaskGroupContext = createContext<TaskGroupState | null>(null);

function readExpanded(): Set<string> {
  try {
    const raw = sessionStorage.getItem(EXPANDED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr)
      ? new Set(arr.filter((x): x is string => typeof x === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

export function TaskGroupStateProvider({
  scrollKey,
  children,
}: {
  /** Stable identity of this list view (filters + sort + group) — scopes scroll. */
  scrollKey: string;
  children: React.ReactNode;
}) {
  // Empty on the server + first client render (stable, no hydration mismatch);
  // the real value is applied in the layout effect below, before paint.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const scrollStorageKey = SCROLL_PREFIX + scrollKey;

  // Hydrate expanded divisions + restore scroll, before the browser paints, so
  // the accordions open at their previous height and the scroll lands on the
  // same card. Runs once on mount.
  useIsomorphicLayoutEffect(() => {
    const restored = readExpanded();
    if (restored.size > 0) setExpanded(restored);

    let savedY: number | null = null;
    try {
      const raw = sessionStorage.getItem(scrollStorageKey);
      if (raw != null) {
        savedY = Number.parseInt(raw, 10);
        // One-shot: consume so a later unrelated visit doesn't jump.
        sessionStorage.removeItem(scrollStorageKey);
      }
    } catch {
      /* storage unavailable (private mode) — non-fatal */
    }

    if (savedY != null && !Number.isNaN(savedY)) {
      const target = savedY;
      // Land after the expanded content has committed at full height.
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, target)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save the scroll position when leaving the list — on client-side navigation
  // (effect cleanup) and on hard navigation / tab hide (pagehide).
  useEffect(() => {
    const save = () => {
      try {
        sessionStorage.setItem(scrollStorageKey, String(Math.round(window.scrollY)));
      } catch {
        /* non-fatal */
      }
    };
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [scrollStorageKey]);

  const toggle = useCallback((divisionId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(divisionId)) next.delete(divisionId);
      else next.add(divisionId);
      try {
        sessionStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        /* non-fatal */
      }
      return next;
    });
  }, []);

  const openAndReveal = useCallback((divisionId: string) => {
    // Open only — a pill that says "go to this PMU" must never close the card
    // it is pointing at when the user taps it twice.
    setExpanded((prev) => {
      if (prev.has(divisionId)) return prev;
      const next = new Set(prev);
      next.add(divisionId);
      try {
        sessionStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        /* non-fatal */
      }
      return next;
    });

    // Scroll after the expansion has committed AND laid out — two frames, the
    // same wait the Back-restore above needs. The target sits below the pill
    // that was clicked, and a card grows downward, so its top does not move
    // while it opens; landing on it is stable either way.
    const reveal = () => {
      const el = document.getElementById(taskGroupAnchorId(divisionId));
      if (!el) return;
      const reduced =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    };
    requestAnimationFrame(() => requestAnimationFrame(reveal));
  }, []);

  const isOpen = useCallback((divisionId: string) => expanded.has(divisionId), [expanded]);
  const value = useMemo<TaskGroupState>(
    () => ({ isOpen, toggle, openAndReveal }),
    [isOpen, toggle, openAndReveal],
  );

  return <TaskGroupContext.Provider value={value}>{children}</TaskGroupContext.Provider>;
}

/**
 * A DivisionAccordion whose open state is owned by TaskGroupStateProvider, so it
 * persists across Back navigation. Outside a provider it degrades to the plain
 * self-contained accordion (used by the timeline-files grouped list).
 */
export function GroupedDivisionAccordion({
  persistId,
  ...rest
}: { persistId: string } & Omit<
  React.ComponentProps<typeof DivisionAccordion>,
  'open' | 'onToggle'
>) {
  const ctx = useContext(TaskGroupContext);
  if (!ctx) return <DivisionAccordion {...rest} anchorId={taskGroupAnchorId(persistId)} />;
  return (
    <DivisionAccordion
      {...rest}
      anchorId={taskGroupAnchorId(persistId)}
      open={ctx.isOpen(persistId)}
      onToggle={() => ctx.toggle(persistId)}
    />
  );
}

/**
 * Read the grouped-list state from a component rendered inside a card — the
 * PMU pills, which need to open a DIFFERENT card. Returns null outside the
 * provider (the timeline-files grouped list), so callers must degrade.
 */
export function useTaskGroupState(): TaskGroupState | null {
  return useContext(TaskGroupContext);
}
