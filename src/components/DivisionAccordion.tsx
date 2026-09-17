'use client';

import { useId, useState } from 'react';

import { cn } from '@/lib/utils';

type DivisionAccordionProps = {
  name: string;
  /** Division avatar colour; null for the trailing "No division" group. */
  colour: string | null;
  count: number;
  /** Singular unit for the count badge, e.g. "task" or "file". */
  unit?: string;
  defaultOpen?: boolean;
  /**
   * Controlled open state. When provided (together with `onToggle`), the caller
   * owns the open/closed state — used by the tasks list to persist and restore
   * expanded divisions across Back navigation. Omit both to keep the default
   * self-contained behaviour (used by the timeline-files grouped list).
   */
  open?: boolean;
  onToggle?: () => void;
  /**
   * Stable DOM id for the outer section, so another control on the page can
   * scroll this group into view. `useId` cannot serve: it is unique per mount,
   * not derivable from the division being addressed.
   */
  anchorId?: string;
  children: React.ReactNode;
};

/**
 * A collapsible division group for the grouped tasks / timeline-files lists.
 * A tappable header — colour spine, division name, count badge, chevron —
 * toggles a smoothly-animated body (grid-template-rows trick; see
 * globals.css). Defaults collapsed, so switching to "Group by division"
 * shows just the division names; tap a header to reveal its items.
 */
export function DivisionAccordion({
  name,
  colour,
  count,
  unit = 'item',
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  anchorId,
  children,
}: DivisionAccordionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const toggle = () => {
    if (isControlled) onToggle?.();
    else setInternalOpen((v) => !v);
  };
  const bodyId = useId();

  return (
    <section
      id={anchorId}
      // scroll-mt clears the app's sticky header (h-14 phone / h-16 up) when
      // something scrolls this group into view, so the card's own header is
      // not left tucked underneath it.
      className="relative overflow-hidden rounded-xl border border-line bg-panel shadow-card scroll-mt-20 md:scroll-mt-24"
      // A whisper of the division's own colour, so a long scroll through
      // several divisions never leaves you unsure which one you are reading.
      // Mixed into --panel rather than laid over it as translucency, so it
      // stays opaque and re-mixes correctly against the dark theme's panel.
      style={
        colour
          ? { backgroundColor: `color-mix(in srgb, ${colour} 5%, var(--panel))` }
          : undefined
      }
    >
      {colour ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1"
          style={{ background: colour }}
        />
      ) : null}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className={cn(
          // Darken on hover instead of painting --bg over the tint, which
          // would make the panel look like it loses its colour.
          'w-full flex items-center gap-2.5 py-3 pr-3 text-left transition-colors hover:bg-ink/[0.03]',
          colour ? 'pl-4' : 'pl-3.5',
        )}
      >
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {name}
        </span>
        <span
          className={cn(
            'shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-medium tabular-nums',
            !colour && 'border border-line bg-bg text-ink-2',
          )}
          style={
            colour
              ? {
                  color: colour,
                  backgroundColor: `color-mix(in srgb, ${colour} 12%, transparent)`,
                }
              : undefined
          }
        >
          {count} {count === 1 ? unit : `${unit}s`}
        </span>
        <i
          className={cn(
            'ti ti-chevron-down text-[15px] text-ink-3 shrink-0 transition-transform duration-[var(--dur-base)]',
            open ? 'rotate-0' : '-rotate-90',
          )}
          aria-hidden="true"
        />
      </button>

      <div id={bodyId} className={cn('accordion-body', open && 'is-open')}>
        <div className="accordion-inner">
          <div className={cn('border-t border-line-2 pt-3 pb-3.5', colour ? 'pl-4 pr-3.5' : 'px-3.5')}>
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
