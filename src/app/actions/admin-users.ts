'use server';
import { logError } from '@/lib/utils/log';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db';

/**
 * Super Admin actions for managing users.
 *
 * Every action requires the caller to have is_super_admin = true.
 * Every mutation writes an `audit_log` row so the audit trail (Phase 3)
 * can reconstruct who did what.
 */

// ============================================================
// Shared
// ============================================================

const SLOTS = [
  'hmyas',
  'js',
  'osd',
  'director',
  'deputy_secretary',
  'under_secretary',
  'section_officer',
  'aso',
  'consultant',
] as const;

const CONTRACT_ROLES = ['po', 'apo', 'yp'] as const;

const USERNAME_RE = /^[a-z][a-z0-9._-]{1,40}$/;

/**
 * Optional relation id (uuid or "not set").
 *
 * A disabled <select> — e.g. Section/Sub-division while a PMU is chosen,
 * or PMU in a division with no PMU teams — is omitted from form
 * submission, so `formData.get()` returns null. Coerce null/undefined to
 * '' up front so the field validates as "not set" instead of failing the
 * union with "Invalid input" and blocking the whole save.
 */
const optionalRelationToUndefined = z.preprocess(
  (v) => (v == null ? '' : v),
  z.union([z.literal(''), z.string().uuid()]),
).transform((v) => (v.length > 0 ? v : undefined));

const optionalRelationToNull = z.preprocess(
  (v) => (v == null ? '' : v),
  z.union([z.literal(''), z.string().uuid()]),
).transform((v) => (v.length > 0 ? v : null));

type ActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  epoch?: number;
  userId?: string;
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

async function requireSuperAdmin(): Promise<
  | { ok: true; userId: string }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'You are signed out.' };

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isSuperAdmin: true, isActive: true },
  });
  if (!me) return { ok: false, error: 'Your account could not be found.' };
  if (!me.isActive) return { ok: false, error: 'Your account is disabled.' };
  if (!me.isSuperAdmin) return { ok: false, error: 'Super Admin access is required.' };
  return { ok: true, userId: session.user.id };
}

function revalidateAll() {
  revalidatePath('/admin/users');
  revalidatePath('/admin/structure');
}

async function audit(
  actorId: string,
  action: 'create' | 'update' | 'delete' | 'role_change' | 'password_reset',
  userId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      entityType: 'user',
      entityId: userId,
      before: before as object,
      after: after as object,
    },
  });
}

/**
 * Placement guards shared by create + update: a section must be a
 * `section` row under the chosen sub-division, and a PMU must be a `pmu`
 * row attached to the chosen division. PMU members sit outside the
 * sub-division/section ladder — when a PMU is chosen those two fields
 * are ignored (and persisted as null), never required.
 */
