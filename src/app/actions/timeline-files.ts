'use server';
import { logError } from '@/lib/utils/log';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { Prisma } from '@prisma/client';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { touchTimelineFileActivity } from '@/lib/activity';
import { buildTfVisibilityClause } from '@/lib/timeline-files';
import { DIRECTOR_GRADE_SLOTS, isDirectorGrade } from '@/lib/hierarchy-slots';

/**
 * Timeline File server actions (PRD §5.2).
 *
 *   createTimelineFileAction       — builds TF-YYYY/Number from the desk-
 *                                    entered file number
 *   updateTimelineFileFieldsAction — subject/from/dates/comments
 *   updateTimelineFileStatusAction — Pending Action / In Progress / etc.
 *   addMarkedToAction / removeMarkedToAction — division scope membership
 *
 * Authorisation:
 *   - Creation: OSD or Super Admin (delegation to staff lands later)
 *   - Edits to subject/from/dates/secretary + desk comments: OSD + Super Admin
 *   - Status change: OSD + Super Admin + Director of any marked-to division
 *   - Phase 3 simplification: action-level checks; row-level visibility
 *     enforced by the scoper used for reads.
 */

// ============================================================
// Shared
// ============================================================

type ActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  epoch?: number;
  id?: string;
  refNo?: string;
};

function bump(prev: ActionState | undefined): number {
  return (prev?.epoch ?? 0) + 1;
}
function fail(message: string, epoch: number, fieldErrors?: Record<string, string>): ActionState {
  return { ok: false, error: message, epoch, fieldErrors };
}
function ok(epoch: number, extra?: Partial<ActionState>): ActionState {
  return { ok: true, epoch, ...extra };
}

async function requireSession() {
  const session = await auth();
  if (!session?.user) return null;
  return session.user;
}

async function requireOsdOrSuperAdmin(): Promise<
  | { ok: true; userId: string }
  | { ok: false; error: string }
> {
  const me = await requireSession();
  if (!me) return { ok: false, error: 'You are signed out.' };
  if (me.isSuperAdmin || me.hierarchySlot === 'osd') {
    return { ok: true, userId: me.id };
  }
  return { ok: false, error: 'Only OSD can do that.' };
}

function revalidateTf(tfId?: string) {
  revalidatePath('/timeline-files');
  if (tfId) revalidatePath(`/timeline-files/${tfId}`);
}

const TF_STATUSES = [
  'pending_action',
  'in_progress',
  'awaiting_reply',
  'on_hold',
  'closed',
] as const;

// Reuses the task priority scale so the tag stays consistent across the app.
const TF_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

// ============================================================
// createTimelineFileAction
// ============================================================

const createSchema = z.object({
  /**
   * The desk-entered file number — kept as a raw string (not coerced to a
   * number) so leading zeros the officer types are preserved verbatim in
   * the displayed ref number. `refSeq` (the Int column backing the
   * per-year uniqueness constraint) is derived from it in the action.
   */
  fileNumber: z
    .string()
    .trim()
    .min(1, 'TL file number is required')
    .refine((s) => /^\d{1,6}$/.test(s), 'Enter a whole number (1–999999)')
    .refine((s) => Number(s) > 0, 'File number must be greater than zero'),
  subject: z.string().trim().min(1, 'Subject is required').max(200, 'Subject is too long'),
  fromWhom: z.string().trim().min(1, 'From-whom is required').max(120),
  priority: z.enum(TF_PRIORITIES).optional().default('medium'),
  receivedDate: z
    .string()
    .min(1, 'Received date is required')
    .refine((s) => !Number.isNaN(Date.parse(s)), 'Received date is invalid'),
  deadlineDate: z
    .string()
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined))
    .refine((s) => !s || !Number.isNaN(Date.parse(s)), 'Deadline date is invalid'),
  secretaryComments: z
    .string()
    .max(4000)
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined)),
  /** Comma-separated UUIDs of divisions the file is marked to. */
  markedTo: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : []))
    .pipe(z.array(z.string().uuid()).min(1, 'Mark to at least one division')),
});

