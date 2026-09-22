'use server';
import { logError } from '@/lib/utils/log';

import { revalidatePath } from 'next/cache';
import { format } from 'date-fns';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { IST_UTC_OFFSET } from '@/lib/format';
import {
  canDelegateDivision,
  isEligibleDelegate,
  validateDelegationWindow,
} from '@/lib/rbac';
import { organizationOf, STRUCTURE_KIND_LABEL } from '@/lib/structure-shared';

import type { DelegationState } from './states';

/**
 * Division access delegation — a Division Head temporarily hands their
 * division access to another Division Head or a user in their division.
 *
 * A directorate head (an Assistant Director) and an organization head hand
 * over their directorate / organization the same way. The delegate then holds
 * the whole cascade — head powers over every division beneath — for the
 * window, because getHeadedDivisionIds expands a delegated directorate or
 * organization exactly as it expands a headed one.
 *
 * The window is calendar-based (inclusive IST days) and expires on its
 * own: every RBAC read filters on startsAt <= now <= endsAt, so nothing
 * needs a scheduled job. Creating and revoking both notify every Super
 * Admin and write audit_log rows.
 */

function bump(prev: DelegationState | undefined): number {
  return (prev?.epoch ?? 0) + 1;
}

function fail(
  message: string,
  epoch: number,
  fieldErrors?: Record<string, string>,
): DelegationState {
  return { ok: false, error: message, epoch, fieldErrors };
}

function ok(epoch: number, extra?: Partial<DelegationState>): DelegationState {
  return { ok: true, epoch, ...extra };
}

async function requireSession() {
  const session = await auth();
  if (!session?.user) return null;
  return session.user;
}

/** Inclusive IST day bounds for a YYYY-MM-DD pair. */
function istDayStart(day: string): Date {
  return new Date(`${day}T00:00:00${IST_UTC_OFFSET}`);
}
function istDayEnd(day: string): Date {
  return new Date(`${day}T23:59:59.999${IST_UTC_OFFSET}`);
}

async function notifySuperAdmins(
  type: 'division_access_delegated' | 'division_access_delegation_revoked',
  payload: Record<string, unknown>,
  excludeIds: string[],
) {
  const superAdmins = await prisma.user.findMany({
    where: { isSuperAdmin: true, isActive: true, id: { notIn: excludeIds } },
    select: { id: true },
  });
  if (superAdmins.length === 0) return;
  await prisma.notification.createMany({
    data: superAdmins.map((sa) => ({
      userId: sa.id,
      type,
      payload: { ...payload, audience: 'super_admin' },
    })),
  });
}

// ============================================================
// createDelegationAction
// ============================================================

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const createDelegationSchema = z.object({
  divisionId: z.string().uuid('Pick a division'),
  delegateToId: z.string().uuid('Pick a person'),
  startDate: z.string().regex(DAY_RE, 'Pick a start date'),
  endDate: z.string().regex(DAY_RE, 'Pick an end date'),
});