async function validatePlacement(opts: {
  divisionId: string;
  subDivisionId: string | null;
  sectionId: string | null;
  pmuId: string | null;
}): Promise<Record<string, string> | null> {
  const errors: Record<string, string> = {};

  if (opts.sectionId && !opts.pmuId) {
    const section = await prisma.division.findUnique({
      where: { id: opts.sectionId },
      select: { kind: true, parentId: true },
    });
    if (!section || section.kind !== 'section') {
      errors.sectionId = 'Section does not exist';
    } else if (!opts.subDivisionId || section.parentId !== opts.subDivisionId) {
      errors.sectionId = 'Section must belong to the chosen sub-division';
    }
  }

  if (opts.pmuId) {
    const pmu = await prisma.division.findUnique({
      where: { id: opts.pmuId },
      select: { kind: true, parentId: true, pmuParentDivisionId: true },
    });
    if (!pmu || pmu.kind !== 'pmu') {
      errors.pmuId = 'PMU team does not exist';
    } else if (
      pmu.pmuParentDivisionId !== opts.divisionId &&
      pmu.parentId !== opts.divisionId
    ) {
      errors.pmuId = 'PMU must belong to the chosen division';
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * Normalise + validate the extra-division memberships from the form. Dedupes,
 * drops the home division (a division can't be both home and an extra), and
 * confirms every remaining id is a real top-level division (kind 'division').
 * Returns the clean id list, or a fieldErrors object keyed on `extraDivisionIds`.
 */
async function resolveExtraDivisionIds(
  homeDivisionId: string,
  rawIds: string[],
): Promise<{ ok: true; ids: string[] } | { ok: false; fieldErrors: Record<string, string> }> {
  const ids = [...new Set(rawIds)].filter((id) => id !== homeDivisionId);
  if (ids.length === 0) return { ok: true, ids: [] };

  const found = await prisma.division.findMany({
    where: { id: { in: ids }, kind: 'division' },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    return {
      ok: false,
      fieldErrors: { extraDivisionIds: 'Choose additional divisions from the top-level divisions.' },
    };
  }
  return { ok: true, ids };
}

// ============================================================
// createUserAction
// ============================================================

const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'Username is too short')
    .max(40, 'Username is too long')
    .regex(USERNAME_RE, 'Use a–z, 0–9, dots, underscores, dashes; start with a letter'),
  password: z
    .string()
    .min(8, 'Initial password must be at least 8 characters')
    .max(200, 'Initial password is too long'),
  forcePasswordChange: z
    .string()
    .optional()
    .transform((v) => v !== ''),
  designation: z.string().trim().min(1, 'Designation is required').max(120),
  hierarchySlot: z.enum(SLOTS, { errorMap: () => ({ message: 'Pick a hierarchy slot' }) }),
  contractRole: z
    .union([z.literal(''), z.enum(CONTRACT_ROLES)])
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  divisionId: z.string().uuid('Pick a division'),
  subDivisionId: optionalRelationToUndefined,
  sectionId: optionalRelationToUndefined,
  pmuId: optionalRelationToUndefined,
  // Extra divisions the user is a full member of (checkbox list). Repeated
  // form field → getAll(); validated + deduped by resolveExtraDivisionIds.
  extraDivisionIds: z.array(z.string().uuid()).optional().default([]),
  supervisorId: optionalRelationToUndefined,
  isSuperAdmin: z
    .string()
    .optional()
    .transform((v) => v === 'on'),
  canAccessDocumentCentre: z
    .string()
    .optional()
    .transform((v) => v === 'on'),
  canAccessBusinessCards: z
    .string()
    .optional()
    .transform((v) => v === 'on'),
  // phone + work activities are self-service on /profile — the admin form
  // never collects them, so they are intentionally absent here.
});

type AdminUserState = ActionState;
const INITIAL_ADMIN_USER_STATE: AdminUserState = { ok: false, epoch: 0 };

export async function createUserAction(
  prev: AdminUserState | undefined,
  formData: FormData,
): Promise<AdminUserState> {
  const epoch = bump(prev);
  const guard = await requireSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = createUserSchema.safeParse({
    name: formData.get('name'),
    username: formData.get('username'),
    password: formData.get('password'),
    forcePasswordChange: formData.get('forcePasswordChange'),
    designation: formData.get('designation'),
    hierarchySlot: formData.get('hierarchySlot'),
    contractRole: formData.get('contractRole'),
    divisionId: formData.get('divisionId'),
    subDivisionId: formData.get('subDivisionId'),
    sectionId: formData.get('sectionId'),
    pmuId: formData.get('pmuId'),
    extraDivisionIds: formData.getAll('extraDivisionIds'),
    supervisorId: formData.get('supervisorId'),
    isSuperAdmin: formData.get('isSuperAdmin'),
    canAccessDocumentCentre: formData.get('canAccessDocumentCentre'),
    canAccessBusinessCards: formData.get('canAccessBusinessCards'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  // Uniqueness check
  const existing = await prisma.user.findUnique({
    where: { username: parsed.data.username },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, fieldErrors: { username: 'Username is already taken' }, epoch };
  }

  // Division must exist
  const division = await prisma.division.findUnique({
    where: { id: parsed.data.divisionId },
    select: { id: true },
  });
  if (!division) {
    return { ok: false, fieldErrors: { divisionId: 'Division does not exist' }, epoch };
  }

  const placementErrors = await validatePlacement({
    divisionId: parsed.data.divisionId,
    subDivisionId: parsed.data.subDivisionId ?? null,
    sectionId: parsed.data.sectionId ?? null,
    pmuId: parsed.data.pmuId ?? null,
  });
  if (placementErrors) return { ok: false, fieldErrors: placementErrors, epoch };

  const extra = await resolveExtraDivisionIds(parsed.data.divisionId, parsed.data.extraDivisionIds);
  if (!extra.ok) return { ok: false, fieldErrors: extra.fieldErrors, epoch };

  try {
    const passwordHash = await hashPassword(parsed.data.password);
    // User row + extra memberships persist atomically.
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: parsed.data.name,
          username: parsed.data.username,
          passwordHash,
          designation: parsed.data.designation,
          hierarchySlot: parsed.data.hierarchySlot,
          contractRole: parsed.data.contractRole ?? null,
          divisionId: parsed.data.divisionId,
          subDivisionId: parsed.data.pmuId ? null : parsed.data.subDivisionId ?? null,
          sectionId: parsed.data.pmuId ? null : parsed.data.sectionId ?? null,
          pmuId: parsed.data.pmuId ?? null,
          isPmu: Boolean(parsed.data.pmuId),
          supervisorId: parsed.data.supervisorId ?? null,
          isActive: true,
          isSuperAdmin: parsed.data.isSuperAdmin ?? false,
          canAccessDocumentCentre: parsed.data.canAccessDocumentCentre ?? false,
          canAccessBusinessCards: parsed.data.canAccessBusinessCards ?? false,
          forcePasswordChange: parsed.data.forcePasswordChange ?? true,
          createdById: guard.userId,
        },
      });
      if (extra.ids.length > 0) {
        await tx.userDivisionAccess.createMany({
          data: extra.ids.map((divisionId) => ({
            userId: user.id,
            divisionId,
            grantedById: guard.userId,
          })),
        });
      }
      return user;
    });

    await audit(guard.userId, 'create', created.id, {}, {
      name: created.name,
      username: created.username,
      hierarchySlot: created.hierarchySlot,
      divisionId: created.divisionId,
      extraDivisionIds: extra.ids,
      isSuperAdmin: created.isSuperAdmin,
      canAccessDocumentCentre: created.canAccessDocumentCentre,
      canAccessBusinessCards: created.canAccessBusinessCards,
    });

    revalidateAll();
    return ok(epoch, { userId: created.id });
  } catch (err) {
    logError('createUserAction failed', err);
    return fail('Could not create the user. Try again.', epoch);
  }
}