export async function createTimelineFileAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const guard = await requireOsdOrSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = createSchema.safeParse({
    fileNumber: formData.get('fileNumber'),
    subject: formData.get('subject'),
    fromWhom: formData.get('fromWhom'),
    priority: formData.get('priority') ?? undefined,
    receivedDate: formData.get('receivedDate'),
    deadlineDate: formData.get('deadlineDate'),
    secretaryComments: formData.get('secretaryComments'),
    markedTo: formData.get('markedTo'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  // A file is marked to DIVISIONS — the only kind the picker offers, and the
  // unit whose Directors act on it. Checked here because this path used to
  // accept any id, which would now include an organization or directorate.
  const markedCount = await prisma.division.count({
    where: { id: { in: parsed.data.markedTo }, kind: 'division' },
  });
  if (markedCount !== new Set(parsed.data.markedTo).size) {
    return { ok: false, fieldErrors: { markedTo: 'Mark the file to divisions only.' }, epoch };
  }

  const received = new Date(parsed.data.receivedDate);
  const deadline = parsed.data.deadlineDate ? new Date(parsed.data.deadlineDate) : null;
  const refYear = received.getUTCFullYear();
  const refSeqRaw = parsed.data.fileNumber;
  const refSeq = Number(refSeqRaw);
  const refNo = `TF-${refYear}/${refSeqRaw}`;

  try {
    const created = await prisma.timelineFile.create({
      data: {
        refNo,
        refYear,
        refSeq,
        subject: parsed.data.subject,
        fromWhom: parsed.data.fromWhom,
        receivedDate: received,
        deadlineDate: deadline,
        status: 'pending_action',
        priority: parsed.data.priority,
        secretaryComments: parsed.data.secretaryComments ?? null,
        createdById: guard.userId,
        markedTo: {
          createMany: {
            data: parsed.data.markedTo.map((divisionId) => ({ divisionId })),
          },
        },
      },
    });

    // Notify each marked-to division's Director (best-effort).
    const directors = await prisma.user.findMany({
      where: {
        divisionId: { in: parsed.data.markedTo },
        hierarchySlot: { in: [...DIRECTOR_GRADE_SLOTS] },
        isActive: true,
      },
      select: { id: true },
    });
    if (directors.length > 0) {
      await prisma.notification.createMany({
        data: directors.map((d) => ({
          userId: d.id,
          type: 'timeline_file_marked_to_division',
          payload: { timelineFileId: created.id, refNo: created.refNo },
        })),
      });
    }

    await prisma.timelineFileActivity.create({
      data: {
        timelineFileId: created.id,
        actorId: guard.userId,
        eventType: 'created_from_correspondence',
        payload: {
          subject: created.subject,
          fromWhom: created.fromWhom,
          markedToCount: parsed.data.markedTo.length,
        },
      },
    });

    revalidateTf(created.id);
    return ok(epoch, { id: created.id, refNo: created.refNo });
  } catch (err: unknown) {
    // P2002 = unique constraint violation — this file number is already
    // used for this year (via refNo or the (refYear, refSeq) index).
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      return {
        ok: false,
        epoch,
        fieldErrors: {
          fileNumber: `TL file number ${refSeqRaw} is already used for ${refYear}. Try a different number.`,
        },
      };
    }
    logError('createTimelineFileAction failed', err);
    return fail('Could not create the timeline file. Try again.', epoch);
  }
}

// ============================================================
// updateTimelineFileStatusAction
// ============================================================

const updateStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(TF_STATUSES),
});

