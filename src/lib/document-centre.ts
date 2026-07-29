import type { DocumentRecord, NotificationType, Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import {
  canAccessDocumentCentre,
  type DocFilter,
  type DocSort,
} from '@/lib/document-centre-shared';

/**
 * Document Centre — server data layer (visibility, counts, and the shared
 * notification/audit helpers). The access rule itself is the pure
 * `canAccessDocumentCentre` in document-centre-shared.ts; everything here is
 * db-backed and must never be imported into a client component.
 *
 * Access model: the executive audience (Super Admins + any user granted the
 * can_access_document_centre flag) all see EVERY record — the Document Centre
 * is a shared confidential workspace, not a division-scoped module. It is
 * therefore deliberately outside buildVisibilityClausesFrom; HMYAS
 * division-isolation does not apply here (it only constrains the
 * division-scoped modules).
 */

// A Prisma client or an interactive-transaction client — so the notify/audit
// helpers compose inside a $transaction or run standalone.
type Db = Pick<typeof prisma, 'notification' | 'auditLog' | 'user'>;

// ------------------------------------------------------------
// Access
// ------------------------------------------------------------

/** DB-backed gate — loads the caller and applies the access rule. */
export async function canAccessDocumentCentreById(userId: string): Promise<boolean> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperAdmin: true, canAccessDocumentCentre: true, isActive: true },
  });
  if (!me || !me.isActive) return false;
  return canAccessDocumentCentre({
    isSuperAdmin: me.isSuperAdmin,
    canAccessDocumentCentre: me.canAccessDocumentCentre,
  });
}

/**
 * Active user ids of the executive audience (Super Admins + the OSD desks),
 * optionally excluding one (typically the actor). Used both to fan out
 * notifications and to build the restricted mention list.
 */
export async function getDocumentAudienceUserIds(excludeId?: string): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [{ isSuperAdmin: true }, { canAccessDocumentCentre: true }],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id).filter((id) => id !== excludeId);
}

/** The mention picker + resolver pool — the same executive audience. */
export function documentMentionWhere(): Prisma.UserWhereInput {
  return {
    isActive: true,
    OR: [{ isSuperAdmin: true }, { canAccessDocumentCentre: true }],
  };
}

// ------------------------------------------------------------
// Notifications + audit (no central factory exists in this codebase —
// both subsystems are inline-per-action; these thin helpers keep the
// Document Centre's calls DRY without inventing a new pattern).
// ------------------------------------------------------------

export async function notifyDocumentAudience(
  db: Db,
  args: {
    actorId: string;
    type: NotificationType;
    documentId: string;
    documentSubject: string;
    actorName?: string | null;
    /** Extra payload fields (e.g. commentId, fileName). */
    extra?: Record<string, unknown>;
  },
): Promise<void> {
  const recipients = await getDocumentAudienceUserIds(args.actorId);
  if (recipients.length === 0) return;
  await db.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      type: args.type,
      payload: {
        documentId: args.documentId,
        documentSubject: args.documentSubject,
        actorId: args.actorId,
        actorName: args.actorName ?? null,
        ...args.extra,
      } as Prisma.InputJsonObject,
    })),
  });
}

/** Insert-only audit row for a document record (entityType is free text). */
export async function writeDocumentAudit(
  db: Db,
  args: {
    actorId: string;
    action: 'create' | 'update' | 'delete';
    documentId: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  },
): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: args.actorId,
      action: args.action,
      entityType: 'document_record',
      entityId: args.documentId,
      before: (args.before ?? {}) as Prisma.InputJsonObject,
      after: (args.after ?? {}) as Prisma.InputJsonObject,
    },
  });
}

// ------------------------------------------------------------
// List + counts
// ------------------------------------------------------------

export type VisibleDocument = DocumentRecord & {
  createdBy: { id: string; name: string };
  hasAttachment: boolean;
};

export function docListOrderBy(
  sort: DocSort,
): Prisma.DocumentRecordOrderByWithRelationInput[] {
  switch (sort) {
    case 'created':
      return [{ createdAt: 'desc' }];
    case 'alpha':
      return [{ subject: 'asc' }, { createdAt: 'desc' }];
    case 'modified':
    default:
      return [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }];
  }
}

function filterClause(filter: DocFilter): Prisma.DocumentRecordWhereInput {
  switch (filter) {
    case 'under_review':
      return { markedForReview: true, status: 'open' };
    case 'awaiting_input':
      return { awaitingInput: true, status: 'open' };
    case 'highly_urgent':
      return { urgency: 'highly_urgent', status: 'open' };
    case 'completed':
      return { status: 'completed' };
    case 'all':
    default:
      return {};
  }
}

/**
 * Visibility-scoped list. The caller must already be authorized (the page +
 * API gate before calling); this returns [] for anyone who is not, as a
 * defence-in-depth backstop.
 */
export async function fetchVisibleDocuments(opts: {
  callerId: string;
  filter: DocFilter;
  sort?: DocSort;
}): Promise<VisibleDocument[]> {
  if (!(await canAccessDocumentCentreById(opts.callerId))) return [];

  const records = await prisma.documentRecord.findMany({
    where: { archivedAt: null, AND: [filterClause(opts.filter)] },
    include: { createdBy: { select: { id: true, name: true } } },
    orderBy: docListOrderBy(opts.sort ?? 'modified'),
  });

  // Which records carry at least one attachment (paperclip on the card).
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

  return records.map((r) => ({ ...r, hasAttachment: withAttachment.has(r.id) }));
}

export async function fetchDocumentCounts(callerId: string): Promise<{
  open: number;
  underReview: number;
  awaitingInput: number;
  completed: number;
}> {
  if (!(await canAccessDocumentCentreById(callerId))) {
    return { open: 0, underReview: 0, awaitingInput: 0, completed: 0 };
  }
  const base: Prisma.DocumentRecordWhereInput = { archivedAt: null };
  const [open, underReview, awaitingInput, completed] = await Promise.all([
    prisma.documentRecord.count({ where: { ...base, status: 'open' } }),
    prisma.documentRecord.count({ where: { ...base, status: 'open', markedForReview: true } }),
    prisma.documentRecord.count({ where: { ...base, status: 'open', awaitingInput: true } }),
    prisma.documentRecord.count({ where: { ...base, status: 'completed' } }),
  ]);
  return { open, underReview, awaitingInput, completed };
}