// ============================================================
// updateUserAction
// ============================================================

const updateUserSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().trim().min(1, 'Name is required').max(120),
  designation: z.string().trim().min(1, 'Designation is required').max(120),
  hierarchySlot: z.enum(SLOTS),
  contractRole: z
    .union([z.literal(''), z.enum(CONTRACT_ROLES)])
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  divisionId: z.string().uuid('Pick a division'),
  subDivisionId: optionalRelationToNull,
  sectionId: optionalRelationToNull,
  pmuId: optionalRelationToNull,
  extraDivisionIds: z.array(z.string().uuid()).optional().default([]),
  supervisorId: optionalRelationToNull,
  isSuperAdmin: z
    .string()
    .optional()
    .transform((v) => v === 'on'),
  canAccessDocumentCentre: z
    .string()
    .optional()
    .transform((v) => v === 'on'),
  canAccessBusinessCards: z
    .string()
    .optional()
    .transform((v) => v === 'on'),
  // phone + work activities are self-service on /profile — the admin form
  // never collects them, so they are intentionally absent here (and must
  // never be written from this action, which would wipe self-set values).
});

export async function updateUserAction(
  prev: AdminUserState | undefined,
  formData: FormData,
): Promise<AdminUserState> {
  const epoch = bump(prev);
  const guard = await requireSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = updateUserSchema.safeParse({
    userId: formData.get('userId'),
    name: formData.get('name'),
    designation: formData.get('designation'),
    hierarchySlot: formData.get('hierarchySlot'),
    contractRole: formData.get('contractRole'),
    divisionId: formData.get('divisionId'),
    subDivisionId: formData.get('subDivisionId'),
    sectionId: formData.get('sectionId'),
    pmuId: formData.get('pmuId'),
    extraDivisionIds: formData.getAll('extraDivisionIds'),
    supervisorId: formData.get('supervisorId'),
    isSuperAdmin: formData.get('isSuperAdmin'),
    canAccessDocumentCentre: formData.get('canAccessDocumentCentre'),
    canAccessBusinessCards: formData.get('canAccessBusinessCards'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  const before = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: {
      name: true,
      designation: true,
      hierarchySlot: true,
      contractRole: true,
      divisionAccess: { select: { divisionId: true } },
      divisionId: true,
      subDivisionId: true,
      sectionId: true,
      pmuId: true,
      isPmu: true,
      supervisorId: true,
      isSuperAdmin: true,
      canAccessDocumentCentre: true,
      canAccessBusinessCards: true,
    },
  });
  if (!before) return fail('User not found.', epoch);

  // Don't let the last active Super Admin strip their own access and lock
  // the console for everyone — mirrors setUserActiveAction and
  // setUserSuperAdminAction.
  if (
    before.isSuperAdmin &&
    !parsed.data.isSuperAdmin &&
    parsed.data.userId === guard.userId
  ) {
    const superAdminCount = await prisma.user.count({
      where: { isActive: true, isSuperAdmin: true },
    });
    if (superAdminCount <= 1) {
      return fail('At least one Super Admin must remain.', epoch);
    }
  }

  if (parsed.data.supervisorId === parsed.data.userId) {
    return {
      ok: false,
      fieldErrors: { supervisorId: 'A user cannot supervise themselves' },
      epoch,
    };
  }

  const placementErrors = await validatePlacement({
    divisionId: parsed.data.divisionId,
    subDivisionId: parsed.data.subDivisionId,
    sectionId: parsed.data.sectionId,
    pmuId: parsed.data.pmuId,
  });
  if (placementErrors) return { ok: false, fieldErrors: placementErrors, epoch };

  const extra = await resolveExtraDivisionIds(parsed.data.divisionId, parsed.data.extraDivisionIds);
  if (!extra.ok) return { ok: false, fieldErrors: extra.fieldErrors, epoch };

  // Diff the current memberships against the submitted set so the reconcile
  // only touches what actually changed (and never duplicates the home division,
  // which resolveExtraDivisionIds already excluded).
  const currentExtra = new Set(before.divisionAccess.map((a) => a.divisionId));
  const nextExtra = new Set(extra.ids);
  const extraToRemove = [...currentExtra].filter((id) => !nextExtra.has(id));
  const extraToAdd = [...nextExtra].filter((id) => !currentExtra.has(id));

  // isPmu tracks pmuId, but with one guard: only flip it to false when an
  // ACTUAL PMU assignment is being removed (before.pmuId was set). Legacy
  // PMU users (isPmu = true, pmuId = null) predate pmu_id and keep their
  // status on unrelated edits until they are explicitly attached to a team.
  const nextIsPmu = parsed.data.pmuId
    ? true
    : before.pmuId
      ? false
      : before.isPmu;
  const removingPmu = !nextIsPmu && before.isPmu;

  try {
    // User row + membership reconcile persist atomically.
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: parsed.data.userId },
        data: {
          name: parsed.data.name,
          designation: parsed.data.designation,
          hierarchySlot: parsed.data.hierarchySlot,
          contractRole: parsed.data.contractRole,
          divisionId: parsed.data.divisionId,
          subDivisionId: parsed.data.pmuId ? null : parsed.data.subDivisionId,
          sectionId: parsed.data.pmuId ? null : parsed.data.sectionId,
          pmuId: parsed.data.pmuId,
          isPmu: nextIsPmu,
          // Dropping PMU membership clears the now-meaningless PMU role too.
          ...(removingPmu ? { pmuRole: null } : {}),
          supervisorId: parsed.data.supervisorId,
          isSuperAdmin: parsed.data.isSuperAdmin,
          canAccessDocumentCentre: parsed.data.canAccessDocumentCentre,
          canAccessBusinessCards: parsed.data.canAccessBusinessCards,
        },
      });
      if (extraToRemove.length > 0) {
        await tx.userDivisionAccess.deleteMany({
          where: { userId: u.id, divisionId: { in: extraToRemove } },
        });
      }
      if (extraToAdd.length > 0) {
        await tx.userDivisionAccess.createMany({
          data: extraToAdd.map((divisionId) => ({
            userId: u.id,
            divisionId,
            grantedById: guard.userId,
          })),
          skipDuplicates: true,
        });
      }
      return u;
    });

    await audit(guard.userId, 'update', updated.id, before, {
      name: updated.name,
      designation: updated.designation,
      hierarchySlot: updated.hierarchySlot,
      contractRole: updated.contractRole,
      divisionId: updated.divisionId,
      subDivisionId: updated.subDivisionId,
      sectionId: updated.sectionId,
      pmuId: updated.pmuId,
      extraDivisionIds: extra.ids,
      supervisorId: updated.supervisorId,
      isSuperAdmin: updated.isSuperAdmin,
      canAccessDocumentCentre: updated.canAccessDocumentCentre,
      canAccessBusinessCards: updated.canAccessBusinessCards,
    });

    // Granting or revoking Super Admin is security-sensitive — leave a
    // distinct role_change entry so it is easy to find in the audit trail.
    if (before.isSuperAdmin !== updated.isSuperAdmin) {
      await audit(
        guard.userId,
        'role_change',
        updated.id,
        { isSuperAdmin: before.isSuperAdmin },
        { isSuperAdmin: updated.isSuperAdmin },
      );
    }

    // Granting or revoking Document Centre access is an access change — leave a
    // distinct role_change entry too, mirroring the Super Admin one.
    if (before.canAccessDocumentCentre !== updated.canAccessDocumentCentre) {
      await audit(
        guard.userId,
        'role_change',
        updated.id,
        { canAccessDocumentCentre: before.canAccessDocumentCentre },
        { canAccessDocumentCentre: updated.canAccessDocumentCentre },
      );
    }

    // Granting or revoking Business Cards access is an access change too.
    if (before.canAccessBusinessCards !== updated.canAccessBusinessCards) {
      await audit(
        guard.userId,
        'role_change',
        updated.id,
        { canAccessBusinessCards: before.canAccessBusinessCards },
        { canAccessBusinessCards: updated.canAccessBusinessCards },
      );
    }

    revalidateAll();
    return ok(epoch, { userId: updated.id });
  } catch (err) {
    logError('updateUserAction failed', err);
    return fail('Could not update the user.', epoch);
  }
}

