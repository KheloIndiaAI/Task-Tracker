'use server';
import { logError } from '@/lib/utils/log';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { allowedParentKinds } from '@/lib/structure-shared';
import {
  collectReportingSubtree,
  resolveUnitPlacement,
  type UnitNode,
} from '@/lib/org-chart';

/**
 * Super Admin actions for managing divisions and hierarchy.
 *
 *   - createDivisionAction:   create division / sub-division / section / PMU
 *   - renameDivisionAction:   rename a node
 *   - deleteDivisionAction:   only if it has no users and no children
 *   - setUserSupervisorAction: drag-and-drop reassignment, with cycle check
 *
 * Every mutation writes an `audit_log` row.
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
  if (!me || !me.isActive) return { ok: false, error: 'Your account is unavailable.' };
  if (!me.isSuperAdmin) return { ok: false, error: 'Super Admin access is required.' };
  return { ok: true, userId: session.user.id };
}

function revalidateAll() {
  revalidatePath('/admin/structure');
  revalidatePath('/admin/users');
}

async function audit(
  actorId: string,
  action: 'create' | 'update' | 'delete' | 'hierarchy_change' | 'role_change',
  entityType: 'division' | 'user',
  entityId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  await prisma.auditLog.create({
    data: { actorId, action, entityType, entityId, before: before as object, after: after as object },
  });
}

// ============================================================
// createDivisionAction
// ============================================================

const KINDS = [
  'organization',
  'directorate',
  'division',
  'sub_division',
  'section',
  'pmu',
] as const;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const createDivisionSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(80, 'Name is too long'),
    abbreviation: z.string().trim().max(10, 'Max 10 characters').default(''),
    kind: z.enum(KINDS, { errorMap: () => ({ message: 'Pick a kind' }) }),
    parentId: z
      .union([z.literal(''), z.string().uuid()])
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    pmuParentDivisionId: z
      .union([z.literal(''), z.string().uuid()])
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    avatarColour: z
      .string()
      .regex(HEX_RE, 'Pick a colour from the palette')
      .default('#1e1b4b'),
  })
  .superRefine((data, ctx) => {
    if (data.kind === 'organization' && data.parentId) {
      ctx.addIssue({
        code: 'custom',
        path: ['parentId'],
        message: 'An organization is the top of its chart and has no parent',
      });
    }
    if (data.kind === 'directorate' && !data.parentId) {
      ctx.addIssue({
        code: 'custom',
        path: ['parentId'],
        message: 'A directorate sits in an organization',
      });
    }
    // Every division now sits in an organization, directly or through a
    // directorate — the rule that keeps a chart from growing loose roots.
    if (data.kind === 'division' && !data.parentId) {
      ctx.addIssue({
        code: 'custom',
        path: ['parentId'],
        message: 'Choose the organization or directorate this division belongs to',
      });
    }
    if (data.kind === 'sub_division' && !data.parentId) {
      ctx.addIssue({ code: 'custom', path: ['parentId'], message: 'Sub-divisions need a parent division' });
    }
    if (data.kind === 'section' && !data.parentId) {
      ctx.addIssue({ code: 'custom', path: ['parentId'], message: 'Sections need a parent sub-division' });
    }
    if (data.kind === 'pmu' && !data.pmuParentDivisionId) {
      ctx.addIssue({
        code: 'custom',
        path: ['pmuParentDivisionId'],
        message: 'PMU teams attach to a division',
      });
    }
  });

type AdminStructureState = ActionState;
const INITIAL_STRUCTURE_STATE: AdminStructureState = { ok: false, epoch: 0 };

export async function createDivisionAction(
  prev: AdminStructureState | undefined,
  formData: FormData,
): Promise<AdminStructureState> {
  const epoch = bump(prev);
  const guard = await requireSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = createDivisionSchema.safeParse({
    name: formData.get('name'),
    abbreviation: formData.get('abbreviation') ?? '',
    kind: formData.get('kind'),
    parentId: formData.get('parentId') ?? undefined,
    pmuParentDivisionId: formData.get('pmuParentDivisionId') ?? undefined,
    avatarColour: formData.get('avatarColour') ?? '#1e1b4b',
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  // Validate parent (must exist + be of the correct kind one level up).
  if (parsed.data.parentId) {
    const parent = await prisma.division.findUnique({
      where: { id: parsed.data.parentId },
      select: { kind: true },
    });
    if (!parent) {
      return { ok: false, fieldErrors: { parentId: 'Parent does not exist' }, epoch };
    }
    // The one shared matrix (allowedParentKinds) decides — the same one the
    // create dialog draws its parent picker from.
    if (!allowedParentKinds(parsed.data.kind).includes(parent.kind)) {
      const expected: Record<string, string> = {
        directorate: 'Pick an organization',
        division: 'Pick an organization or a directorate',
        sub_division: 'Pick a division',
        section: 'Pick a sub-division',
      };
      return {
        ok: false,
        fieldErrors: { parentId: expected[parsed.data.kind] ?? 'That parent is not allowed here' },
        epoch,
      };
    }
  }
  if (parsed.data.pmuParentDivisionId) {
    const pmuParent = await prisma.division.findUnique({
      where: { id: parsed.data.pmuParentDivisionId },
      select: { kind: true },
    });
    if (!pmuParent || pmuParent.kind !== 'division') {
      return {
        ok: false,
        fieldErrors: { pmuParentDivisionId: 'PMU must attach to a division' },
        epoch,
      };
    }
  }

  try {
    const created = await prisma.division.create({
      data: {
        name: parsed.data.name,
        abbreviation: parsed.data.abbreviation,
        kind: parsed.data.kind,
        parentId: parsed.data.parentId,
        pmuParentDivisionId: parsed.data.pmuParentDivisionId,
        avatarColour: parsed.data.avatarColour,
        displayOrder: 0,
        createdById: guard.userId,
      },
    });

    // If creating a PMU, flag the parent division.
    if (parsed.data.kind === 'pmu' && parsed.data.pmuParentDivisionId) {
      await prisma.division.update({
        where: { id: parsed.data.pmuParentDivisionId },
        data: { hasPmu: true },
      });
    }

    await audit(guard.userId, 'create', 'division', created.id, {}, {
      name: created.name,
      kind: created.kind,
      parentId: created.parentId,
      pmuParentDivisionId: created.pmuParentDivisionId,
    });

    revalidateAll();
    return ok(epoch, { id: created.id });
  } catch (err) {
    logError('createDivisionAction failed', err);
    return fail('Could not create. Try again.', epoch);
  }
}

// ============================================================
// renameDivisionAction
// ============================================================

const renameDivisionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Name is required').max(80),
});

export async function renameDivisionAction(
  prev: AdminStructureState | undefined,
  formData: FormData,
): Promise<AdminStructureState> {
  const epoch = bump(prev);
  const guard = await requireSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = renameDivisionSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  const before = await prisma.division.findUnique({
    where: { id: parsed.data.id },
    select: { name: true },
  });
  if (!before) return fail('Not found.', epoch);
  if (before.name === parsed.data.name) return ok(epoch);

  try {
    await prisma.division.update({
      where: { id: parsed.data.id },
      data: { name: parsed.data.name },
    });
    await audit(guard.userId, 'update', 'division', parsed.data.id, before, {
      name: parsed.data.name,
    });
  } catch (err) {
    logError('renameDivisionAction failed', err);
    return fail('Could not rename.', epoch);
  }

  revalidateAll();
  return ok(epoch);
}

// ============================================================
// deleteDivisionAction (empty only)
// ============================================================

const deleteDivisionSchema = z.object({ id: z.string().uuid() });

export async function deleteDivisionAction(
  prev: AdminStructureState | undefined,
  formData: FormData,
): Promise<AdminStructureState> {
  const epoch = bump(prev);
  const guard = await requireSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = deleteDivisionSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const node = await prisma.division.findUnique({
    where: { id: parsed.data.id },
    select: {
      name: true,
      kind: true,
      pmuParentDivisionId: true,
      _count: {
        select: {
          children: true,
          usersInDivision: true,
          usersInSubDivision: true,
          usersInSection: true,
          tasks: true,
        },
      },
    },
  });
  if (!node) return fail('Not found.', epoch);

  const inUse =
    node._count.children > 0 ||
    node._count.usersInDivision > 0 ||
    node._count.usersInSubDivision > 0 ||
    node._count.usersInSection > 0 ||
    node._count.tasks > 0;

  if (inUse) {
    const unit =
      node.kind === 'organization' || node.kind === 'directorate' ? node.kind : 'division';
    return fail(
      `This ${unit} has people, children, or tasks attached. Move them out first.`,
      epoch,
    );
  }

  try {
    await prisma.division.delete({ where: { id: parsed.data.id } });
    await audit(guard.userId, 'delete', 'division', parsed.data.id, { name: node.name }, {});

    if (node.kind === 'pmu' && node.pmuParentDivisionId) {
      const remainingPmus = await prisma.division.count({
        where: { pmuParentDivisionId: node.pmuParentDivisionId },
      });
      if (remainingPmus === 0) {
        await prisma.division.update({
          where: { id: node.pmuParentDivisionId },
          data: { hasPmu: false },
        });
      }
    }
  } catch (err) {
    logError('deleteDivisionAction failed', err);
    return fail('Could not delete.', epoch);
  }

  revalidateAll();
  return ok(epoch);
}

// ============================================================
// setUserSupervisorAction — drag-and-drop reassignment
// ============================================================

const setSupervisorSchema = z.object({
  userId: z.string().uuid(),
  supervisorId: z
    .union([z.literal(''), z.string().uuid()])
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

async function wouldCreateCycle(userId: string, supervisorId: string): Promise<boolean> {
  let current: string | null = supervisorId;
  const seen = new Set<string>([userId]);
  while (current) {
    if (seen.has(current)) return true;
    seen.add(current);
    const next: { supervisorId: string | null } | null = await prisma.user.findUnique({
      where: { id: current },
      select: { supervisorId: true },
    });
    current = next?.supervisorId ?? null;
  }
  return false;
}

export async function setUserSupervisorAction(
  prev: AdminStructureState | undefined,
  formData: FormData,
): Promise<AdminStructureState> {
  const epoch = bump(prev);
  const guard = await requireSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = setSupervisorSchema.safeParse({
    userId: formData.get('userId'),
    supervisorId: formData.get('supervisorId'),
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  if (parsed.data.userId === parsed.data.supervisorId) {
    return fail('A user cannot supervise themselves.', epoch);
  }

  if (
    parsed.data.supervisorId &&
    (await wouldCreateCycle(parsed.data.userId, parsed.data.supervisorId))
  ) {
    return fail('This would create a reporting loop.', epoch);
  }

  const before = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { supervisorId: true },
  });
  if (!before) return fail('User not found.', epoch);
  if (before.supervisorId === parsed.data.supervisorId) return ok(epoch);

  try {
    await prisma.user.update({
      where: { id: parsed.data.userId },
      data: { supervisorId: parsed.data.supervisorId },
    });
    await audit(
      guard.userId,
      'hierarchy_change',
      'user',
      parsed.data.userId,
      { supervisorId: before.supervisorId },
      { supervisorId: parsed.data.supervisorId },
    );
  } catch (err) {
    logError('setUserSupervisorAction failed', err);
    return fail('Could not reassign.', epoch);
  }

  revalidateAll();
  return ok(epoch);
}

// ============================================================
// moveTeamToUnitAction — relocate a whole reporting team to a unit
// ============================================================

const moveTeamSchema = z.object({
  userId: z.string().uuid(),
  targetNodeId: z.string().uuid(),
});

/**
 * Drag a team onto a division / sub-division / section / PMU in the
 * structure tree. Moves the dragged user AND their entire reporting
 * subtree into that unit in one transaction, giving every member the
 * same self-consistent placement (division + ladder or PMU, mutually
 * exclusive). Internal supervisor links are preserved — only placement
 * changes — so the team keeps its shape in its new home.
 *
 * Super Admin only. Because moving in/out of a PMU flips visibility
 * isolation, /tasks is revalidated too.
 */