export async function createDelegationAction(
  prev: DelegationState | undefined,
  formData: FormData,
): Promise<DelegationState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out. Refresh and try again.', epoch);

  const parsed = createDelegationSchema.safeParse({
    divisionId: formData.get('divisionId'),
    delegateToId: formData.get('delegateToId'),
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  const [meRow, division, target] = await Promise.all([
    prisma.user.findUnique({
      where: { id: me.id },
      select: {
        id: true,
        name: true,
        isActive: true,
        isSuperAdmin: true,
        isOrganizationHead: true,
        divisionId: true,
      },
    }),
    prisma.division.findUnique({
      where: { id: parsed.data.divisionId },
      select: { id: true, name: true, kind: true, headUserId: true },
    }),
    prisma.user.findUnique({
      where: { id: parsed.data.delegateToId },
      select: {
        id: true,
        name: true,
        isActive: true,
        divisionId: true,
        divisionAccess: { select: { divisionId: true } },
      },
    }),
  ]);
  if (!meRow || !meRow.isActive) return fail('Your account is unavailable.', epoch);
  // Only what can be headed: a division, a directorate or an organization.
  if (
    !division ||
    (division.kind !== 'division' &&
      division.kind !== 'directorate' &&
      division.kind !== 'organization')
  ) {
    return fail('Division not found.', epoch);
  }
  if (!target) return fail('User not found.', epoch);

  // Only the unit's own head (or Super Admin) may delegate — a delegate
  // cannot re-delegate. A division's or directorate's head is its
  // head_user_id; an organization's are the users whose Organization-head
  // toggle is on and whose home division sits in it.
  const mayDelegate =
    division.kind === 'organization'
      ? meRow.isSuperAdmin ||
        (meRow.isOrganizationHead &&
          organizationOf(
            meRow.divisionId,
            await prisma.division.findMany({
              select: { id: true, kind: true, parentId: true, pmuParentDivisionId: true },
            }),
          ) === division.id)
      : canDelegateDivision(meRow, division);
  if (!mayDelegate) {
    const unit = STRUCTURE_KIND_LABEL[division.kind].toLowerCase();
    return fail(`Only the ${unit} head can delegate this ${unit}.`, epoch);
  }

  // Direct headships only for the eligibility check — an existing
  // delegation does not make someone "another Division Head".
  const directHeads = await prisma.division.findMany({
    where: { headUserId: { not: null } },
    select: { id: true, headUserId: true },
  });
  const targetDirectHeaded = directHeads
    .filter((d) => d.headUserId === target.id)
    .map((d) => d.id);

  if (
    !isEligibleDelegate(
      {
        id: target.id,
        isActive: target.isActive,
        memberDivisionIds: [target.divisionId, ...target.divisionAccess.map((a) => a.divisionId)],
        directHeadedDivisionIds: targetDirectHeaded,
      },
      {
        divisionId: division.id,
        delegatorId: meRow.id,
        delegatorHomeDivisionId: meRow.divisionId,
      },
    )
  ) {
    return fail(
      'You can delegate to another division head or a user in your division.',
      epoch,
    );
  }

  const startsAt = istDayStart(parsed.data.startDate);
  const endsAt = istDayEnd(parsed.data.endDate);
  const windowError = validateDelegationWindow({ startsAt, endsAt, now: new Date() });
  if (windowError) return fail(windowError, epoch, { endDate: windowError });

  // One live/upcoming delegation per (division, delegate) at a time.
  const overlapping = await prisma.divisionAccessDelegation.findFirst({
    where: {
      divisionId: division.id,
      delegatedToId: target.id,
      revokedAt: null,
      endsAt: { gte: startsAt },
      startsAt: { lte: endsAt },
    },
    select: { id: true },
  });
  if (overlapping) {
    return fail('This person already holds access to the division in that period.', epoch);
  }

  const windowLabel = `${format(startsAt, 'd LLL yyyy')} – ${format(endsAt, 'd LLL yyyy')}`;

  try {
    const delegation = await prisma.$transaction(async (tx) => {
      const created = await tx.divisionAccessDelegation.create({
        data: {
          divisionId: division.id,
          delegatedById: meRow.id,
          delegatedToId: target.id,
          startsAt,
          endsAt,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: meRow.id,
          action: 'role_change',
          entityType: 'division',
          entityId: division.id,
          before: {},
          after: {
            delegationId: created.id,
            divisionName: division.name,
            delegatedToId: target.id,
            delegatedToName: target.name,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          },
        },
      });
      return created;
    });

    // Best-effort notifications after the transaction.
    const payload = {
      delegationId: delegation.id,
      divisionId: division.id,
      divisionName: division.name,
      delegatedById: meRow.id,
      delegatedByName: meRow.name,
      delegatedToId: target.id,
      delegatedToName: target.name,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      windowLabel,
    };
    await Promise.all([
      notifySuperAdmins('division_access_delegated', payload, [meRow.id, target.id]),
      prisma.notification.create({
        data: {
          userId: target.id,
          type: 'division_access_delegated',
          payload: { ...payload, audience: 'delegate' },
        },
      }),
    ]);
  } catch (err) {
    logError('createDelegationAction failed', err);
    return fail('Could not create the delegation.', epoch);
  }

  revalidatePath('/profile');
  return ok(epoch);
}

// ============================================================
// revokeDelegationAction
// ============================================================

const revokeSchema = z.object({ delegationId: z.string().uuid() });

export async function revokeDelegationAction(
  prev: DelegationState | undefined,
  formData: FormData,
): Promise<DelegationState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out. Refresh and try again.', epoch);

  const parsed = revokeSchema.safeParse({ delegationId: formData.get('delegationId') });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const [meRow, delegation] = await Promise.all([
    prisma.user.findUnique({
      where: { id: me.id },
      select: { id: true, name: true, isActive: true, isSuperAdmin: true },
    }),
    prisma.divisionAccessDelegation.findUnique({
      where: { id: parsed.data.delegationId },
      include: {
        division: { select: { id: true, name: true } },
        delegatedTo: { select: { id: true, name: true } },
      },
    }),
  ]);
  if (!meRow || !meRow.isActive) return fail('Your account is unavailable.', epoch);
  if (!delegation) return fail('Delegation not found.', epoch);
  if (delegation.revokedAt) return ok(epoch);
  if (delegation.endsAt.getTime() < Date.now()) {
    return fail('This delegation has already ended.', epoch);
  }
  if (delegation.delegatedById !== meRow.id && !meRow.isSuperAdmin) {
    return fail('Only the delegating head or Super Admin can revoke this.', epoch);
  }

  try {
    await prisma.$transaction([
      prisma.divisionAccessDelegation.update({
        where: { id: delegation.id },
        data: { revokedAt: new Date(), revokedById: meRow.id },
      }),
      prisma.auditLog.create({
        data: {
          actorId: meRow.id,
          action: 'role_change',
          entityType: 'division',
          entityId: delegation.division.id,
          before: {
            delegationId: delegation.id,
            divisionName: delegation.division.name,
            delegatedToId: delegation.delegatedTo.id,
            delegatedToName: delegation.delegatedTo.name,
            startsAt: delegation.startsAt.toISOString(),
            endsAt: delegation.endsAt.toISOString(),
          },
          after: { delegationId: delegation.id, revoked: true },
        },
      }),
    ]);

    const payload = {
      delegationId: delegation.id,
      divisionId: delegation.division.id,
      divisionName: delegation.division.name,
      delegatedToId: delegation.delegatedTo.id,
      delegatedToName: delegation.delegatedTo.name,
      revokedById: meRow.id,
      revokedByName: meRow.name,
    };
    await Promise.all([
      notifySuperAdmins('division_access_delegation_revoked', payload, [
        meRow.id,
        delegation.delegatedTo.id,
      ]),
      ...(delegation.delegatedTo.id !== meRow.id
        ? [
            prisma.notification.create({
              data: {
                userId: delegation.delegatedTo.id,
                type: 'division_access_delegation_revoked',
                payload: { ...payload, audience: 'delegate' },
              },
            }),
          ]
        : []),
    ]);
  } catch (err) {
    logError('revokeDelegationAction failed', err);
    return fail('Could not revoke the delegation.', epoch);
  }

  revalidatePath('/profile');
  return ok(epoch);
}