// ============================================================
// resetUserPasswordAction
// ============================================================

const resetPasswordSchema = z.object({
  userId: z.string().uuid(),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(200, 'Password is too long'),
  forceChange: z
    .string()
    .optional()
    .transform((v) => v === 'on' || v === undefined ? true : true),
});

// Note: forceChange default true — Super Admin reset is a security event,
// the user should change to something only they know on next sign-in.
// Override via explicit "no force" select (form sets value 'off').

export async function resetUserPasswordAction(
  prev: AdminUserState | undefined,
  formData: FormData,
): Promise<AdminUserState> {
  const epoch = bump(prev);
  const guard = await requireSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  // Re-read forceChange explicitly since the schema above is awkward.
  const forceChange = formData.get('forceChange') !== 'off';

  const parsed = resetPasswordSchema.safeParse({
    userId: formData.get('userId'),
    newPassword: formData.get('newPassword'),
    forceChange: 'on',
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true },
  });
  if (!target) return fail('User not found.', epoch);

  try {
    const newHash = await hashPassword(parsed.data.newPassword);
    await prisma.user.update({
      where: { id: target.id },
      data: {
        passwordHash: newHash,
        passwordChangedAt: new Date(),
        forcePasswordChange: forceChange,
      },
    });

    await audit(
      guard.userId,
      'password_reset',
      target.id,
      {},
      { forceChange },
    );

    await prisma.notification.create({
      data: {
        userId: target.id,
        type: 'password_reset_by_admin',
        payload: { forceChange },
      },
    });

    revalidatePath('/admin/users');
    return ok(epoch);
  } catch (err) {
    logError('resetUserPasswordAction failed', err);
    return fail('Could not reset the password.', epoch);
  }
}