export async function updateTimelineFileStatusAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = updateStatusSchema.safeParse({
    id: formData.get('id'),
    status: formData.get('status'),
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const tf = await prisma.timelineFile.findUnique({
    where: { id: parsed.data.id },
    include: {
      createdBy: { select: { divisionId: true } },
    },
  });
  if (!tf) return fail('Timeline file not found.', epoch);
  if (tf.status === parsed.data.status) return ok(epoch);

  const meRow = await prisma.user.findUnique({
    where: { id: me.id },
    select: { hierarchySlot: true, isSuperAdmin: true, divisionId: true },
  });
  const allowed =
    meRow &&
    (meRow.isSuperAdmin ||
      meRow.hierarchySlot === 'osd' ||
      (isDirectorGrade(meRow.hierarchySlot) &&
        meRow.divisionId === tf.createdBy.divisionId));
  if (!allowed) return fail('You do not have permission to change this status.', epoch);

  try {
    await prisma.$transaction([
      prisma.timelineFile.update({
        where: { id: tf.id },
        data: { status: parsed.data.status, lastActivityAt: new Date() },
      }),
      prisma.timelineFileActivity.create({
        data: {
          timelineFileId: tf.id,
          actorId: me.id,
          eventType: 'status_changed',
          payload: { from: tf.status, to: parsed.data.status },
        },
      }),
    ]);
  } catch (err) {
    logError('updateTimelineFileStatusAction failed', err);
    return fail('Could not update status.', epoch);
  }

  revalidateTf(tf.id);
  return ok(epoch);
}

// ============================================================
// updateTimelineFilePriorityAction
// ============================================================

const updatePrioritySchema = z.object({
  id: z.string().uuid(),
  priority: z.enum(TF_PRIORITIES),
});

export async function updateTimelineFilePriorityAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = updatePrioritySchema.safeParse({
    id: formData.get('id'),
    priority: formData.get('priority'),
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const tf = await prisma.timelineFile.findUnique({
    where: { id: parsed.data.id },
    include: { createdBy: { select: { divisionId: true } } },
  });
  if (!tf) return fail('Timeline file not found.', epoch);
  if (tf.priority === parsed.data.priority) return ok(epoch);

  const meRow = await prisma.user.findUnique({
    where: { id: me.id },
    select: { hierarchySlot: true, isSuperAdmin: true, divisionId: true },
  });
  const allowed =
    meRow &&
    (meRow.isSuperAdmin ||
      meRow.hierarchySlot === 'osd' ||
      (isDirectorGrade(meRow.hierarchySlot) &&
        meRow.divisionId === tf.createdBy.divisionId));
  if (!allowed) return fail('You do not have permission to change this priority.', epoch);

  try {
    await prisma.$transaction([
      prisma.timelineFile.update({
        where: { id: tf.id },
        data: { priority: parsed.data.priority, lastActivityAt: new Date() },
      }),
      prisma.timelineFileActivity.create({
        data: {
          timelineFileId: tf.id,
          actorId: me.id,
          eventType: 'priority_changed',
          payload: { from: tf.priority, to: parsed.data.priority },
        },
      }),
    ]);
  } catch (err) {
    logError('updateTimelineFilePriorityAction failed', err);
    return fail('Could not update priority.', epoch);
  }

  revalidateTf(tf.id);
  return ok(epoch);
}

// ============================================================
// updateTimelineFileFieldsAction (subject / from / dates / comments)
// ============================================================

const updateFieldsSchema = z.object({
  id: z.string().uuid(),
  subject: z.string().trim().min(1).max(200).optional(),
  fromWhom: z.string().trim().min(1).max(120).optional(),
  receivedDate: z
    .string()
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined))
    .refine((s) => !s || !Number.isNaN(Date.parse(s)), 'Received date is invalid'),
  // Distinguishes "field absent" (undefined — leave the deadline alone,
  // e.g. when saving an unrelated field like the subject) from "field
  // present but empty" (null — an explicit clear via the Deadline row's
  // Clear button). A naive `s ? s : null` collapses both to null and
  // silently wipes the deadline on every edit that doesn't touch it.
  deadlineDate: z
    .string()
    .optional()
    .transform((s) => (s === undefined ? undefined : s.length > 0 ? s : null))
    .refine(
      (s) => s === undefined || s === null || !Number.isNaN(Date.parse(s)),
      'Deadline date is invalid',
    ),
  secretaryComments: z.string().max(4000).optional(),
  deskComments: z.string().max(4000).optional(),
});

export async function updateTimelineFileFieldsAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const guard = await requireOsdOrSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = updateFieldsSchema.safeParse({
    id: formData.get('id'),
    subject: formData.has('subject') ? (formData.get('subject') as string) : undefined,
    fromWhom: formData.has('fromWhom') ? (formData.get('fromWhom') as string) : undefined,
    receivedDate: formData.has('receivedDate')
      ? (formData.get('receivedDate') as string)
      : undefined,
    deadlineDate: formData.has('deadlineDate')
      ? (formData.get('deadlineDate') as string)
      : undefined,
    secretaryComments: formData.has('secretaryComments')
      ? (formData.get('secretaryComments') as string)
      : undefined,
    deskComments: formData.has('deskComments') ? (formData.get('deskComments') as string) : undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  const tf = await prisma.timelineFile.findUnique({ where: { id: parsed.data.id } });
  if (!tf) return fail('Timeline file not found.', epoch);

  const data: Record<string, unknown> = {};
  if (parsed.data.subject !== undefined && parsed.data.subject !== tf.subject) {
    data.subject = parsed.data.subject;
  }
  if (parsed.data.fromWhom !== undefined) data.fromWhom = parsed.data.fromWhom;
  if (parsed.data.receivedDate !== undefined)
    data.receivedDate = new Date(parsed.data.receivedDate);
  if (parsed.data.deadlineDate !== undefined) {
    const next = parsed.data.deadlineDate ? new Date(parsed.data.deadlineDate) : null;
    if ((tf.deadlineDate?.getTime() ?? null) !== (next?.getTime() ?? null)) {
      data.deadlineDate = next;
    }
  }
  if (parsed.data.secretaryComments !== undefined)
    data.secretaryComments = parsed.data.secretaryComments.length > 0
      ? parsed.data.secretaryComments
      : null;
  if (parsed.data.deskComments !== undefined)
    data.deskComments = parsed.data.deskComments.length > 0 ? parsed.data.deskComments : null;

  if (Object.keys(data).length === 0) return ok(epoch);

  // A real field change landed above — mark it as recent activity.
  data.lastActivityAt = new Date();

  try {
    await prisma.timelineFile.update({ where: { id: parsed.data.id }, data });

    let eventType = 'fields_updated';
    let eventPayload: Record<string, unknown> = { fields: Object.keys(data) };
    if (parsed.data.secretaryComments !== undefined) {
      eventType = 'secretary_comment_added';
    } else if (parsed.data.deskComments !== undefined) {
      eventType = 'desk_comment_added';
    } else if ('subject' in data) {
      eventType = 'tf_renamed';
      eventPayload = { from: tf.subject, to: data.subject };
    } else if ('deadlineDate' in data) {
      eventType = 'deadline_changed';
      eventPayload = {
        from: tf.deadlineDate ? tf.deadlineDate.toISOString().slice(0, 10) : null,
        to: data.deadlineDate ? (data.deadlineDate as Date).toISOString().slice(0, 10) : null,
      };
    }

    await prisma.timelineFileActivity.create({
      data: {
        timelineFileId: parsed.data.id,
        actorId: guard.userId,
        eventType,
        payload: eventPayload as object,
      },
    });

    if (eventType === 'secretary_comment_added' && tf.createdById !== guard.userId) {
      await prisma.notification.create({
        data: {
          userId: tf.createdById,
          type: 'secretary_comment_on_timeline_file',
          payload: { timelineFileId: parsed.data.id, refNo: tf.refNo },
        },
      });
    }
  } catch (err) {
    logError('updateTimelineFileFieldsAction failed', err);
    return fail('Could not save changes.', epoch);
  }

  revalidateTf(parsed.data.id);
  return ok(epoch);
}

// ============================================================
// updateTimelineFileRefNumberAction — Super Admin only, renumber TF-YYYY/N
// ============================================================

const updateRefNumberSchema = z.object({
  id: z.string().uuid(),
  refYear: z
    .string()
    .trim()
    .refine((s) => /^\d{4}$/.test(s), 'Enter a 4-digit year')
    .transform((s) => Number(s))
    .refine((n) => n >= 2000 && n <= 2100, 'Year must be between 2000 and 2100'),
  /** Kept as a raw string so leading zeros the officer types are preserved
   * verbatim in refNo, same as at creation. */
  fileNumber: z
    .string()
    .trim()
    .min(1, 'File number is required')
    .refine((s) => /^\d{1,6}$/.test(s), 'Enter a whole number (1–999999)')
    .refine((s) => Number(s) > 0, 'File number must be greater than zero'),
});

export async function updateTimelineFileRefNumberAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const session = await auth();
  if (!session?.user) return fail('You are signed out.', epoch);

  // Super Admin only — renumbering the official reference is stricter
  // than the other TF field edits (OSD + Super Admin).
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isSuperAdmin: true, isActive: true },
  });
  if (!me?.isActive || !me.isSuperAdmin) {
    return fail('Only Super Admin can change the reference number.', epoch);
  }

  const parsed = updateRefNumberSchema.safeParse({
    id: formData.get('id'),
    refYear: formData.get('refYear'),
    fileNumber: formData.get('fileNumber'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  const tf = await prisma.timelineFile.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, refNo: true },
  });
  if (!tf) return fail('Timeline file not found.', epoch);

  const refYear = parsed.data.refYear;
  const refSeqRaw = parsed.data.fileNumber;
  const refSeq = Number(refSeqRaw);
  const refNo = `TF-${refYear}/${refSeqRaw}`;

  if (refNo === tf.refNo) return ok(epoch);

  try {
    await prisma.timelineFile.update({
      where: { id: tf.id },
      data: { refNo, refYear, refSeq, lastActivityAt: new Date() },
    });

    await prisma.timelineFileActivity.create({
      data: {
        timelineFileId: tf.id,
        actorId: session.user.id,
        eventType: 'ref_number_changed',
        payload: { from: tf.refNo, to: refNo },
      },
    });
  } catch (err: unknown) {
    // P2002 = unique constraint violation — this year/number combination
    // (or the resulting refNo string) already belongs to another file.
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      return {
        ok: false,
        epoch,
        fieldErrors: {
          fileNumber: `${refNo} is already in use by another timeline file.`,
        },
      };
    }
    logError('updateTimelineFileRefNumberAction failed', err);
    return fail('Could not update the reference number.', epoch);
  }

  revalidateTf(tf.id);
  return ok(epoch);
}

