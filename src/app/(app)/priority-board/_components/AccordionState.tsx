'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import type { PillJsLane } from '@/components/ui/Pill';

/**
 * Shared collapse state for the Priority Board's mobile accordion sections.
 *
 * The board (lane panels) and the header search box are separate client
 * subtrees, but a search-drop needs to expand the lane it lands in — so the
 * per-lane open/closed state lives in context rather than local state.
 *
 * Sections default to collapsed; the last state is remembered in
 * localStorage. Desktop ignores this entirely (CSS keeps every lane open).
 */
const LANE_IDS: PillJsLane[] = ['today', 'week', 'month', 'fortnight'];
const STORAGE_KEY = 'pb-accordion-collapsed';

type CollapsedMap = Record<PillJsLane, boolean>;
const ALL_COLLAPSED: CollapsedMap = { today: true, week: true, month: true, fortnight: true };

type AccordionValue = {
  collapsed: CollapsedMap;
  toggle: (lane: PillJsLane) => void;
  expand: (lane: PillJsLane) => void;
};

const AccordionContext = createContext<AccordionValue | null>(null);

export function AccordionProvider({ children }: { children: React.ReactNode }) {
  // Start all-collapsed for a stable server/client first paint, then hydrate
  // the remembered state after mount (localStorage is client-only).
  const [collapsed, setCollapsed] = useState<CollapsedMap>(ALL_COLLAPSED);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<CollapsedMap>;
      setCollapsed((prev) => {
        const next = { ...prev };
        for (const id of LANE_IDS) {
          if (typeof saved[id] === 'boolean') next[id] = saved[id] as boolean;
        }
        return next;
      });
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  const persist = useCallback((next: CollapsedMap) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage may be unavailable (private mode) — non-fatal */
    }
  }, []);

  const toggle = useCallback(
    (lane: PillJsLane) => {
      setCollapsed((prev) => {
        const next = { ...prev, [lane]: !prev[lane] };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const expand = useCallback(
    (lane: PillJsLane) => {
      setCollapsed((prev) => {
        if (!prev[lane]) return prev; // already open — no state churn
        const next = { ...prev, [lane]: false };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  return (
    <AccordionContext.Provider value={{ collapsed, toggle, expand }}>
      {children}
    </AccordionContext.Provider>
  );
}

/** Read the shared accordion state. Safe outside a provider (all open). */
export function useAccordion(): AccordionValue {
  return (
    useContext(AccordionContext) ?? {
      collapsed: { today: false, week: false, month: false, fortnight: false },
      toggle: () => {},
      expand: () => {},
    }
  );
}