// ============================================================
// setUserActiveAction — disable / enable
// ============================================================

const setActiveSchema = z.object({
  userId: z.string().uuid(),
  isActive: z.enum(['true', 'false']),
});

export async function setUserActiveAction(
  prev: AdminUserState | undefined,
  formData: FormData,
): Promise<AdminUserState> {
  const epoch = bump(prev);
  const guard = await requireSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = setActiveSchema.safeParse({
    userId: formData.get('userId'),
    isActive: formData.get('isActive'),
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const nextActive = parsed.data.isActive === 'true';

  // Prevent self-lockout.
  if (parsed.data.userId === guard.userId && !nextActive) {
    return fail('You cannot disable your own account.', epoch);
  }

  const before = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { isActive: true, isSuperAdmin: true },
  });
  if (!before) return fail('User not found.', epoch);
  if (before.isActive === nextActive) return ok(epoch);

  // Prevent disabling the last active Super Admin (defensive).
  if (!nextActive && before.isSuperAdmin) {
    const count = await prisma.user.count({
      where: { isActive: true, isSuperAdmin: true },
    });
    if (count <= 1) {
      return fail('At least one active Super Admin must remain.', epoch);
    }
  }

  try {
    await prisma.user.update({
      where: { id: parsed.data.userId },
      data: { isActive: nextActive },
    });
    await audit(
      guard.userId,
      'update',
      parsed.data.userId,
      { isActive: before.isActive },
      { isActive: nextActive },
    );
    revalidateAll();
    return ok(epoch);
  } catch (err) {
    logError('setUserActiveAction failed', err);
    return fail('Could not change status.', epoch);
  }
}

