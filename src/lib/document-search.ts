import type { DocumentStatus, DocumentUrgency, Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { canAccessDocumentCentreById } from '@/lib/document-centre';

/**
 * Quick search for the Document Centre. Matches across the fields the spec
 * calls for — subject, context, attachment names, discussion, and Google
 * Drive links — and is gated by the same executive allowlist as the module
 * (returns [] for anyone else, so a leaked query id can reveal nothing).
 */

export const DOC_SEARCH_MIN_CHARS = 2;
const DOC_SEARCH_LIMIT = 50;

export type DocumentSearchCard = {
  id: string;
  subject: string;
  urgency: DocumentUrgency;
  status: DocumentStatus;
  markedForReview: boolean;
  awaitingInput: boolean;
  createdByName: string;
  createdAt: string; // ISO — serialised across the API boundary
  hasAttachment: boolean;
};

export function isDocQuerySearchable(q: string): boolean {
  return q.trim().length >= DOC_SEARCH_MIN_CHARS;
}

export async function quickSearchDocuments(
  callerId: string,
  rawQuery: string,
  /** Rows to return. The global search bar asks for a short preview; the
   *  Document Centre's own search takes the full page. */
  limit: number = DOC_SEARCH_LIMIT,
): Promise<{ rows: DocumentSearchCard[]; total: number; capped: boolean }> {
  const q = rawQuery.trim();
  if (q.length < DOC_SEARCH_MIN_CHARS) return { rows: [], total: 0, capped: false };
  if (!(await canAccessDocumentCentreById(callerId))) return { rows: [], total: 0, capped: false };

  const like: Prisma.StringFilter = { contains: q, mode: 'insensitive' };

  // Attachment names + Drive links, and discussion bodies live in sibling
  // tables — resolve the matching record ids first, then OR them into the
  // record query alongside subject/context.
  const [attachmentOwners, commentOwners] = await Promise.all([
    prisma.attachment.findMany({
      where: {
        ownerType: 'document_record',
        OR: [{ fileName: like }, { fileUrl: like }],
      },
      select: { ownerId: true },
      distinct: ['ownerId'],
    }),
    prisma.documentComment.findMany({
      where: { body: like },
      select: { documentRecordId: true },
      distinct: ['documentRecordId'],
    }),
  ]);
  const matchedIds = Array.from(
    new Set([
      ...attachmentOwners.map((a) => a.ownerId),
      ...commentOwners.map((c) => c.documentRecordId),
    ]),
  );

  const where: Prisma.DocumentRecordWhereInput = {
    archivedAt: null,
    OR: [
      { subject: like },
      { context: like },
      ...(matchedIds.length > 0 ? [{ id: { in: matchedIds } }] : []),
    ],
  };

  const total = await prisma.documentRecord.count({ where });
  const records = await prisma.documentRecord.findMany({
    where,
    include: { createdBy: { select: { name: true } } },
    orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });

  const ids = records.map((r) => r.id);
  const withAttachment = new Set<string>();
  if (ids.length > 0) {
    const rows = await prisma.attachment.findMany({
      where: { ownerType: 'document_record', ownerId: { in: ids } },
      select: { ownerId: true },
      distinct: ['ownerId'],
    });
    for (const r of rows) withAttachment.add(r.ownerId);
  }

  return {
    rows: records.map((r) => ({
      id: r.id,
      subject: r.subject,
      urgency: r.urgency,
      status: r.status,
      markedForReview: r.markedForReview,
      awaitingInput: r.awaitingInput,
      createdByName: r.createdBy.name,
      createdAt: r.createdAt.toISOString(),
      hasAttachment: withAttachment.has(r.id),
    })),
    total,
    capped: total > records.length,
  };
}