// ============================================================
// addMarkedToAction / removeMarkedToAction
// ============================================================

const markedToSchema = z.object({
  id: z.string().uuid(),
  divisionId: z.string().uuid(),
});

export async function addMarkedToAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const guard = await requireOsdOrSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = markedToSchema.safeParse({
    id: formData.get('id'),
    divisionId: formData.get('divisionId'),
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  // Divisions only — see createTimelineFileAction.
  const markTarget = await prisma.division.findUnique({
    where: { id: parsed.data.divisionId },
    select: { kind: true },
  });
  if (markTarget?.kind !== 'division') {
    return fail('A file can only be marked to a division.', epoch);
  }

  try {
    await prisma.timelineFileMarkedTo.create({
      data: {
        timelineFileId: parsed.data.id,
        divisionId: parsed.data.divisionId,
      },
    });
    await prisma.timelineFileActivity.create({
      data: {
        timelineFileId: parsed.data.id,
        actorId: guard.userId,
        eventType: 'marked_to_division',
        payload: { divisionId: parsed.data.divisionId },
      },
    });
    await touchTimelineFileActivity(prisma, parsed.data.id);

    const tf = await prisma.timelineFile.findUnique({
      where: { id: parsed.data.id },
      select: { refNo: true },
    });
    const directors = await prisma.user.findMany({
      where: {
        divisionId: parsed.data.divisionId,
        hierarchySlot: { in: [...DIRECTOR_GRADE_SLOTS] },
        isActive: true,
        id: { not: guard.userId },
      },
      select: { id: true },
    });
    if (directors.length > 0) {
      await prisma.notification.createMany({
        data: directors.map((d) => ({
          userId: d.id,
          type: 'timeline_file_marked_to_division',
          payload: { timelineFileId: parsed.data.id, refNo: tf?.refNo ?? '' },
        })),
      });
    }
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      return ok(epoch); // already marked
    }
    logError('addMarkedToAction failed', err);
    return fail('Could not mark to division.', epoch);
  }

  revalidateTf(parsed.data.id);
  return ok(epoch);
}