// ============================================================
// setUserSuperAdminAction
// ============================================================

const setSuperAdminSchema = z.object({
  userId: z.string().uuid(),
  isSuperAdmin: z.enum(['true', 'false']),
});

export async function setUserSuperAdminAction(
  prev: AdminUserState | undefined,
  formData: FormData,
): Promise<AdminUserState> {
  const epoch = bump(prev);
  const guard = await requireSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = setSuperAdminSchema.safeParse({
    userId: formData.get('userId'),
    isSuperAdmin: formData.get('isSuperAdmin'),
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const next = parsed.data.isSuperAdmin === 'true';

  const before = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { isSuperAdmin: true, isActive: true },
  });
  if (!before) return fail('User not found.', epoch);
  if (before.isSuperAdmin === next) return ok(epoch);

  // Same lockout protection: don't allow the last Super Admin to demote
  // themselves.
  if (!next && parsed.data.userId === guard.userId) {
    const count = await prisma.user.count({
      where: { isActive: true, isSuperAdmin: true },
    });
    if (count <= 1) {
      return fail('At least one Super Admin must remain.', epoch);
    }
  }

  try {
    await prisma.user.update({
      where: { id: parsed.data.userId },
      data: { isSuperAdmin: next },
    });
    await audit(
      guard.userId,
      'role_change',
      parsed.data.userId,
      { isSuperAdmin: before.isSuperAdmin },
      { isSuperAdmin: next },
    );
    revalidateAll();
    return ok(epoch);
  } catch (err) {
    logError('setUserSuperAdminAction failed', err);
    return fail('Could not change role.', epoch);
  }
}

// ============================================================
// setUserPmuAction — add to / remove from a PMU team
// ============================================================

const setPmuSchema = z.object({
  userId: z.string().uuid(),
  pmuId: z
    .union([z.literal(''), z.string().uuid()])
    .transform((v) => (v && v.length > 0 ? v : null)),
});

/**
 * Explicit PMU membership management (Structure → PMU team → Manage
 * members). Assigning also moves the user into the PMU's home division
 * so placement stays consistent; removing clears the PMU flag and role
 * but leaves the division placement alone. Sub-division and section are
 * never required for PMU members.
 */
export async function setUserPmuAction(
  prev: AdminUserState | undefined,
  formData: FormData,
): Promise<AdminUserState> {
  const epoch = bump(prev);
  const guard = await requireSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = setPmuSchema.safeParse({
    userId: formData.get('userId'),
    pmuId: formData.get('pmuId') ?? '',
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const before = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, divisionId: true, pmuId: true, isPmu: true, pmuRole: true },
  });
  if (!before) return fail('User not found.', epoch);
  if (before.pmuId === parsed.data.pmuId) return ok(epoch);

  try {
    if (parsed.data.pmuId) {
      const pmu = await prisma.division.findUnique({
        where: { id: parsed.data.pmuId },
        select: { id: true, kind: true, parentId: true, pmuParentDivisionId: true },
      });
      if (!pmu || pmu.kind !== 'pmu') return fail('PMU team not found.', epoch);

      // A PMU belongs to one division, and the user's home division is a
      // stable attribute we never move. So the user must already be in the
      // PMU's division — otherwise their division and PMU would disagree
      // (and the edit form, which lists PMUs by division, could not show
      // it). Change the division explicitly first if it needs to move.
      const pmuHome = pmu.pmuParentDivisionId ?? pmu.parentId;
      if (pmuHome !== before.divisionId) {
        return fail(
          "This PMU belongs to a different division. Change the user's division first, then add them.",
          epoch,
        );
      }

      await prisma.user.update({
        where: { id: before.id },
        data: {
          pmuId: pmu.id,
          isPmu: true,
          // PMU members sit outside the sub-division/section ladder.
          subDivisionId: null,
          sectionId: null,
        },
      });
      await audit(guard.userId, 'update', before.id, {
        pmuId: before.pmuId,
        isPmu: before.isPmu,
      }, {
        pmuId: pmu.id,
        isPmu: true,
      });
    } else {
      await prisma.user.update({
        where: { id: before.id },
        data: { pmuId: null, isPmu: false, pmuRole: null },
      });
      await audit(guard.userId, 'update', before.id, {
        pmuId: before.pmuId,
        isPmu: before.isPmu,
        pmuRole: before.pmuRole,
      }, {
        pmuId: null,
        isPmu: false,
        pmuRole: null,
      });
    }

    revalidateAll();
    return ok(epoch);
  } catch (err) {
    logError('setUserPmuAction failed', err);
    return fail('Could not update PMU membership.', epoch);
  }
}

