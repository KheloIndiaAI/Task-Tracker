'use server';
import { logError } from '@/lib/utils/log';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { countWords, MAX_DIVISION_NOTICE_WORDS } from '@/lib/format';
import { canEditDivisionNotice, getHeadedDivisionIds } from '@/lib/rbac';
import type { UpdateDivisionNoticeState } from './states';

/**
 * Division-level actions available to more than just Super Admin (unlike
 * admin-structure.ts, which is Super-Admin-only structure management).
 */

type ActionState = UpdateDivisionNoticeState;

function bump(prev: ActionState | undefined): number {
  return (prev?.epoch ?? 0) + 1;
}

function fail(message: string, epoch: number, fieldErrors?: Record<string, string>): ActionState {
  return { ok: false, error: message, epoch, fieldErrors };
}

function ok(epoch: number): ActionState {
  return { ok: true, epoch };
}

// ============================================================
// updateDivisionNoticeAction — the Notice board panel on /tasks
// ============================================================

const updateDivisionNoticeSchema = z.object({
  divisionId: z.string().uuid(),
  noticeBoard: z
    .string()
    .max(1000)
    .optional()
    .transform((s) => (typeof s === 'string' ? s : undefined))
    .refine(
      (s) => s === undefined || countWords(s) <= MAX_DIVISION_NOTICE_WORDS,
      `Keep the notice under ${MAX_DIVISION_NOTICE_WORDS} words`,
    ),
});

export async function updateDivisionNoticeAction(
  prev: UpdateDivisionNoticeState | undefined,
  formData: FormData,
): Promise<UpdateDivisionNoticeState> {
  const epoch = bump(prev);
  const session = await auth();
  if (!session?.user) return fail('You are signed out.', epoch);

  const parsed = updateDivisionNoticeSchema.safeParse({
    divisionId: formData.get('divisionId'),
    noticeBoard: formData.has('noticeBoard') ? (formData.get('noticeBoard') as string) : undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, isSuperAdmin: true, hierarchySlot: true, isActive: true },
  });
  if (!me || !me.isActive) return fail('Your account is unavailable.', epoch);

  const headedDivisionIds = await getHeadedDivisionIds(me.id);
  const canEdit = canEditDivisionNotice(
    { isSuperAdmin: me.isSuperAdmin, isOsd: me.hierarchySlot === 'osd', headedDivisionIds },
    parsed.data.divisionId,
  );
  if (!canEdit) {
    return fail('Only the division head, OSD, or a Super Admin can edit the notice board.', epoch);
  }

  const division = await prisma.division.findUnique({
    where: { id: parsed.data.divisionId },
    select: { id: true, noticeBoard: true },
  });
  if (!division) return fail('Division not found.', epoch);

  if (parsed.data.noticeBoard === undefined) return ok(epoch);
  const nextValue = parsed.data.noticeBoard.length > 0 ? parsed.data.noticeBoard : null;
  if (nextValue === (division.noticeBoard ?? null)) return ok(epoch);

  try {
    await prisma.$transaction([
      prisma.division.update({
        where: { id: division.id },
        data: { noticeBoard: nextValue },
      }),
      prisma.auditLog.create({
        data: {
          actorId: me.id,
          action: 'update',
          entityType: 'division',
          entityId: division.id,
          before: { noticeBoard: division.noticeBoard },
          after: { noticeBoard: nextValue },
        },
      }),
    ]);
  } catch (err) {
    logError('updateDivisionNoticeAction failed', err);
    return fail('Could not save the notice board.', epoch);
  }

  revalidatePath('/tasks');
  return ok(epoch);
}
