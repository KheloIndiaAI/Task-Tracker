import Link from 'next/link';

import type { BusinessCardDto } from '@/lib/business-cards-shared';

/**
 * Presentational contact card — Event, Name, Company, Mobile, Email. A plain
 * link on desktop; on mobile it is wrapped by BusinessCardInteractive, which
 * adds the swipe → image slide-over gesture (consistent with the task /
 * timeline-file / document cards).
 */
export function BusinessCardCard({ card }: { card: BusinessCardDto }) {
  return (
    <Link
      href={`/business-cards/${card.id}`}
      className="block h-full rounded-xl border border-line bg-panel p-3.5 hover:border-ink-4 hover:shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        {card.eventName ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-[10px] font-medium bg-primary-soft text-primary border border-primary-line max-w-full truncate">
            <i className="ti ti-calendar-event text-[11px] shrink-0" aria-hidden="true" />
            <span className="truncate">{card.eventName}</span>
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-[0.08em] text-ink-4 font-medium">
            No event
          </span>
        )}
        {card.imageAttachments.length > 0 ? (
          <i className="ti ti-photo text-[13px] text-ink-3 shrink-0" aria-hidden="true" title="Has a business-card image" />
        ) : card.hasAttachment ? (
          <i className="ti ti-paperclip text-[13px] text-ink-3 shrink-0" aria-hidden="true" title="Has an attachment" />
        ) : null}
      </div>

      <p className="font-serif text-[16px] leading-snug text-ink truncate">{card.fullName}</p>
      <p className="text-[12px] text-ink-2 truncate">
        {card.jobTitle ? `${card.jobTitle}, ` : ''}
        {card.company}
      </p>

      <div className="mt-2 flex flex-col gap-1">
        {card.mobile ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2 truncate">
            <i className="ti ti-phone text-[13px] text-ink-3 shrink-0" aria-hidden="true" />
            {card.mobile}
          </span>
        ) : null}
        {card.email ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2 truncate">
            <i className="ti ti-mail text-[13px] text-ink-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{card.email}</span>
          </span>
        ) : null}
      </div>
    </Link>
  );
}
