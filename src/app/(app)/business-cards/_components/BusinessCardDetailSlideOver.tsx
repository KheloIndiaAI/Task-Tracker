'use client';

import Link from 'next/link';

import { SlideOverShell, SlideOverSection } from '@/components/ui/SlideOverShell';
import type { BusinessCardDto } from '@/lib/business-cards-shared';

import { BusinessCardImages } from './BusinessCardImages';

/**
 * Right-side read-only slide-over for a contact card (mobile only). Opened by
 * swiping a card left — mirrors the task / Timeline-File / document card
 * slide-overs. Its focus is the attached business-card image(s), shown inline
 * and scrolling within the panel; the contact essentials and an "Open full
 * contact" link sit beneath. All chrome lives in SlideOverShell.
 */
export function BusinessCardDetailSlideOver({
  open,
  onClose,
  card,
}: {
  open: boolean;
  onClose: () => void;
  card: BusinessCardDto;
}) {
  const images = card.imageAttachments;

  return (
    <SlideOverShell
      open={open}
      onClose={onClose}
      eyebrow="Business card"
      labelledById="business-card-drawer-title"
      closeLabel="Close contact preview"
    >
      <div className="px-3.5 pt-3 pb-1">
        <h2 id="business-card-drawer-title" className="font-serif text-[18px] text-ink leading-tight">
          {card.fullName}
        </h2>
        <p className="text-[12.5px] text-ink-2 mt-0.5">
          {card.jobTitle ? `${card.jobTitle}, ` : ''}
          {card.company}
        </p>
        {card.eventName ? (
          <span className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-[10px] font-medium bg-primary-soft text-primary border border-primary-line">
            <i className="ti ti-calendar-event text-[11px]" aria-hidden="true" />
            {card.eventName}
          </span>
        ) : null}
      </div>

      {images.length > 0 ? (
        <SlideOverSection label={images.length > 1 ? `Business card · ${images.length} images` : 'Business card'}>
          <BusinessCardImages images={images} variant="stack" />
          <p className="mt-1.5 text-[11px] text-ink-3">
            Scroll to see {images.length > 1 ? 'all images' : 'the full card'} · tap to open full-size.
          </p>
        </SlideOverSection>
      ) : card.hasAttachment ? (
        <SlideOverSection label="Attachment">
          <p className="text-[12px] text-ink-3 inline-flex items-center gap-1.5">
            <i className="ti ti-paperclip text-[13px]" aria-hidden="true" />
            Has a file — open the contact to view it.
          </p>
        </SlideOverSection>
      ) : (
        <SlideOverSection label="Business card">
          <p className="text-[12px] italic text-ink-3">No image attached.</p>
        </SlideOverSection>
      )}

      {card.mobile || card.email ? (
        <SlideOverSection label="Contact">
          <div className="flex flex-col gap-1">
            {card.mobile ? (
              <a href={`tel:${card.mobile}`} className="inline-flex items-center gap-1.5 text-[12.5px] text-ink">
                <i className="ti ti-phone text-[13px] text-ink-3" aria-hidden="true" />
                {card.mobile}
              </a>
            ) : null}
            {card.email ? (
              <a href={`mailto:${card.email}`} className="inline-flex items-center gap-1.5 text-[12.5px] text-ink">
                <i className="ti ti-mail text-[13px] text-ink-3 shrink-0" aria-hidden="true" />
                <span className="break-all">{card.email}</span>
              </a>
            ) : null}
          </div>
        </SlideOverSection>
      ) : null}

      <div className="px-3.5 py-3 border-t border-primary-line/25">
        <Link
          href={`/business-cards/${card.id}`}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-primary hover:underline"
        >
          Open full contact
          <i className="ti ti-arrow-right text-[14px]" aria-hidden="true" />
        </Link>
      </div>
    </SlideOverShell>
  );
}
