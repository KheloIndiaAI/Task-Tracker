import { prisma } from '@/lib/db';
import {
  canAccessBusinessCards,
  type BusinessCardDto,
  type BusinessCardEventDto,
} from '@/lib/business-cards-shared';

/**
 * Business Cards — server data layer. The access rule itself is the pure
 * `canAccessBusinessCards` in business-cards-shared.ts; everything here is
 * db-backed and must never be imported into a client component.
 *
 * Access model: every user with access (Super Admin OR the
 * can_access_business_cards flag) sees EVERY card — a shared workspace, not a
 * division-scoped module. It is therefore outside buildVisibilityClausesFrom.
 */

/** DB-backed gate — loads the caller and applies the access rule. */
export async function canAccessBusinessCardsById(userId: string): Promise<boolean> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperAdmin: true, canAccessBusinessCards: true, isActive: true },
  });
  if (!me || !me.isActive) return false;
  return canAccessBusinessCards({
    isSuperAdmin: me.isSuperAdmin,
    canAccessBusinessCards: me.canAccessBusinessCards,
  });
}

const CARD_SELECT = {
  id: true,
  fullName: true,
  jobTitle: true,
  company: true,
  industry: true,
  email: true,
  mobile: true,
  remarks: true,
  createdById: true,
  createdAt: true,
  event: { select: { name: true } },
  createdBy: { select: { name: true } },
} as const;

type RawCard = {
  id: string;
  fullName: string;
  jobTitle: string | null;
  company: string;
  industry: string | null;
  email: string | null;
  mobile: string | null;
  remarks: string | null;
  createdById: string;
  createdAt: Date;
  event: { name: string } | null;
  createdBy: { name: string };
};

/** Per-card attachment summary: whether any exist + the inline-viewable images. */
type AttInfo = { hasAttachment: boolean; images: { id: string; fileName: string }[] };

function toDto(c: RawCard, info: AttInfo | undefined): BusinessCardDto {
  return {
    id: c.id,
    fullName: c.fullName,
    jobTitle: c.jobTitle,
    company: c.company,
    industry: c.industry,
    email: c.email,
    mobile: c.mobile,
    remarks: c.remarks,
    eventName: c.event?.name ?? null,
    createdByName: c.createdBy.name,
    createdById: c.createdById,
    createdAt: c.createdAt.toISOString(),
    hasAttachment: info?.hasAttachment ?? false,
    imageAttachments: info?.images ?? [],
  };
}

/**
 * Attachment summary per card id. An "image" is an UPLOADED attachment whose
 * MIME type is image/* — Drive links are external URLs and cannot be shown
 * inline, so they count towards hasAttachment but never as an inline image.
 */
async function attachmentsByOwner(ids: string[]): Promise<Map<string, AttInfo>> {
  const map = new Map<string, AttInfo>();
  if (ids.length === 0) return map;
  const rows = await prisma.attachment.findMany({
    where: { ownerType: 'business_card', ownerId: { in: ids } },
    select: { ownerId: true, id: true, fileName: true, mimeType: true, source: true },
    orderBy: { uploadedAt: 'asc' },
  });
  for (const r of rows) {
    const info = map.get(r.ownerId) ?? { hasAttachment: false, images: [] };
    info.hasAttachment = true;
    if (r.source === 'uploaded' && (r.mimeType?.startsWith('image/') ?? false)) {
      info.images.push({ id: r.id, fileName: r.fileName });
    }
    map.set(r.ownerId, info);
  }
  return map;
}

/** All cards, newest-activity first — the full shared list (access-gated by the caller). */
export async function fetchBusinessCards(): Promise<BusinessCardDto[]> {
  const cards = await prisma.businessCard.findMany({
    orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
    select: CARD_SELECT,
  });
  const attachments = await attachmentsByOwner(cards.map((c) => c.id));
  return cards.map((c) => toDto(c, attachments.get(c.id)));
}

/** Every saved event, alphabetical — powers the combobox and the event filter. */
export async function fetchBusinessCardEvents(): Promise<BusinessCardEventDto[]> {
  return prisma.businessCardEvent.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}

/** A single card for the detail page, or null. */
export async function fetchBusinessCard(id: string): Promise<BusinessCardDto | null> {
  const card = await prisma.businessCard.findUnique({ where: { id }, select: CARD_SELECT });
  if (!card) return null;
  const attachments = await attachmentsByOwner([card.id]);
  return toDto(card, attachments.get(card.id));
}