export async function removeMarkedToAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const guard = await requireOsdOrSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = markedToSchema.safeParse({
    id: formData.get('id'),
    divisionId: formData.get('divisionId'),
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  // A Timeline File must always stay marked to at least one division
  // (creation enforces this too). Without the floor a file can reach zero
  // marked divisions, where it stays visible to OSD/JS via the master
  // view but offers no division to spawn tasks into.
  const markedCount = await prisma.timelineFileMarkedTo.count({
    where: { timelineFileId: parsed.data.id },
  });
  if (markedCount <= 1) {
    return fail('A file must stay marked to at least one division.', epoch);
  }

  try {
    await prisma.timelineFileMarkedTo.delete({
      where: {
        timelineFileId_divisionId: {
          timelineFileId: parsed.data.id,
          divisionId: parsed.data.divisionId,
        },
      },
    });
    await prisma.timelineFileActivity.create({
      data: {
        timelineFileId: parsed.data.id,
        actorId: guard.userId,
        eventType: 'marked_to_division_removed',
        payload: { divisionId: parsed.data.divisionId },
      },
    });
    await touchTimelineFileActivity(prisma, parsed.data.id);
  } catch (err) {
    logError('removeMarkedToAction failed', err);
    return fail('Could not remove division.', epoch);
  }

  revalidateTf(parsed.data.id);
  return ok(epoch);
}

const tfIdSchema = z.object({ id: z.string().uuid() });

// ============================================================
// deleteTimelineFileAction — Super Admin only (hard delete)
// ============================================================

export async function deleteTimelineFileAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const session = await auth();
  if (!session?.user) return fail('You are signed out.', epoch);

  // Super Admin only — stricter than the other TF actions.
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isSuperAdmin: true, isActive: true },
  });
  if (!me?.isActive || !me.isSuperAdmin) {
    return fail('Only Super Admin can hard-delete a timeline file.', epoch);
  }

  const parsed = tfIdSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const tf = await prisma.timelineFile.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, refNo: true, subject: true },
  });
  if (!tf) return fail('Timeline file not found.', epoch);

  try {
    await prisma.$transaction(async (tx) => {
      // Detach any tasks that still link to this TF (FK uses NoAction).
      await tx.task.updateMany({
        where: { linkedTimelineFileId: tf.id },
        data: { linkedTimelineFileId: null },
      });
      // Drop any polymorphic attachments rooted at the file. Children of
      // the TF (activity, marked-to, task-links) cascade.
      await tx.attachment.deleteMany({
        where: {
          ownerType: {
            in: ['timeline_file', 'timeline_file_source', 'timeline_file_action'],
          },
          ownerId: tf.id,
        },
      });
      await tx.timelineFile.delete({ where: { id: tf.id } });
      await tx.auditLog.create({
        data: {
          actorId: session.user.id,
          action: 'delete',
          entityType: 'timeline_file',
          entityId: tf.id,
          before: { refNo: tf.refNo, subject: tf.subject },
          after: {},
        },
      });
    });
  } catch (err) {
    logError('deleteTimelineFileAction failed', err);
    return fail('Could not delete.', epoch);
  }

  revalidatePath('/timeline-files');
  return ok(epoch);
}