// ============================================================
// changeDivisionAction — quick division reassignment
// ============================================================

const changeDivisionSchema = z.object({
  userId: z.string().uuid(),
  divisionId: z.string().uuid('Pick a division'),
});

export async function changeDivisionAction(
  prev: AdminUserState | undefined,
  formData: FormData,
): Promise<AdminUserState> {
  const epoch = bump(prev);
  const guard = await requireSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = changeDivisionSchema.safeParse({
    userId: formData.get('userId'),
    divisionId: formData.get('divisionId'),
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  // Guard against a sub-division / section / PMU id ever landing here —
  // changing the home division is only valid for a real top-level division.
  const targetDivision = await prisma.division.findUnique({
    where: { id: parsed.data.divisionId },
    select: { kind: true },
  });
  if (!targetDivision || targetDivision.kind !== 'division') {
    return fail('Pick a top-level division.', epoch);
  }

  const before = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { divisionId: true, pmuId: true, isPmu: true },
  });
  if (!before) return fail('User not found.', epoch);
  if (before.divisionId === parsed.data.divisionId) return ok(epoch);

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: parsed.data.userId },
        data: {
          divisionId: parsed.data.divisionId,
          // A division change resets all sub-placement: sub-division and
          // section belong to the old division, and a PMU is division-bound,
          // so the user leaves it too. Leaving them set would orphan the
          // placement (pmuId pointing at a PMU in the old division).
          subDivisionId: null,
          sectionId: null,
          pmuId: null,
          isPmu: false,
          pmuRole: null,
        },
      }),
      // If the new home division was already held as an EXTRA membership, drop
      // that now-redundant row (a division can't be both home and an extra).
      prisma.userDivisionAccess.deleteMany({
        where: { userId: parsed.data.userId, divisionId: parsed.data.divisionId },
      }),
    ]);
    await audit(
      guard.userId,
      'update',
      parsed.data.userId,
      { divisionId: before.divisionId, pmuId: before.pmuId, isPmu: before.isPmu },
      { divisionId: parsed.data.divisionId, pmuId: null, isPmu: false },
    );
    revalidateAll();
    return ok(epoch);
  } catch (err) {
    logError('changeDivisionAction failed', err);
    return fail('Could not change division.', epoch);
  }
}

// ============================================================
// deleteUserAction — permanent hard delete
// ============================================================

const deleteUserSchema = z.object({
  userId: z.string().uuid(),
  /** The admin re-types the target's username to confirm the irreversible delete. */
  confirmUsername: z.string().trim().min(1),
});

/**
 * Permanently delete a user. Every table references `users.id` with
 * NO ACTION / RESTRICT (the app is built around Disable, which keeps
 * history), so a raw delete would fail the moment the user owns or
 * authored anything. To make the delete succeed without orphaning data,
 * one transaction first:
 *   - reassigns their owned/authored content (tasks, comments, activity,
 *     attachments, Timeline Files + their comments/activity/links, tags,
 *     engagements) to the acting Super Admin;
 *   - nulls the nullable back-references (archived-by, audit actor,
 *     division head/creator, supervisor/creator links, delegation revoker,
 *     division-membership granter);
 *   - deletes the join / request / delegation / division-membership rows that
 *     name the user;
 * then deletes the row (notifications and engagement participation cascade).
 *
 * Irreversible. Super Admin only; blocks self-delete, the last active Super
 * Admin, and requires the username to be re-typed.
 */
