'use client';

import { useMemo, type MouseEvent } from 'react';

import { useTaskCardGestures } from '@/components/ui/useTaskCardGestures';
import type { BusinessCardDto } from '@/lib/business-cards-shared';

import { BusinessCardCard } from './BusinessCardCard';
import { BusinessCardDetailSlideOver } from './BusinessCardDetailSlideOver';

/**
 * Mobile gesture layer around a contact card — the same swipe interaction as
 * the task / document / timeline-file cards (useTaskCardGestures), for
 * platform-wide consistency:
 *
 *   - swipe left → right-side read-only slide-over showing the attached
 *                  business-card image(s), scrolling within the panel.
 *   - tap        → navigates to the contact (unchanged).
 *
 * Touch-only: the hook attaches no listeners on desktop (precise pointer /
 * ≥768px), so desktop click-to-open is untouched. This module has no quick
 * actions, so the long-press modal is disabled (swipe-to-preview only).
 */
export function BusinessCardInteractive({ card }: { card: BusinessCardDto }) {
  const { ref, phase, swipeOffset, isDragging, suppressClickRef, isMobile, closeOverlay } =
    useTaskCardGestures({ longPressEnabled: false });

  const cardEl = useMemo(() => <BusinessCardCard card={card} />, [card]);

  const onClickCapture = (e: MouseEvent) => {
    if (suppressClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

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
        {cardEl}
      </div>

      <BusinessCardDetailSlideOver open={phase === 'slideover'} onClose={closeOverlay} card={card} />
    </div>
  );
}