export async function moveTeamToUnitAction(
  prev: AdminStructureState | undefined,
  formData: FormData,
): Promise<AdminStructureState> {
  const epoch = bump(prev);
  const guard = await requireSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = moveTeamSchema.safeParse({
    userId: formData.get('userId'),
    targetNodeId: formData.get('targetNodeId'),
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const [divisionRows, users, root] = await Promise.all([
    prisma.division.findMany({
      select: { id: true, kind: true, parentId: true, pmuParentDivisionId: true },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        supervisorId: true,
        divisionId: true,
        subDivisionId: true,
        sectionId: true,
        pmuId: true,
        isPmu: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: parsed.data.userId },
      select: { id: true, name: true, isActive: true },
    }),
  ]);
  if (!root || !root.isActive) return fail('User not found or inactive.', epoch);

  const nodeById = new Map<string, UnitNode>(
    divisionRows.map((d) => [
      d.id,
      { id: d.id, kind: d.kind, parentId: d.parentId, pmuParentDivisionId: d.pmuParentDivisionId },
    ]),
  );
  const target = nodeById.get(parsed.data.targetNodeId);
  if (!target) return fail('Target unit not found.', epoch);

  const placement = resolveUnitPlacement(target, nodeById);
  if ('error' in placement) return fail(placement.error, epoch);

  const rootRow = users.find((u) => u.id === root.id);
  if (!rootRow) return fail('User not found.', epoch);

  // The home division is a stable attribute and is NEVER changed by a move.
  // Every unit (sub-division, section, PMU) belongs to a division, so a
  // move is only allowed within the team's own division — otherwise the
  // user's division and placement would disagree. Relocating a division is
  // an explicit action (Edit user), not a side effect of a move.
  if (placement.divisionId !== rootRow.divisionId) {
    return fail(
      'That unit is in a different division. A move keeps the division — change it from Edit user first.',
      epoch,
    );
  }

  // Scope the "team" to the root's own unit (its division, or its PMU when
  // the root is a PMU member) before walking the reporting subtree. A
  // cross-division report is part of nobody's visible chart, so it is left
  // where it is rather than being silently yanked into the target.
  const inRootScope = (u: { divisionId: string; pmuId: string | null }) =>
    rootRow.pmuId != null ? u.pmuId === rootRow.pmuId : u.divisionId === rootRow.divisionId;
  const scoped = users.filter(inRootScope);
  const subtreeIds = collectReportingSubtree(
    scoped.map((u) => ({ id: u.id, supervisorId: u.supervisorId })),
    root.id,
  );
  const subtreeSet = new Set(subtreeIds);
  const members = users.filter((u) => subtreeSet.has(u.id));

  // Desired isPmu per member. Moving into a PMU makes everyone a member;
  // moving into a ministry unit only clears the flag for members who held
  // an actual PMU assignment (pmuId set) — legacy PMU users (isPmu=true,
  // pmuId=null) keep their status until explicitly attached, matching
  // updateUserAction's guard.
  const desiredIsPmu = (u: { pmuId: string | null; isPmu: boolean }) =>
    placement.isPmu ? true : u.pmuId != null ? false : u.isPmu;

  // Placement fields written to every member — deliberately NOT including
  // divisionId, which stays exactly as it is.
  const placementFields = {
    subDivisionId: placement.subDivisionId,
    sectionId: placement.sectionId,
    pmuId: placement.pmuId,
  };

  // Idempotent no-op: skip only when EVERY member already matches the
  // target placement (so a split team is still repaired). divisionId is
  // excluded since it never changes.
  const anyChange = members.some(
    (u) =>
      (u.subDivisionId ?? null) !== placementFields.subDivisionId ||
      (u.sectionId ?? null) !== placementFields.sectionId ||
      (u.pmuId ?? null) !== placementFields.pmuId ||
      u.isPmu !== desiredIsPmu(u),
  );
  if (!anyChange) return ok(epoch);

  try {
    await prisma.$transaction(async (tx) => {
      if (placement.isPmu) {
        await tx.user.updateMany({
          where: { id: { in: subtreeIds } },
          data: { ...placementFields, isPmu: true },
        });
      } else {
        // Members leaving an actual PMU: clear isPmu + the now-meaningless
        // role. Everyone else keeps their isPmu (preserves legacy status).
        const leavingPmuIds = members.filter((u) => u.pmuId != null).map((u) => u.id);
        const restIds = subtreeIds.filter((id) => !leavingPmuIds.includes(id));
        if (leavingPmuIds.length > 0) {
          await tx.user.updateMany({
            where: { id: { in: leavingPmuIds } },
            data: { ...placementFields, isPmu: false, pmuRole: null },
          });
        }
        if (restIds.length > 0) {
          await tx.user.updateMany({
            where: { id: { in: restIds } },
            data: placementFields,
          });
        }
      }
      await tx.auditLog.create({
        data: {
          actorId: guard.userId,
          action: 'update',
          entityType: 'user',
          entityId: root.id,
          before: {},
          after: {
            movedTeam: true,
            leadName: root.name,
            memberCount: subtreeIds.length,
            targetNodeId: target.id,
            targetKind: target.kind,
            placement,
          },
        },
      });
    });
  } catch (err) {
    logError('moveTeamToUnitAction failed', err);
    return fail('Could not move the team.', epoch);
  }

  revalidateAll();
  revalidatePath('/tasks');
  return ok(epoch);
}

// ============================================================
// setDivisionHeadAction — assign or clear a division's head (RBAC)
// ============================================================

const setDivisionHeadSchema = z.object({
  divisionId: z.string().uuid(),
  headUserId: z
    .union([z.literal(''), z.string().uuid()])
    .transform((v) => (v && v.length > 0 ? v : null)),
});

/**
 * The head mapping drives division-based RBAC (assignment, transfer
 * targets, delegation rights), so it is Super Admin-only and always
 * audited. Clearing the head leaves the division without one — its users
 * fall back to transfers via Super Admin.
 */
export async function setDivisionHeadAction(
  prev: AdminStructureState | undefined,
  formData: FormData,
): Promise<AdminStructureState> {
  const epoch = bump(prev);
  const guard = await requireSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = setDivisionHeadSchema.safeParse({
    divisionId: formData.get('divisionId'),
    headUserId: formData.get('headUserId') ?? '',
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const division = await prisma.division.findUnique({
    where: { id: parsed.data.divisionId },
    select: { id: true, name: true, kind: true, headUserId: true },
  });
  if (!division) return fail('Division not found.', epoch);
  // A division has one head; so does a directorate (its Assistant Director),
  // and heading one cascades to every division beneath it. An organization's
  // heads are different in kind — every Super Admin, plus whoever carries the
  // Organization-head toggle — so they are set from Users, not here.
  if (division.kind === 'organization') {
    return fail(
      'Organization heads are set from Users: switch on Organization head for the person.',
      epoch,
    );
  }
  if (division.kind !== 'division' && division.kind !== 'directorate') {
    return fail('Only a division or a directorate has a head.', epoch);
  }
  if (division.headUserId === parsed.data.headUserId) return ok(epoch);

  let headName: string | null = null;
  if (parsed.data.headUserId) {
    const head = await prisma.user.findUnique({
      where: { id: parsed.data.headUserId },
      select: { id: true, name: true, isActive: true },
    });
    if (!head || !head.isActive) return fail('User not found or disabled.', epoch);
    headName = head.name;
  }

  try {
    await prisma.division.update({
      where: { id: division.id },
      data: { headUserId: parsed.data.headUserId },
    });
    await audit(
      guard.userId,
      'role_change',
      'division',
      division.id,
      { headUserId: division.headUserId },
      { headUserId: parsed.data.headUserId, headName },
    );
  } catch (err) {
    logError('setDivisionHeadAction failed', err);
    return fail('Could not change the division head.', epoch);
  }

  revalidateAll();
  revalidatePath('/profile');
  return ok(epoch);
}

// ============================================================
// setPmuTeamHeadAction — designate a division's PMU Team Head
// ============================================================

const setPmuTeamHeadSchema = z.object({
  /** The PMU itself (a Division row of kind 'pmu'), not its parent division. */
  pmuId: z.string().uuid(),
  headUserId: z
    .union([z.literal(''), z.string().uuid()])
    .transform((v) => (v && v.length > 0 ? v : null)),
});

/**
 * Designate (or clear) ONE PMU's **Team Head** — the member of that PMU holding
 * `pmu_role = 'pmu_team_leader'`, who administers the team's tasks (edit,
 * allot, collaborators, attachments, and delete of the team's own tasks — see
 * PERMISSIONS.md §5.19). Super Admin only, audited.
 *
 * Scoped to a single PMU on purpose. A division can carry several (Khelo India
 * Scheme has INFRA_PMU, KIS_PMU and PPP_PMU), and each runs its own team, so
 * each gets its own head. Until 2026-09-17 this took the PARENT division id:
 * it showed whichever leader happened to sort first as "the" head, offered
 * candidates pooled across every PMU under the division, and cleared demoted
 * the leaders of ALL of them at once.
 *
 * Promoting demotes the previous head OF THAT PMU to `pmu_senior_consultant`,
 * so a PMU has at most one head; the other PMUs under the same division are
 * untouched. Clearing demotes only that PMU's head, leaving it with no team
 * admin.
 */
export async function setPmuTeamHeadAction(
  prev: AdminStructureState | undefined,
  formData: FormData,
): Promise<AdminStructureState> {
  const epoch = bump(prev);
  const guard = await requireSuperAdmin();
  if (!guard.ok) return fail(guard.error, epoch);

  const parsed = setPmuTeamHeadSchema.safeParse({
    pmuId: formData.get('pmuId'),
    headUserId: formData.get('headUserId') ?? '',
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const pmu = await prisma.division.findUnique({
    where: { id: parsed.data.pmuId },
    select: { id: true, name: true, kind: true },
  });
  if (!pmu) return fail('PMU not found.', epoch);
  if (pmu.kind !== 'pmu') {
    return fail('A team head can only be set on a PMU.', epoch);
  }

  // The chosen head, if any, must be an active member of THIS PMU. Keying on
  // pmu_id rather than the home division is what keeps sibling PMUs apart —
  // every member of a PMU shares its parent division as their home.
  let newHead: { id: string; name: string } | null = null;
  if (parsed.data.headUserId) {
    const u = await prisma.user.findUnique({
      where: { id: parsed.data.headUserId },
      select: { id: true, name: true, isActive: true, isPmu: true, pmuId: true },
    });
    if (!u || !u.isActive) return fail('User not found or disabled.', epoch);
    if (!u.isPmu || u.pmuId !== pmu.id) {
      return fail('Choose a member of this PMU.', epoch);
    }
    newHead = { id: u.id, name: u.name };
  }

  // Current head(s) of THIS PMU, for the audit trail.
  const prevLeaders = await prisma.user.findMany({
    where: { pmuId: pmu.id, isPmu: true, pmuRole: 'pmu_team_leader' },
    select: { id: true, name: true },
  });
  if (newHead && prevLeaders.length === 1 && prevLeaders[0].id === newHead.id) {
    return ok(epoch); // already the head — no-op
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (newHead) {
        // Demote any other current leader OF THIS PMU…
        await tx.user.updateMany({
          where: {
            pmuId: pmu.id,
            isPmu: true,
            pmuRole: 'pmu_team_leader',
            id: { not: newHead.id },
          },
          data: { pmuRole: 'pmu_senior_consultant' },
        });
        // …and promote the chosen member.
        await tx.user.update({
          where: { id: newHead.id },
          data: { pmuRole: 'pmu_team_leader' },
        });
      } else {
        // Clear: demote this PMU's head. Sibling PMUs keep theirs.
        await tx.user.updateMany({
          where: { pmuId: pmu.id, isPmu: true, pmuRole: 'pmu_team_leader' },
          data: { pmuRole: 'pmu_senior_consultant' },
        });
      }
    });
    await audit(
      guard.userId,
      'role_change',
      'division',
      pmu.id,
      { pmuTeamHead: prevLeaders.map((l) => l.name).join(', ') || null },
      { pmuTeamHead: newHead?.name ?? null },
    );
  } catch (err) {
    logError('setPmuTeamHeadAction failed', err);
    return fail('Could not change the PMU team head.', epoch);
  }

  revalidateAll();
  revalidatePath('/profile');
  return ok(epoch);
}