export async function deleteUserAction(
  prev: AdminUserState | undefined,
  formData: FormData,
): Promise<AdminUserState> {
  const epoch = bump(prev);
  const guard = await requireSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = deleteUserSchema.safeParse({
    userId: formData.get('userId'),
    confirmUsername: formData.get('confirmUsername'),
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const target = parsed.data.userId;
  const heir = guard.userId; // the acting Super Admin inherits the work

  if (target === heir) {
    return fail('You cannot delete your own account.', epoch);
  }

  const before = await prisma.user.findUnique({
    where: { id: target },
    select: { id: true, name: true, username: true, isSuperAdmin: true },
  });
  if (!before) return fail('User not found.', epoch);

  if (parsed.data.confirmUsername.toLowerCase() !== before.username.toLowerCase()) {
    return fail('The typed username does not match. Deletion cancelled.', epoch);
  }

  // Never remove the last active Super Admin.
  if (before.isSuperAdmin) {
    const remaining = await prisma.user.count({
      where: { isActive: true, isSuperAdmin: true, id: { not: target } },
    });
    if (remaining < 1) {
      return fail('At least one active Super Admin must remain.', epoch);
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Reassign owned / authored content to the acting Super Admin.
      await tx.task.updateMany({ where: { ownerId: target }, data: { ownerId: heir } });
      await tx.task.updateMany({ where: { createdById: target }, data: { createdById: heir } });
      await tx.taskComment.updateMany({ where: { userId: target }, data: { userId: heir } });
      await tx.taskActivity.updateMany({ where: { actorId: target }, data: { actorId: heir } });
      await tx.taskCollaborator.updateMany({ where: { addedById: target }, data: { addedById: heir } });
      await tx.attachment.updateMany({ where: { uploadedById: target }, data: { uploadedById: heir } });
      await tx.timelineFile.updateMany({ where: { createdById: target }, data: { createdById: heir } });
      await tx.timelineFileComment.updateMany({ where: { userId: target }, data: { userId: heir } });
      await tx.timelineFileActivity.updateMany({ where: { actorId: target }, data: { actorId: heir } });
      await tx.timelineFileTaskLink.updateMany({ where: { linkedById: target }, data: { linkedById: heir } });
      await tx.tag.updateMany({ where: { createdById: target }, data: { createdById: heir } });
      await tx.jsEngagement.updateMany({ where: { createdById: target }, data: { createdById: heir } });

      // 2. Null the nullable back-references — history is kept, un-attributed.
      await tx.task.updateMany({ where: { archivedById: target }, data: { archivedById: null } });
      await tx.timelineFile.updateMany({ where: { archivedById: target }, data: { archivedById: null } });
      await tx.auditLog.updateMany({ where: { actorId: target }, data: { actorId: null } });
      await tx.division.updateMany({ where: { createdById: target }, data: { createdById: null } });
      await tx.division.updateMany({ where: { headUserId: target }, data: { headUserId: null } });
      await tx.user.updateMany({ where: { supervisorId: target }, data: { supervisorId: null } });
      await tx.user.updateMany({ where: { createdById: target }, data: { createdById: null } });
      await tx.divisionAccessDelegation.updateMany({
        where: { revokedById: target },
        data: { revokedById: null },
      });
      // Division-membership grants the user handed out to others keep their
      // history, un-attributed.
      await tx.userDivisionAccess.updateMany({
        where: { grantedById: target },
        data: { grantedById: null },
      });

      // 3. Delete membership / request / delegation rows that name the user.
      await tx.taskCollaborator.deleteMany({ where: { userId: target } });
      await tx.reassignmentRequest.deleteMany({
        where: {
          OR: [{ requestedById: target }, { proposedOwnerId: target }, { approverId: target }],
        },
      });
      await tx.divisionAccessDelegation.deleteMany({
        where: { OR: [{ delegatedById: target }, { delegatedToId: target }] },
      });
      // The user's own extra-division memberships (FK is NO ACTION, so these
      // must be removed before the user row can be deleted).
      await tx.userDivisionAccess.deleteMany({ where: { userId: target } });

      // 4. Notifications and engagement participation cascade on the delete.
      await tx.user.delete({ where: { id: target } });

      // 5. Record the deletion in the same transaction so the audit trail
      //    can never miss it. The actor (heir) stays alive, and audit_log's
      //    entity_id has no foreign key, so the row outlives the target.
      await tx.auditLog.create({
        data: {
          actorId: heir,
          action: 'delete',
          entityType: 'user',
          entityId: target,
          before: { name: before.name, username: before.username, isSuperAdmin: before.isSuperAdmin },
          after: { deleted: true, workReassignedTo: heir },
        },
      });
    }, { timeout: 30_000 }); // generous window for accounts with heavy history
  } catch (err) {
    logError('deleteUserAction failed', err);
    return fail('Could not delete the user. They may still be referenced somewhere.', epoch);
  }

  revalidateAll();
  return ok(epoch);
}
