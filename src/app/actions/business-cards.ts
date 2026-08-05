'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { BusinessCardState } from '@/app/actions/states';
import { auth } from '@/lib/auth';
import { canAccessBusinessCardsById } from '@/lib/business-cards';
import { BUSINESS_CARD_MAX } from '@/lib/business-cards-shared';
import { prisma } from '@/lib/db';
import { logError } from '@/lib/utils/log';

/**
 * Business Cards server actions. Every action re-checks module access
 * (`canAccessBusinessCardsById`) — /api and server actions are not gated by
 * middleware, so this is the true security boundary. Follows the shared epoch
 * protocol — { ok, epoch, error?, fieldErrors?, businessCardId? }.
 */

type State = BusinessCardState;

function bump(prev: State | undefined): number {
  return (prev?.epoch ?? 0) + 1;
}
function fail(message: string, epoch: number, fieldErrors?: Record<string, string>): State {
  return { ok: false, error: message, epoch, fieldErrors };
}
function ok(epoch: number, extra?: Partial<State>): State {
  return { ok: true, epoch, ...extra };
}

async function requireBcAccess(): Promise<{ id: string } | null> {
  const session = await auth();
  if (!session?.user) return null;
  if (!(await canAccessBusinessCardsById(session.user.id))) return null;
  return { id: session.user.id };
}

/** Shared field schema — create and update take the same shape. */
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

const fieldsSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(BUSINESS_CARD_MAX.fullName),
  company: z.string().trim().min(1, 'Company is required').max(BUSINESS_CARD_MAX.company),
  jobTitle: optional(BUSINESS_CARD_MAX.jobTitle),
  industry: optional(BUSINESS_CARD_MAX.industry),
  email: optional(BUSINESS_CARD_MAX.email),
  mobile: optional(BUSINESS_CARD_MAX.mobile),
  remarks: optional(BUSINESS_CARD_MAX.remarks),
  eventName: optional(BUSINESS_CARD_MAX.eventName),
});

function readFields(formData: FormData) {
  return fieldsSchema.safeParse({
    fullName: formData.get('fullName'),
    company: formData.get('company'),
    jobTitle: formData.get('jobTitle') || undefined,
    industry: formData.get('industry') || undefined,
    email: formData.get('email') || undefined,
    mobile: formData.get('mobile') || undefined,
    remarks: formData.get('remarks') || undefined,
    eventName: formData.get('eventName') || undefined,
  });
}

/** Upsert the event by name (auto-registering new names) and return its id. */
async function resolveEventId(name: string | undefined, createdById: string): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const event = await prisma.businessCardEvent.upsert({
    where: { name: trimmed },
    create: { name: trimmed, createdById },
    update: {},
    select: { id: true },
  });
  return event.id;
}

// ============================================================
// Create
// ============================================================

export async function createBusinessCardAction(
  prev: State | undefined,
  formData: FormData,
): Promise<State> {
  const epoch = bump(prev);
  const me = await requireBcAccess();
  if (!me) return fail('You are not authorized to add contacts.', epoch);

  const parsed = readFields(formData);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  try {
    const eventId = await resolveEventId(parsed.data.eventName, me.id);
    const card = await prisma.businessCard.create({
      data: {
        fullName: parsed.data.fullName,
        company: parsed.data.company,
        jobTitle: parsed.data.jobTitle ?? null,
        industry: parsed.data.industry ?? null,
        email: parsed.data.email ?? null,
        mobile: parsed.data.mobile ?? null,
        remarks: parsed.data.remarks ?? null,
        eventId,
        createdById: me.id,
      },
      select: { id: true },
    });
    revalidatePath('/business-cards');
    return ok(epoch, { businessCardId: card.id });
  } catch (err) {
    logError('createBusinessCardAction failed', err);
    return fail('Could not add the contact.', epoch);
  }
}

// ============================================================
// Update
// ============================================================

export async function updateBusinessCardAction(
  prev: State | undefined,
  formData: FormData,
): Promise<State> {
  const epoch = bump(prev);
  const me = await requireBcAccess();
  if (!me) return fail('You are not authorized.', epoch);

  const idRaw = formData.get('id');
  const id = z.string().uuid().safeParse(idRaw);
  if (!id.success) return fail('Invalid input.', epoch);

  const parsed = readFields(formData);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  const existing = await prisma.businessCard.findUnique({
    where: { id: id.data },
    select: { id: true },
  });
  if (!existing) return fail('Contact not found.', epoch);

  try {
    const eventId = await resolveEventId(parsed.data.eventName, me.id);
    await prisma.businessCard.update({
      where: { id: existing.id },
      data: {
        fullName: parsed.data.fullName,
        company: parsed.data.company,
        jobTitle: parsed.data.jobTitle ?? null,
        industry: parsed.data.industry ?? null,
        email: parsed.data.email ?? null,
        mobile: parsed.data.mobile ?? null,
        remarks: parsed.data.remarks ?? null,
        eventId,
        lastActivityAt: new Date(),
      },
    });
    revalidatePath(`/business-cards/${existing.id}`);
    revalidatePath('/business-cards');
    return ok(epoch, { businessCardId: existing.id });
  } catch (err) {
    logError('updateBusinessCardAction failed', err);
    return fail('Could not save changes.', epoch);
  }
}

// ============================================================
// Delete (hard) — Super Admin or the contact's creator
// ============================================================

export async function deleteBusinessCardAction(
  prev: State | undefined,
  formData: FormData,
): Promise<State> {
  const epoch = bump(prev);
  const session = await auth();
  if (!session?.user) return fail('You are signed out.', epoch);
  if (!(await canAccessBusinessCardsById(session.user.id))) {
    return fail('You are not authorized.', epoch);
  }

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return fail('Invalid input.', epoch);

  const card = await prisma.businessCard.findUnique({
    where: { id: id.data },
    select: { id: true, createdById: true },
  });
  if (!card) return fail('Contact not found.', epoch);
  if (!session.user.isSuperAdmin && card.createdById !== session.user.id) {
    return fail('Only the creator or a Super Admin can delete a contact.', epoch);
  }

  try {
    // Attachments are polymorphic (no FK) — remove their rows explicitly, then
    // the card. S3 objects are cleaned best-effort so a failure never blocks it.
    const attachments = await prisma.attachment.findMany({
      where: { ownerType: 'business_card', ownerId: card.id },
      select: { fileUrl: true, source: true },
    });
    await prisma.$transaction(async (tx) => {
      await tx.attachment.deleteMany({ where: { ownerType: 'business_card', ownerId: card.id } });
      await tx.businessCard.delete({ where: { id: card.id } });
    });

    const { deleteObject, isS3Configured } = await import('@/lib/s3');
    if (isS3Configured()) {
      for (const att of attachments) {
        if (att.source !== 'uploaded') continue;
        try {
          await deleteObject(att.fileUrl);
        } catch (err) {
          logError('S3 object delete failed (orphan left)', err);
        }
      }
    }
  } catch (err) {
    logError('deleteBusinessCardAction failed', err);
    return fail('Could not delete the contact.', epoch);
  }

  revalidatePath('/business-cards');
  return ok(epoch);
}