// ============================================================
// archive / restore — OSD or Super Admin (reversible soft-delete)
// ============================================================
// Unlike the hard delete above (Super Admin only), archiving is a reversible
// curation action, so it matches the OSD/Super-Admin gate the rest of the TF
// lifecycle uses (requireOsdOrSuperAdmin). Archived files leave the active
// lists (kept behind the "Archived TL files" filter) but stay visibility-scoped
// exactly as before — the archive flags never widen who can see a file.

export async function archiveTimelineFileAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const guard = await requireOsdOrSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = tfIdSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const tf = await prisma.timelineFile.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, refNo: true, subject: true, archivedAt: true },
  });
  if (!tf) return fail('Timeline file not found.', epoch);
  if (tf.archivedAt) return ok(epoch); // already archived — idempotent

  try {
    await prisma.$transaction(async (tx) => {
      await tx.timelineFile.update({
        where: { id: tf.id },
        data: { archivedAt: new Date(), archivedById: guard.userId },
      });
      await tx.auditLog.create({
        data: {
          actorId: guard.userId,
          action: 'update',
          entityType: 'timeline_file',
          entityId: tf.id,
          before: { archived: false, refNo: tf.refNo, subject: tf.subject },
          after: { archived: true },
        },
      });
    });
  } catch (err) {
    logError('archiveTimelineFileAction failed', err);
    return fail('Could not archive the timeline file.', epoch);
  }

  revalidateTf(tf.id);
  return ok(epoch);
}

export async function unarchiveTimelineFileAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const guard = await requireOsdOrSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = tfIdSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const tf = await prisma.timelineFile.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, refNo: true, subject: true, archivedAt: true },
  });
  if (!tf) return fail('Timeline file not found.', epoch);
  if (!tf.archivedAt) return ok(epoch); // already active — idempotent

  try {
    await prisma.$transaction(async (tx) => {
      await tx.timelineFile.update({
        where: { id: tf.id },
        data: { archivedAt: null, archivedById: null },
      });
      await tx.auditLog.create({
        data: {
          actorId: guard.userId,
          action: 'update',
          entityType: 'timeline_file',
          entityId: tf.id,
          before: { archived: true, refNo: tf.refNo, subject: tf.subject },
          after: { archived: false },
        },
      });
    });
  } catch (err) {
    logError('unarchiveTimelineFileAction failed', err);
    return fail('Could not restore the timeline file.', epoch);
  }

  revalidateTf(tf.id);
  return ok(epoch);
}

// ============================================================
// Discussion — threaded comments on a Timeline File
// (mirrors the task comment actions in src/app/actions/tasks.ts)
// ============================================================

const TF_COMMENT_EDIT_WINDOW_MS = 5 * 60 * 1000;

/** Resolve `@username` handles in a comment body to user ids. */
async function resolveTfMentions(body: string): Promise<string[]> {
  const handles = Array.from(body.matchAll(/@([a-z0-9][a-z0-9._-]{1,40})/gi)).map(
    (m) => m[1].toLowerCase(),
  );
  if (handles.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { username: { in: handles } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** A user may join a TF discussion exactly when they can see the file. */
async function canViewTf(userId: string, tfId: string): Promise<boolean> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, hierarchySlot: true, isSuperAdmin: true, divisionId: true },
  });
  if (!me) return false;
  const clause = await buildTfVisibilityClause(me);
  const count = await prisma.timelineFile.count({ where: { id: tfId, ...clause } });
  return count > 0;
}

const postTfCommentSchema = z.object({
  id: z.string().uuid(),
  body: z.string().trim().min(1, 'Comment cannot be empty').max(4000),
  parentCommentId: z.string().uuid().optional(),
});

