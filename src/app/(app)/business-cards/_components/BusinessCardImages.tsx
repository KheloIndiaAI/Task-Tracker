import { cn } from '@/lib/utils';

/**
 * Inline preview of a contact's uploaded business-card images. Each image loads
 * through the shared `/api/attachments/:id/view` route (re-authorises the
 * caller, presigns the S3 object, serves it inline) — the same route the
 * attachment list and slide-over docs use, so a preview can never reveal a file
 * the caller could not otherwise open.
 *
 * next/image can't optimise the presigned-redirect route, so a plain <img> is
 * used deliberately (matching how presigned attachments are opened elsewhere).
 *
 *   - variant 'strip'  → horizontal, swipeable row (detail page)
 *   - variant 'stack'  → full-width column that scrolls within its container
 *                        (the mobile swipe slide-over)
 */

type ImageRef = { id: string; fileName: string };

export function BusinessCardImages({
  images,
  variant,
  className,
}: {
  images: ImageRef[];
  variant: 'strip' | 'stack';
  className?: string;
}) {
  if (images.length === 0) return null;

  if (variant === 'strip') {
    return (
      <div
        className={cn(
          'flex gap-2 overflow-x-auto overscroll-x-contain pb-1 snap-x snap-mandatory',
          className,
        )}
      >
        {images.map((img) => (
          <a
            key={img.id}
            href={`/api/attachments/${img.id}/view`}
            target="_blank"
            rel="noreferrer"
            title={`Open ${img.fileName}`}
            className="group relative shrink-0 snap-start rounded-lg border border-line overflow-hidden bg-white"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/attachments/${img.id}/view`}
              alt={img.fileName}
              loading="lazy"
              className="h-72 sm:h-96 lg:h-[460px] w-auto max-w-full object-contain"
            />
            <span className="absolute top-2 right-2 w-8 h-8 grid place-items-center rounded-full bg-black/45 text-white opacity-0 group-hover:opacity-100 transition-opacity">
              <i className="ti ti-arrows-diagonal text-[13px]" aria-hidden="true" />
            </span>
          </a>
        ))}
      </div>
    );
  }

  // stack — full width, scrolls within its parent (the slide-over panel)
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {images.map((img) => (
        <a
          key={img.id}
          href={`/api/attachments/${img.id}/view`}
          target="_blank"
          rel="noreferrer"
          title={`Open ${img.fileName}`}
          className="block rounded-lg border border-primary-line/40 overflow-hidden bg-white"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/attachments/${img.id}/view`}
            alt={img.fileName}
            loading="lazy"
            className="w-full h-auto object-contain"
          />
        </a>
      ))}
    </div>
  );
}
