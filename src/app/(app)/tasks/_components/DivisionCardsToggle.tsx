'use client';

import { useId, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Collapses a division's task cards behind a single control.
 *
 * The Daily / Weekly / Fortnight / Monthly list above already names every task
 * in the division, so repeating them as a wall of cards pushed the next
 * division off the screen. The cards hold detail the list does not — status,
 * owner, due date, subtask progress — so they stay one click away rather than
 * being dropped.
 *
 * Children are server-rendered cards passed straight through; this component
 * owns nothing but the open state.
 */
export function DivisionCardsToggle({
  count,
  completedCount,
  children,
}: {
  /** Active cards inside — shown on the control so it is worth opening. */
  count: number;
  /** Completed cards, listed after the active ones. */
  completedCount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <div className="mt-3 border-t border-line-2 pt-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5',
          'text-[12px] font-medium text-ink-2 transition-colors hover:border-ink-4 hover:text-ink',
        )}
      >
        <i
          className={cn(
            'ti ti-chevron-down text-[13px] transition-transform duration-[var(--dur-base)]',
            open ? 'rotate-0' : '-rotate-90',
          )}
          aria-hidden="true"
        />
        {open ? 'Hide task cards' : 'Show task cards'}
        <span className="rounded-pill border border-line bg-bg px-1.5 py-0.5 text-[10px] tabular-nums text-ink-3">
          {completedCount > 0 ? `${count} + ${completedCount} done` : count}
        </span>
      </button>

      <div id={bodyId} className={cn('accordion-body', open && 'is-open')}>
        <div className="accordion-inner">
          <div className="pt-2.5">{children}</div>
        </div>
      </div>
    </div>
  );
}