export async function postTfCommentAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const rawParent = formData.get('parentCommentId');
  const parsed = postTfCommentSchema.safeParse({
    id: formData.get('id'),
    body: formData.get('body'),
    parentCommentId: rawParent && rawParent !== '' ? String(rawParent) : undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  const tf = await prisma.timelineFile.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, subject: true, archivedAt: true },
  });
  if (!tf || tf.archivedAt) return fail('Timeline file not found.', epoch);
  if (!(await canViewTf(me.id, tf.id))) return fail('Timeline file not found.', epoch);

  const mentions = await resolveTfMentions(parsed.data.body);

  try {
    const comment = await prisma.timelineFileComment.create({
      data: {
        timelineFileId: tf.id,
        userId: me.id,
        body: parsed.data.body,
        mentions,
        parentCommentId: parsed.data.parentCommentId ?? null,
      },
    });
    // A comment is a discussion update — surface the file in "Recently modified".
    await touchTimelineFileActivity(prisma, tf.id);

    const mentionNotifs: Prisma.NotificationCreateManyInput[] = mentions
      .filter((uid) => uid !== me.id)
      .map((uid) => ({
        userId: uid,
        type: 'mention' as const,
        payload: {
          timelineFileId: tf.id,
          tfSubject: tf.subject,
          commentId: comment.id,
          actorId: me.id,
          actorName: me.name ?? null,
        },
      }));
    if (mentionNotifs.length > 0) {
      await prisma.notification.createMany({ data: mentionNotifs });
    }
  } catch (err) {
    logError('postTfCommentAction failed', err);
    return fail('Could not post comment.', epoch);
  }

  revalidateTf(tf.id);
  return ok(epoch);
}

const editTfCommentSchema = z.object({
  commentId: z.string().uuid(),
  body: z.string().trim().min(1, 'Comment cannot be empty').max(4000),
});

export async function editTfCommentAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = editTfCommentSchema.safeParse({
    commentId: formData.get('commentId'),
    body: formData.get('body'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  const comment = await prisma.timelineFileComment.findUnique({
    where: { id: parsed.data.commentId },
    select: { id: true, userId: true, timelineFileId: true, createdAt: true },
  });
  if (!comment) return fail('Comment not found.', epoch);
  if (comment.userId !== me.id) return fail('You can only edit your own comments.', epoch);
  if (Date.now() - comment.createdAt.getTime() > TF_COMMENT_EDIT_WINDOW_MS) {
    return fail('Comments can only be edited within 5 minutes of posting.', epoch);
  }

  const mentions = await resolveTfMentions(parsed.data.body);

  try {
    await prisma.timelineFileComment.update({
      where: { id: comment.id },
      data: { body: parsed.data.body, mentions, editedAt: new Date() },
    });
  } catch (err) {
    logError('editTfCommentAction failed', err);
    return fail('Could not edit comment.', epoch);
  }

  revalidateTf(comment.timelineFileId);
  return ok(epoch);
}

const deleteTfCommentSchema = z.object({ commentId: z.string().uuid() });

export async function deleteTfCommentAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = deleteTfCommentSchema.safeParse({ commentId: formData.get('commentId') });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const comment = await prisma.timelineFileComment.findUnique({
    where: { id: parsed.data.commentId },
    select: { id: true, userId: true, timelineFileId: true, createdAt: true },
  });
  if (!comment) return fail('Comment not found.', epoch);
  if (comment.userId !== me.id) return fail('You can only delete your own comments.', epoch);
  if (Date.now() - comment.createdAt.getTime() > TF_COMMENT_EDIT_WINDOW_MS) {
    return fail('Comments can only be deleted within 5 minutes of posting.', epoch);
  }

  try {
    await prisma.timelineFileComment.delete({ where: { id: comment.id } });
  } catch (err) {
    logError('deleteTfCommentAction failed', err);
    return fail('Could not delete comment.', epoch);
  }

  revalidateTf(comment.timelineFileId);
  return ok(epoch);
}
