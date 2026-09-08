'use client';

import { useMemo, type MouseEvent } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { HoverPreview } from '@/components/ui/HoverPreview';
import { TaskCard, type TaskCardProps } from '@/components/ui/TaskCard';
import { TaskActionModal } from '@/components/ui/TaskActionModal';
import { TaskDetailSlideOver } from '@/components/ui/TaskDetailSlideOver';
import { useTaskCardGestures } from '@/components/ui/useTaskCardGestures';
import { cn } from '@/lib/utils';

/**
 * Mobile gesture layer around a task card.
 *
 *   - swipe left  → right-side read-only slide-over (Title/Description/Due/Owner/Docs)
 *   - long press  → centered role-gated action modal
 *   - tap         → navigates to the task (unchanged)
 *
 * All gesture handling is touch-only and no-ops on desktop (the hook attaches
 * no listeners on precise-pointer / ≥768px), so the desktop hover-preview and
 * click-to-open behaviour are untouched. Permission booleans are computed on
 * the server and only gate what the modal offers — every action re-authorizes
 * server-side.
 */

export type TaskCardInteractiveProps = TaskCardProps & {
  canChangeStatus: boolean;
  canSetFortnight: boolean;
};

const RING_DEADZONE = 0.12; // hide the progress ring until a real hold begins
const RING_R = 20;
const RING_C = 2 * Math.PI * RING_R;

export function TaskCardInteractive(props: TaskCardInteractiveProps) {
  const { canChangeStatus, canSetFortnight, ...cardProps } = props;
  const longPressEnabled = canChangeStatus || canSetFortnight;

  const {
    ref,
    phase,
    swipeOffset,
    isDragging,
    longPressProgress,
    suppressClickRef,
    isMobile,
    closeOverlay,
  } = useTaskCardGestures({ longPressEnabled });

  // Memoize the card subtree so swipe/long-press state changes only update the
  // wrapper transform + the progress ring — never re-render the card itself.
  // Depend on the stable `props` reference (unchanged across the hook's own
  // state updates); TaskCard/TaskPreview ignore the two extra permission props.
  const card = useMemo(
    () => (
      <HoverPreview content={<TaskPreview {...props} />}>
        <TaskCard {...props} />
      </HoverPreview>
    ),
    [props],
  );

  const onClickCapture = (e: MouseEvent) => {
    if (suppressClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const showRing = longPressEnabled && longPressProgress > RING_DEADZONE;

  return (
    <div className="relative">
      {/* Swipe hint — a chevron peeking from the right, fading in with the peek. */}
      <div
        aria-hidden="true"
        className="md:hidden pointer-events-none absolute inset-y-0 right-2 flex items-center text-ink-3"
        style={{ opacity: Math.min(1, Math.abs(swipeOffset) / 40) }}
      >
        <i className="ti ti-chevron-left text-[18px]" />
      </div>

      {/* Swipe surface — the card follows the finger; tap still navigates.
          On a touch phone we suppress the browser's native link/text behaviours
          (iOS callout, Android context-menu, text-selection, tap highlight) —
          otherwise they fire ~0.5s into a hold/drag and dispatch touchcancel,
          killing the long-press timer and stealing slow swipes. Scoped to
          isMobile so desktop right-click / text-selection are untouched. */}
      <div
        ref={ref}
        onClickCapture={onClickCapture}
        onContextMenu={isMobile ? (e) => e.preventDefault() : undefined}
        style={{
          transform: `translateX(${swipeOffset}px)`,
          transition: isDragging ? 'none' : 'transform 200ms ease-out',
          touchAction: 'pan-y',
          ...(isMobile
            ? {
                WebkitTouchCallout: 'none',
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTapHighlightColor: 'transparent',
              }
            : {}),
        }}
        className="relative"
      >
        {card}

        {/* Long-press progress ring (indigo system chrome — not amber). */}
        {showRing ? (
          <div
            aria-hidden="true"
            className="md:hidden pointer-events-none absolute inset-0 grid place-items-center"
          >
            <svg width="52" height="52" viewBox="0 0 52 52" className="rotate-[-90deg]">
              <circle cx="26" cy="26" r={RING_R} fill="none" className="stroke-line-2" strokeWidth="3" />
              <circle
                cx="26"
                cy="26"
                r={RING_R}
                fill="none"
                className="stroke-primary"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - longPressProgress)}
              />
            </svg>
          </div>
        ) : null}
      </div>

      <TaskDetailSlideOver
        open={phase === 'slideover'}
        onClose={closeOverlay}
        href={cardProps.href ?? `/tasks/${cardProps.taskId}`}
        name={cardProps.name}
        refNumber={cardProps.refNumber}
        description={cardProps.description}
        dueLabel={cardProps.due?.label}
        dueTone={cardProps.due?.tone}
        ownerName={cardProps.owner.name}
        ownerInitials={cardProps.owner.initials}
        ownerColour={cardProps.owner.colour}
        docs={cardProps.attachmentDocs ?? []}
      />

      <TaskActionModal
        open={phase === 'modal'}
        onClose={closeOverlay}
        taskId={cardProps.taskId}
        name={cardProps.name}
        currentStatus={cardProps.status}
        currentLane={cardProps.jsPriorityLane ?? null}
        canChangeStatus={canChangeStatus}
        canSetFortnight={canSetFortnight}
      />
    </div>
  );
}

// ------------------------------------------------------------
// Desktop hover-preview content (unchanged from the original TaskListItem).
// ------------------------------------------------------------

const MAX_PREVIEW_DOCS = 4;

function TaskPreview({ name, description, owner, attachmentNames }: TaskCardProps) {
  const hasDescription = !!description && description.trim().length > 0;
  const docs = attachmentNames ?? [];
  const shownDocs = docs.slice(0, MAX_PREVIEW_DOCS);
  const extraDocs = docs.length - shownDocs.length;

  return (
    <div className="rounded-xl border border-line bg-bg p-3.5 shadow-[0_12px_32px_-10px_rgba(0,0,0,0.22)]">
      <p className="text-[12.5px] font-medium text-ink leading-snug line-clamp-2">{name}</p>

      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2 line-clamp-4">
        {hasDescription ? (
          description
        ) : (
          <span className="italic text-ink-3">No description</span>
        )}
      </p>

      {docs.length > 0 ? (
        <div className="mt-3 border-t border-line pt-2.5">
          <p className="text-[11px] uppercase tracking-[0.06em] text-ink-3 mb-1.5">Docs attached</p>
          <ul className="flex flex-col gap-1">
            {shownDocs.map((fileName, i) => (
              <li key={i} className="flex items-center gap-1.5 min-w-0">
                <i className="ti ti-paperclip text-[12px] text-ink-3 shrink-0" aria-hidden="true" />
                <span className="text-[12px] text-ink-2 truncate">{fileName}</span>
              </li>
            ))}
            {extraDocs > 0 ? (
              <li className="text-[11px] text-ink-3 pl-[18px]">and {extraDocs} more</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2 border-t border-line pt-2.5">
        <Avatar initials={owner.initials} colour={owner.colour} size="xs" ariaLabel={`Owner ${owner.name}`} />
        <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">Owner</span>
        <span className="ml-auto truncate text-[12px] font-medium text-ink">{owner.name}</span>
      </div>
    </div>
  );
}
