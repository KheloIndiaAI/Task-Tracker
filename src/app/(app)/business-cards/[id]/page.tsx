import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { format } from 'date-fns';

import { AttachmentList, type AttachmentRow } from '@/components/ui';
import { auth } from '@/lib/auth';
import {
  canAccessBusinessCardsById,
  fetchBusinessCard,
  fetchBusinessCardEvents,
} from '@/lib/business-cards';
import { prisma } from '@/lib/db';
import { isS3Configured } from '@/lib/s3';

import { BusinessCardDialog } from '../_components/BusinessCardDialog';
import { DeleteBusinessCardButton } from '../_components/BusinessCardDetailActions';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BusinessCardDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!(await canAccessBusinessCardsById(session.user.id))) redirect('/tasks');
  if (!UUID_RE.test(params.id)) notFound();

  const [card, events] = await Promise.all([
    fetchBusinessCard(params.id),
    fetchBusinessCardEvents(),
  ]);
  if (!card) notFound();

  const attachmentRows = await prisma.attachment.findMany({
    where: { ownerType: 'business_card', ownerId: card.id },
    include: { uploadedBy: { select: { name: true } } },
    orderBy: { uploadedAt: 'desc' },
  });
  const attachments: AttachmentRow[] = attachmentRows.map((a) => ({
    id: a.id,
    fileName: a.fileName,
    fileUrl: a.fileUrl,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    source: a.source as 'uploaded' | 'drive_link',
    uploadedAt: a.uploadedAt,
    uploaderName: a.uploadedBy.name,
    canDelete: true,
  }));

  const canDelete = session.user.isSuperAdmin || card.createdById === session.user.id;

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 lg:px-8 pt-4 md:pt-6 pb-24 md:pb-10">
      <Link
        href="/business-cards"
        className="inline-flex items-center gap-1.5 text-[12px] text-ink-2 hover:text-ink mb-4"
      >
        <i className="ti ti-arrow-left text-[14px]" aria-hidden="true" />
        Business Cards
      </Link>

      <article className="rounded-2xl border border-line bg-panel overflow-hidden">
        {/* Header */}
        <header className="px-4 md:px-6 py-5 border-b border-line-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {card.eventName ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 mb-2 rounded-pill text-[10px] font-medium bg-primary-soft text-primary border border-primary-line">
                  <i className="ti ti-calendar-event text-[11px]" aria-hidden="true" />
                  {card.eventName}
                </span>
              ) : null}
              <h1 className="font-serif text-[22px] md:text-[26px] leading-tight text-ink">
                {card.fullName}
              </h1>
              <p className="mt-1 text-[13px] text-ink-2">
                {card.jobTitle ? `${card.jobTitle}, ` : ''}
                <span className="font-medium text-ink">{card.company}</span>
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <BusinessCardDialog mode="edit" card={card} events={events} />
              {canDelete ? <DeleteBusinessCardButton id={card.id} name={card.fullName} /> : null}
            </div>
          </div>
        </header>

        {/* Details */}
        <section className="px-4 md:px-6 py-4 border-b border-line-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <DetailRow icon="ti-building" label="Company" value={card.company} />
          <DetailRow icon="ti-briefcase" label="Industry" value={card.industry} />
          <DetailRow icon="ti-phone" label="Mobile" value={card.mobile} isTel />
          <DetailRow icon="ti-mail" label="Email" value={card.email} isEmail />
          <DetailRow icon="ti-calendar-event" label="Event" value={card.eventName} />
          <DetailRow
            icon="ti-user"
            label="Added by"
            value={`${card.createdByName} · ${format(new Date(card.createdAt), 'd MMM yyyy')}`}
          />
        </section>

        {/* Remarks */}
        {card.remarks ? (
          <section className="px-4 md:px-6 py-4 border-b border-line-2">
            <h2 className="section-label mb-2">Remarks</h2>
            <p className="text-[13px] text-ink-2 leading-relaxed whitespace-pre-wrap">{card.remarks}</p>
          </section>
        ) : null}

        {/* Attachments */}
        <section className="px-4 md:px-6 py-5">
          <h2 className="section-label mb-3">
            Business card file
            {attachments.length > 0 ? (
              <span className="ml-2 text-ink-3 text-[11px] tracking-normal normal-case font-normal">
                {attachments.length} {attachments.length === 1 ? 'file' : 'files'}
              </span>
            ) : null}
          </h2>
          <AttachmentList
            scope="business_card"
            parentId={card.id}
            attachments={attachments}
            canEdit
            canAdd
            s3Configured={isS3Configured()}
            mode="list-multi"
            emptyHint="Upload the business card image (PNG, JPEG…) or a PDF, or paste a Google Drive link."
          />
        </section>
      </article>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
  isEmail,
  isTel,
}: {
  icon: string;
  label: string;
  value: string | null;
  isEmail?: boolean;
  isTel?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <i className={`ti ${icon} text-[15px] text-ink-3 mt-0.5 shrink-0`} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.06em] text-ink-3 font-medium">{label}</p>
        {value ? (
          isEmail ? (
            <a href={`mailto:${value}`} className="text-[13px] text-ink hover:text-primary break-all">
              {value}
            </a>
          ) : isTel ? (
            <a href={`tel:${value}`} className="text-[13px] text-ink hover:text-primary">
              {value}
            </a>
          ) : (
            <p className="text-[13px] text-ink break-words">{value}</p>
          )
        ) : (
          <p className="text-[13px] text-ink-4">—</p>
        )}
      </div>
    </div>
  );
}
