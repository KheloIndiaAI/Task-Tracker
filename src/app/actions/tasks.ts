'use server';
import { logError } from '@/lib/utils/log';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { Prisma } from '@prisma/client';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { touchTaskActivity, touchTimelineFileActivity } from '@/lib/activity';
import { parseDueDateInput } from '@/lib/format';
import {
  canActAsHeadOf,
  canAssignTaskTo,
  canCreateDivisionTask,
  canManageTask,
  canTransferTaskTo,
  getHeadedDivisionIds,
  getMemberDivisionIds,
  getRbacActor,
  getRbacTarget,
  resolveDivisionOwner,
} from '@/lib/rbac';
import { buildVisibilityClauses, getPmuParentDivisionHeadId } from '@/lib/visibility';
import { getPmuTeamMemberIds, isElevatedOverDivision } from '@/lib/pmu-team';
import {
  buildTaskParticipantWhere,
  isTaskCollaborator,
  isTaskParticipant,
} from '@/lib/task-participants';
import { nextSubtaskRefNumber, nextTaskRefNumber } from '@/lib/task-ref';

/**
 * Task server actions.
 *
 * Each action validates with Zod, checks the caller's session, writes the
 * entity row + a `task_activity` event, and revalidates the affected paths.
 *
 * Permissions for Phase 1: a caller who can see a task can edit it. The
 * audit log (`task_activity`) preserves who did what. Tightened in Phase 2+
 * via the same scoper used for reads.
 */

// ============================================================
// Shared
// ============================================================

const STATUSES = ['not_started', 'in_progress', 'awaiting_input', 'on_hold', 'completed'] as const;
const PRIORITY = ['low', 'medium', 'high', 'urgent'] as const;
const VISIBILITY = ['division', 'personal'] as const;

type ActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Counter so identical successive successes are observable in useEffect. */
  epoch?: number;
  /**
   * Id of the row a create action just produced — currently the new subtask
   * from addSubtaskAction, so the client can attach a document to it before
   * refreshing. Absent on every other action.
   */
  subtaskId?: string;
};

function bump(prev: ActionState | undefined): number {
  return (prev?.epoch ?? 0) + 1;
}

function fail(message: string, epoch: number, fieldErrors?: Record<string, string>): ActionState {
  return { ok: false, error: message, epoch, fieldErrors };
}

function ok(epoch: number): ActionState {
  return { ok: true, epoch };
}

async function requireSession() {
  const session = await auth();
  if (!session?.user) return null;
  return session.user;
}

function revalidateTask(taskId: string) {
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath('/tasks');
}

function nextOccurrence(
  base: Date,
  rule: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'half_yearly',
): Date {
  const d = new Date(base);
  switch (rule) {
    case 'daily':
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case 'weekly':
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case 'monthly':
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case 'quarterly':
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case 'half_yearly':
      d.setUTCMonth(d.getUTCMonth() + 6);
      break;
  }
  return d;
}

async function spawnRecurringTask(taskId: string, actorId: string): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      name: true,
      description: true,
      ownerId: true,
      divisionId: true,
      subDivisionId: true,
      priority: true,
      visibility: true,
      dueDate: true,
      recurrenceRule: true,
      createdById: true,
      linkedTimelineFileId: true,
    },
  });
  if (!task?.recurrenceRule || !task.dueDate) return;

  const nextDue = nextOccurrence(task.dueDate, task.recurrenceRule);

  await prisma.$transaction(async (tx) => {
    const refNumber = await nextTaskRefNumber(
      { divisionId: task.divisionId, linkedTimelineFileId: task.linkedTimelineFileId },
      tx,
    );
    const spawned = await tx.task.create({
      data: {
        refNumber,
        name: task.name,
        description: task.description,
        ownerId: task.ownerId,
        divisionId: task.divisionId,
        subDivisionId: task.subDivisionId,
        priority: task.priority,
        visibility: task.visibility,
        dueDate: nextDue,
        recurrenceRule: task.recurrenceRule,
        createdById: task.createdById,
        linkedTimelineFileId: task.linkedTimelineFileId,
      },
    });
    await tx.taskActivity.create({
      data: {
        taskId: spawned.id,
        actorId,
        eventType: 'recurrence_spawned',
        payload: { sourceTaskId: taskId },
      },
    });
  });
}

async function canEditTask(
  callerId: string,
  task: { ownerId: string; createdById: string; divisionId: string; visibility: string },
): Promise<boolean> {
  // Owner / creator never need a role lookup — the creator keeps this even
  // after handing ownership off (see canManageTask).
  if (task.ownerId === callerId || task.createdById === callerId) return true;
  const caller = await prisma.user.findUnique({
    where: { id: callerId },
    select: { id: true, isSuperAdmin: true, hierarchySlot: true },
  });
  if (!caller) return false;
  // headedDivisionIds folds in active delegations, so a delegate manages the
  // division's tasks exactly as its head would; memberDivisionIds (home +
  // admin-granted extras) lets a Director member manage that division's tasks;
  // pmuTeamMemberIds lets a PMU team leader manage their team's tasks.
  const [headedDivisionIds, memberDivisionIds, pmuTeamMemberIds] = await Promise.all([
    getHeadedDivisionIds(callerId),
    getMemberDivisionIds(callerId),
    getPmuTeamMemberIds(callerId),
  ]);
  return canManageTask({ ...caller, memberDivisionIds, headedDivisionIds, pmuTeamMemberIds }, task);
}

/**
 * Editing a task's definition — its name, due date, or recurrence — and
 * deleting it are privileged actions. Unlike canEditTask,
 * simply owning the task is NOT enough: a normal user who receives a task
 * (e.g. via transfer) can work it (status, subtasks) but cannot redefine
 * or delete it. Allowed for a Super Admin, OSD, JS, a director of the
 * task's division, or its head — and for a user's own personal task, which
 * only they can see.
 */
async function canEditTaskDetails(
  callerId: string,
  task: { ownerId: string; divisionId: string; visibility: string },
): Promise<boolean> {
  if (task.visibility === 'personal' && task.ownerId === callerId) return true;
  const caller = await prisma.user.findUnique({
    where: { id: callerId },
    select: { isSuperAdmin: true, hierarchySlot: true },
  });
  if (!caller) return false;
  if (caller.isSuperAdmin) return true;
  if (caller.hierarchySlot === 'js' || caller.hierarchySlot === 'osd') return true;
  // A Director who is a member (home or admin-granted extra) of the task's
  // division may redefine it, matching the canEditTask management gate.
  if (caller.hierarchySlot === 'director') {
    const memberDivisionIds = await getMemberDivisionIds(callerId);
    if (memberDivisionIds.includes(task.divisionId)) return true;
  }
  const actor = await getRbacActor(callerId);
  return actor !== null && canActAsHeadOf(actor, task.divisionId);
}

/**
 * Whether `callerId` may DELETE `task` as its PMU Team Head. Granted only when:
 *   - the task is a DIVISION-visibility task owned by a member of the caller's
 *     PMU team (so it is one of the team's own board tasks), AND
 *   - the task was NOT allotted (created) by an elevated role — a Division Head,
 *     Super Admin, or OSD — which retains exclusive delete control over the
 *     tasks it hands the team.
 * Returns false for a non-leader caller (empty team). See PERMISSIONS.md §5.19.
 *
 * `isElevatedOverDivision` reads the allotter's CURRENT status (consistent with
 * the rest of the RBAC layer, which never snapshots authority): a task allotted
 * by an acting delegate whose window later lapses, or by a head who is later
 * replaced, stops counting as elevated-allotted — but the CURRENT division head
 * / Super Admin / OSD always retains delete control regardless, so the elevated
 * tier never loses the task.
 */
async function canPmuHeadDeleteOwnedTask(
  callerId: string,
  task: { ownerId: string; createdById: string; divisionId: string; visibility: string },
): Promise<boolean> {
  if (task.visibility !== 'division') return false;
  const team = await getPmuTeamMemberIds(callerId);
  if (!team.includes(task.ownerId)) return false;
  return !(await isElevatedOverDivision(task.createdById, task.divisionId));
}

/**
 * Whether the given task ids carry any attachment uploaded by an elevated role
 * (Division Head / Super Admin / OSD). Used to stop a PMU Team Head's task
 * delete from cascade-deleting a document those roles uploaded — a protected
 * document may only be removed by them (see `deleteAttachmentAction`). The
 * division head / Super Admin / OSD delete the task via their own gate, so this
 * guard applies to the PMU-head path only.
 */
async function taskIdsHaveElevatedUpload(
  taskIds: string[],
  divisionId: string,
): Promise<boolean> {
  const uploads = await prisma.attachment.findMany({
    where: { ownerType: 'task', ownerId: { in: taskIds } },
    select: { uploadedById: true },
  });
  const uploaderIds = [...new Set(uploads.map((u) => u.uploadedById))];
  for (const uid of uploaderIds) {
    if (await isElevatedOverDivision(uid, divisionId)) return true;
  }
  return false;
}

async function canViewTask(callerId: string, taskId: string): Promise<boolean> {
  const me = await prisma.user.findUnique({
    where: { id: callerId },
    select: { id: true, hierarchySlot: true, isSuperAdmin: true, divisionId: true, isPmu: true, pmuId: true },
  });
  if (!me) return false;
  const visibilityClauses = await buildVisibilityClauses(me);
  const count = await prisma.task.count({
    where: { id: taskId, OR: visibilityClauses },
  });
  return count > 0;
}

// ============================================================
// createTask — turn B
// ============================================================

const createTaskSchema = z.object({
  name: z.string().trim().min(1, 'Task name is required').max(200, 'Task name is too long'),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined)),
  dueDate: z
    .string()
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined))
    .refine((s) => !s || !Number.isNaN(Date.parse(s)), 'Due date is invalid'),
  priority: z.enum(PRIORITY).default('low'),
  visibility: z.enum(VISIBILITY).default('division'),
  divisionId: z.string().uuid().optional(),
  // Optional sub-division within the target division — a Division row of
  // kind 'sub_division' whose parent is the target. Categorisation only; it
  // does not affect ownership or visibility. Empty string → undefined.
  subDivisionId: z
    .union([z.literal(''), z.string().uuid()])
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Optional initial owner, named by a head at creation (see below). Empty
  // string → undefined so "unassigned" stays the default.
  ownerId: z
    .union([z.literal(''), z.string().uuid()])
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  linkedTimelineFileId: z
    .union([z.literal(''), z.string().uuid()])
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  driveUrl: z
    .string()
    .trim()
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined))
    .refine((s) => !s || /^https?:\/\//.test(s), 'URL must start with http:// or https://')
    .refine((s) => !s || s.length <= 1000, 'URL is too long'),
});

type CreateTaskState = ActionState & { taskId?: string };
const INITIAL_CREATE_STATE: CreateTaskState = { ok: false, epoch: 0 };

export async function createTaskAction(
  prev: CreateTaskState | undefined,
  formData: FormData,
): Promise<CreateTaskState> {
  const epoch = bump(prev);
  // Top-level guard: without this, a throw in the pre-transaction section
  // (session / RBAC / division lookups) rejects the server action instead of
  // returning a state, so the client form shows NOTHING (no error, no close).
  // Any failure now surfaces as a visible message and is logged server-side.
  try {
    return await createTaskInner(formData, epoch);
  } catch (err) {
    logError('createTaskAction crashed', err);
    return fail('Could not create the task. Try again.', epoch);
  }
}

async function createTaskInner(
  formData: FormData,
  epoch: number,
): Promise<CreateTaskState> {
  const me = await requireSession();
  if (!me) return fail('You are signed out. Refresh and try again.', epoch);

  const parsed = createTaskSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description'),
    dueDate: formData.get('dueDate'),
    priority: formData.get('priority') ?? 'low',
    visibility: formData.get('visibility') ?? 'division',
    divisionId: formData.get('divisionId') || undefined,
    subDivisionId: formData.get('subDivisionId') || undefined,
    ownerId: formData.get('ownerId') || undefined,
    linkedTimelineFileId: formData.get('linkedTimelineFileId') || undefined,
    driveUrl: formData.get('driveUrl') || undefined,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      if (key === 'name' || key === 'dueDate' || key === 'driveUrl' || key === 'subDivisionId')
        fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors, epoch };
  }

  const meRow = await prisma.user.findUnique({
    where: { id: me.id },
    select: { id: true, divisionId: true },
  });
  if (!meRow) return fail('Your account could not be found.', epoch);

  const targetDivisionId = parsed.data.divisionId ?? meRow.divisionId;
  const actor = await getRbacActor(me.id);
  if (!actor) return fail('Your account could not be found.', epoch);

  // Division-level tasks are given by heads: only Super Admin, OSD, the
  // target division's head, or an active delegate may create a task with
  // 'division' visibility. Everyone else creates personal tasks. The same
  // predicate covers creating in another division — including spawning
  // from a Timeline File, which always produces a division-level task.
  const hasDivisionPower = canCreateDivisionTask(actor, targetDivisionId);
  if (parsed.data.visibility === 'division' && !hasDivisionPower) {
    return fail('Only the division head can create division-level tasks.', epoch);
  }
  // A non-head may only create a (personal) task in a division they are a
  // MEMBER of — home or an admin-granted extra division (actor.memberDivisionIds
  // covers both). Creating elsewhere still requires division power.
  if (!actor.memberDivisionIds.includes(targetDivisionId) && !hasDivisionPower) {
    return fail('You can only create tasks in a division you belong to.', epoch);
  }

  // By default a new division task starts unassigned: the owner is left as
  // the creator, which the pull flow (pullTaskAction) treats as "no owner
  // yet". The task is division-visible, so any member can see it and pull it
  // to take ownership. Personal tasks are simply owned by their creator.
  //
  // A head may instead name an initial owner up front (the optional owner
  // picker). It must be an active member of the target division — the same
  // pool ownership already resolves to — and only a division-task creator
  // (hasDivisionPower, required above) can set it.
  //
  // PMUs are the exception to the unassigned default: PMU-team visibility is
  // owner-scoped (a member sees tasks owned by a teammate, not a division
  // board — see buildVisibilityClausesFrom), so a PMU task must be owned by a
  // PMU member to stay visible to the team. Absent an explicit pick it keeps
  // the Structure & Hierarchy default: the PMU's team leader (falling back to
  // the creator when unset).
  let ownerId = meRow.id;
  // A sub-division tag is only meaningful on a division task and must belong
  // to the target division (a Division row of kind 'sub_division' whose
  // parent is the target). Personal tasks never carry one.
  let subDivisionId: string | null = null;
  if (parsed.data.visibility === 'division') {
    const targetDivision = await prisma.division.findUnique({
      where: { id: targetDivisionId },
      select: { kind: true, name: true },
    });
    // Office of JS tasks may be owned by any active user (same identifier as
    // getOfficeOfJsDivisionId — the seeded division name).
    const isOfficeOfJs = targetDivision?.name === 'Office of JS';

    if (parsed.data.subDivisionId) {
      const sub = await prisma.division.findUnique({
        where: { id: parsed.data.subDivisionId },
        select: { id: true, kind: true, parentId: true },
      });
      if (!sub || sub.kind !== 'sub_division' || sub.parentId !== targetDivisionId) {
        return {
          ok: false,
          fieldErrors: { subDivisionId: 'Choose a sub-division of this division.' },
          epoch,
        };
      }
      subDivisionId = sub.id;
    }

    if (parsed.data.ownerId) {
      const chosen = await prisma.user.findUnique({
        where: { id: parsed.data.ownerId },
        select: {
          id: true,
          isActive: true,
          divisionId: true,
          pmuId: true,
          divisionAccess: { select: { divisionId: true } },
        },
      });
      // The chosen owner must be a MEMBER of the target division — home or an
      // admin-granted extra membership — the same pool ownership resolves to.
      const chosenMemberDivisionIds = chosen
        ? [chosen.divisionId, ...chosen.divisionAccess.map((a) => a.divisionId)]
        : [];
      const isMember =
        !!chosen &&
        chosen.isActive &&
        (isOfficeOfJs
          ? true
          : targetDivision?.kind === 'pmu'
            ? chosen.pmuId === targetDivisionId
            : chosenMemberDivisionIds.includes(targetDivisionId));
      if (!isMember) {
        return {
          ok: false,
          fieldErrors: { ownerId: 'Choose an owner from this division.' },
          epoch,
        };
      }
      ownerId = chosen.id;
    } else if (targetDivision?.kind === 'pmu') {
      ownerId = await resolveDivisionOwner(targetDivisionId, meRow.id);
    }
  }

  try {
    const task = await prisma.$transaction(async (tx) => {
      const refNumber = await nextTaskRefNumber(
        { divisionId: targetDivisionId, linkedTimelineFileId: parsed.data.linkedTimelineFileId ?? null },
        tx,
      );
      const created = await tx.task.create({
        data: {
          refNumber,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          ownerId,
          divisionId: targetDivisionId,
          subDivisionId,
          status: 'not_started',
          priority: parsed.data.priority,
          visibility: parsed.data.visibility,
          dueDate: parsed.data.dueDate ? parseDueDateInput(parsed.data.dueDate) : null,
          linkedTimelineFileId: parsed.data.linkedTimelineFileId ?? null,
          createdById: meRow.id,
        },
      });

      if (parsed.data.linkedTimelineFileId) {
        await tx.timelineFileTaskLink.create({
          data: {
            timelineFileId: parsed.data.linkedTimelineFileId,
            taskId: created.id,
            linkedById: meRow.id,
          },
        });
        await tx.timelineFileActivity.create({
          data: {
            timelineFileId: parsed.data.linkedTimelineFileId,
            actorId: meRow.id,
            eventType: 'task_linked',
            payload: { taskId: created.id, taskName: created.name },
          },
        });
        // Linking a task is a meaningful update to the file it lands on.
        await touchTimelineFileActivity(tx, parsed.data.linkedTimelineFileId);
      }

      // The new task's lastActivityAt defaults to now() (created row), so it
      // opens at the top of "Recently modified" without an explicit stamp.
      await tx.taskActivity.create({
        data: {
          taskId: created.id,
          actorId: meRow.id,
          eventType: 'task_created',
          payload: { name: created.name, priority: created.priority },
        },
      });

      if (parsed.data.driveUrl) {
        const url = parsed.data.driveUrl;
        let fileName = 'Linked file';
        try {
          const urlObj = new URL(url);
          const pathParts = urlObj.pathname.split('/').filter(Boolean);
          if (pathParts.length > 0) {
            const last = pathParts[pathParts.length - 1];
            if (last.length > 0 && last.length < 100) fileName = decodeURIComponent(last);
          }
        } catch {
          // Keep default fileName
        }

        await tx.attachment.create({
          data: {
            ownerType: 'task',
            ownerId: created.id,
            fileName,
            fileUrl: url,
            mimeType: null,
            sizeBytes: null,
            source: 'drive_link',
            uploadedById: meRow.id,
          },
        });
      }

      return created;
    });

    // When ownership was auto-assigned to a PMU team leader other than the
    // creator, let them know they now own the task. (Regular division tasks
    // start unassigned, so ownerId === meRow.id and this does not fire.)
    if (ownerId !== meRow.id) {
      await prisma.notification.create({
        data: {
          userId: ownerId,
          type: 'task_assigned',
          payload: {
            taskId: task.id,
            taskName: task.name,
            assignedById: meRow.id,
            assignedByName: me.name ?? null,
            dueDate: task.dueDate?.toISOString() ?? null,
          },
        },
      });
    }

    if (parsed.data.linkedTimelineFileId) {
      revalidatePath(`/timeline-files/${parsed.data.linkedTimelineFileId}`);
    }
    revalidatePath('/tasks');
    return { ok: true, taskId: task.id, epoch };
  } catch (err) {
    logError('createTaskAction failed', err);
    return fail('Could not save the task. Try again.', epoch);
  }
}

// ============================================================
// updateTaskStatus — picker + optional note
// ============================================================

const updateStatusSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(STATUSES),
  note: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined)),
});

type UpdateStatusState = ActionState;
const INITIAL_STATUS_STATE: UpdateStatusState = { ok: false, epoch: 0 };

export async function updateTaskStatusAction(
  prev: UpdateStatusState | undefined,
  formData: FormData,
): Promise<UpdateStatusState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = updateStatusSchema.safeParse({
    taskId: formData.get('taskId'),
    status: formData.get('status'),
    // `.get()` yields null when the form omits the note (e.g. the one-tap
    // complete tick, which posts only taskId + status). The optional schema
    // rejects null but accepts undefined, so coalesce — a missing note must
    // not fail the whole action.
    note: formData.get('note') ?? undefined,
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
    select: { id: true, name: true, status: true, ownerId: true, createdById: true, divisionId: true, visibility: true, recurrenceRule: true },
  });
  if (!task) return fail('Task not found.', epoch);

  if (!(await canEditTask(me.id, task))) {
    return fail('Only the task owner, creator, or head of division can change status.', epoch);
  }

  const noChange = task.status === parsed.data.status;
  if (noChange && !parsed.data.note) return ok(epoch);

  try {
    await prisma.$transaction(async (tx) => {
      if (!noChange) {
        await tx.task.update({
          where: { id: task.id },
          data: { status: parsed.data.status, lastActivityAt: new Date() },
        });
        await tx.taskActivity.create({
          data: {
            taskId: task.id,
            actorId: me.id,
            eventType: 'status_changed',
            payload: { from: task.status, to: parsed.data.status },
          },
        });
      }
      if (parsed.data.note) {
        await tx.taskComment.create({
          data: {
            taskId: task.id,
            userId: me.id,
            body: parsed.data.note,
            statusTransition: noChange ? null : parsed.data.status,
            mentions: extractMentionIds(parsed.data.note),
          },
        });
        // A note posted without a status change is still a discussion update;
        // the status branch above already stamped the change case.
        if (noChange) await touchTaskActivity(tx, task.id);
      }
    });

    if (!noChange) {
      const notifs: Prisma.NotificationCreateManyInput[] = [];

      if (task.ownerId !== me.id) {
        notifs.push({
          userId: task.ownerId,
          type: 'status_changed_on_my_task',
          payload: {
            taskId: task.id,
            taskName: task.name,
            from: task.status,
            to: parsed.data.status,
            actorId: me.id,
            actorName: me.name ?? null,
          },
        });
      }

      const divLeads = await prisma.taskCollaborator.findMany({
        where: { taskId: task.id, role: 'division_lead' },
        select: { userId: true },
      });
      for (const dl of divLeads) {
        if (dl.userId !== me.id) {
          notifs.push({
            userId: dl.userId,
            type: 'cross_division_status_change',
            payload: {
              taskId: task.id,
              taskName: task.name,
              from: task.status,
              to: parsed.data.status,
              actorId: me.id,
              actorName: me.name ?? null,
            },
          });
        }
      }

      if (notifs.length > 0) {
        await prisma.notification.createMany({ data: notifs });
      }
    }

    if (parsed.data.status === 'completed' && task.recurrenceRule) {
      await spawnRecurringTask(task.id, me.id);
    }
  } catch (err) {
    logError('updateTaskStatusAction failed', err);
    return fail('Could not change status.', epoch);
  }

  revalidateTask(task.id);
  return ok(epoch);
}

// ============================================================
// updateTaskPriority
// ============================================================

const updatePrioritySchema = z.object({
  taskId: z.string().uuid(),
  priority: z.enum(PRIORITY),
});

type UpdatePriorityState = ActionState;
const INITIAL_PRIORITY_STATE: UpdatePriorityState = { ok: false, epoch: 0 };

export async function updateTaskPriorityAction(
  prev: UpdatePriorityState | undefined,
  formData: FormData,
): Promise<UpdatePriorityState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = updatePrioritySchema.safeParse({
    taskId: formData.get('taskId'),
    priority: formData.get('priority'),
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const task = await prisma.task.findUnique({ where: { id: parsed.data.taskId } });
  if (!task) return fail('Task not found.', epoch);

  if (!(await canEditTask(me.id, task))) {
    return fail('Only the task owner, creator, or head of division can change priority.', epoch);
  }

  if (task.priority === parsed.data.priority) return ok(epoch);

  try {
    await prisma.$transaction([
      prisma.task.update({
        where: { id: task.id },
        data: { priority: parsed.data.priority, lastActivityAt: new Date() },
      }),
      prisma.taskActivity.create({
        data: {
          taskId: task.id,
          actorId: me.id,
          eventType: 'priority_changed',
          payload: { from: task.priority, to: parsed.data.priority },
        },
      }),
    ]);
  } catch (err) {
    logError('updateTaskPriorityAction failed', err);
    return fail('Could not change priority.', epoch);
  }

  revalidateTask(task.id);
  return ok(epoch);
}

// ============================================================
// updateTaskFields — generic editor for description, due date, visibility, recurrence
// ============================================================

const updateFieldsSchema = z.object({
  taskId: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(1, 'Task name is required')
    .max(200, 'Task name is too long')
    .optional(),
  description: z
    .string()
    .max(5000)
    .optional()
    .transform((s) => (typeof s === 'string' ? s : undefined)),
  // Distinguishes "field absent" (undefined — leave the due date alone,
  // e.g. when saving an unrelated field like the title) from "field
  // present but empty" (null — an explicit clear via the Due row's Clear
  // button). A naive `s ? s : null` collapses both to null and silently
  // wipes the due date on every edit that doesn't touch it.
  dueDate: z
    .string()
    .optional()
    .transform((s) => (s === undefined ? undefined : s.length > 0 ? s : null))
    .refine(
      (s) => s === undefined || s === null || !Number.isNaN(Date.parse(s)),
      'Due date is invalid',
    ),
  visibility: z.enum(VISIBILITY).optional(),
  recurrenceRule: z
    .union([
      z.literal(''),
      z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'half_yearly']),
    ])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === '' ? null : v)),
  divisionId: z.string().uuid().optional(),
  // Empty string is an explicit clear (null — "no sub-division"); absent is
  // "leave alone" (undefined), the same distinction the recurrence field draws.
  subDivisionId: z
    .union([z.literal(''), z.string().uuid()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === '' ? null : v)),
});

type UpdateFieldsState = ActionState;
const INITIAL_FIELDS_STATE: UpdateFieldsState = { ok: false, epoch: 0 };

export async function updateTaskFieldsAction(
  prev: UpdateFieldsState | undefined,
  formData: FormData,
): Promise<UpdateFieldsState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = updateFieldsSchema.safeParse({
    taskId: formData.get('taskId'),
    name: formData.has('name') ? (formData.get('name') as string) : undefined,
    description: formData.has('description') ? (formData.get('description') as string) : undefined,
    dueDate: formData.has('dueDate') ? (formData.get('dueDate') as string) : undefined,
    visibility: formData.has('visibility')
      ? (formData.get('visibility') as string)
      : undefined,
    recurrenceRule: formData.has('recurrenceRule')
      ? (formData.get('recurrenceRule') as string)
      : undefined,
    divisionId: formData.has('divisionId') ? (formData.get('divisionId') as string) : undefined,
    subDivisionId: formData.has('subDivisionId')
      ? (formData.get('subDivisionId') as string)
      : undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0])] = issue.message;
    }
    return { ok: false, fieldErrors, epoch };
  }

  const task = await prisma.task.findUnique({ where: { id: parsed.data.taskId } });
  if (!task) return fail('Task not found.', epoch);

  const baseEditor = await canEditTask(me.id, task);
  // A collaborator who is not otherwise an editor may contribute the task's
  // context (description) — but nothing else. Any attempt to touch another
  // field on the same submission is rejected below.
  const collaboratorOnly = !baseEditor && (await isTaskCollaborator(me.id, task.id));
  if (!baseEditor && !collaboratorOnly) {
    return fail('Only the task owner, creator, a collaborator, or a head of division can edit this task.', epoch);
  }
  if (collaboratorOnly) {
    const editsBeyondDescription =
      parsed.data.name !== undefined ||
      parsed.data.dueDate !== undefined ||
      parsed.data.visibility !== undefined ||
      parsed.data.recurrenceRule !== undefined ||
      parsed.data.divisionId !== undefined ||
      parsed.data.subDivisionId !== undefined;
    if (editsBeyondDescription) {
      return fail('Collaborators can edit only the task context.', epoch);
    }
  }

  // Name, due date, and recurrence redefine the task, so they need the
  // stricter gate — a normal owner (e.g. after a transfer) may still change
  // status/subtasks/description, but not these. Each editor posts only its
  // own field, so presence is a reliable signal.
  const editsDefinition =
    parsed.data.name !== undefined ||
    parsed.data.dueDate !== undefined ||
    parsed.data.recurrenceRule !== undefined ||
    parsed.data.subDivisionId !== undefined;
  if (editsDefinition && !(await canEditTaskDetails(me.id, task))) {
    return fail(
      'Only a division head, OSD, JS, or Super Admin can change the name, due date, recurrence, or sub-division.',
      epoch,
    );
  }

  const data: Record<string, unknown> = {};
  const events: { eventType: string; payload: Record<string, unknown> }[] = [];
  // Set when a division/PMU change auto-reassigns ownership, so the new
  // owner can be notified after the write commits.
  let reassignedOwnerId: string | null = null;

  if (parsed.data.name !== undefined && parsed.data.name !== task.name) {
    data.name = parsed.data.name;
    events.push({
      eventType: 'task_renamed',
      payload: { from: task.name, to: parsed.data.name },
    });
  }
  if (parsed.data.description !== undefined && parsed.data.description !== (task.description ?? '')) {
    data.description = parsed.data.description.length > 0 ? parsed.data.description : null;
    events.push({ eventType: 'description_updated', payload: {} });
  }
  if (parsed.data.dueDate !== undefined) {
    const next = parsed.data.dueDate ? parseDueDateInput(parsed.data.dueDate) : null;
    // Compare full timestamps so a time-of-day change also registers; the
    // activity payload stays date-only for legible rendering.
    if ((task.dueDate?.getTime() ?? null) !== (next?.getTime() ?? null)) {
      data.dueDate = next;
      events.push({
        eventType: 'due_date_changed',
        payload: {
          from: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
          to: next ? next.toISOString().slice(0, 10) : null,
        },
      });
    }
  }
  if (parsed.data.visibility !== undefined && parsed.data.visibility !== task.visibility) {
    // Visibility is a head power in both directions — the same rule as
    // creating a division-level task. Owners/creators who can edit other
    // fields may neither promote a task onto the division board nor hide
    // a division task from it.
    const actor = await getRbacActor(me.id);
    if (!actor || !canCreateDivisionTask(actor, task.divisionId)) {
      return fail('Only the division head can change task visibility.', epoch);
    }
    data.visibility = parsed.data.visibility;
    events.push({
      eventType: 'visibility_changed',
      payload: { from: task.visibility, to: parsed.data.visibility },
    });
  }
  if (
    parsed.data.recurrenceRule !== undefined &&
    parsed.data.recurrenceRule !== task.recurrenceRule
  ) {
    data.recurrenceRule = parsed.data.recurrenceRule;
    events.push({
      eventType: 'recurrence_changed',
      payload: { from: task.recurrenceRule, to: parsed.data.recurrenceRule },
    });
  }
  if (
    parsed.data.subDivisionId !== undefined &&
    parsed.data.subDivisionId !== task.subDivisionId
  ) {
    // A sub-division must belong to the task's current division. Changing the
    // division is a separate action that clears the sub-division below, so
    // here we validate against task.divisionId. null clears the tag.
    let toName: string | null = null;
    if (parsed.data.subDivisionId !== null) {
      const sub = await prisma.division.findUnique({
        where: { id: parsed.data.subDivisionId },
        select: { id: true, name: true, kind: true, parentId: true },
      });
      if (!sub || sub.kind !== 'sub_division' || sub.parentId !== task.divisionId) {
        return fail('Choose a sub-division of this division.', epoch, {
          subDivisionId: 'Choose a sub-division of this division.',
        });
      }
      toName = sub.name;
    }
    const fromName = task.subDivisionId
      ? (
          await prisma.division.findUnique({
            where: { id: task.subDivisionId },
            select: { name: true },
          })
        )?.name ?? null
      : null;
    data.subDivisionId = parsed.data.subDivisionId;
    events.push({
      eventType: 'subdivision_changed',
      payload: { from: fromName, to: toName },
    });
  }
  if (parsed.data.divisionId !== undefined && parsed.data.divisionId !== task.divisionId) {
    const meRow = await prisma.user.findUnique({
      where: { id: me.id },
      select: { isSuperAdmin: true, hierarchySlot: true },
    });
    if (!meRow?.isSuperAdmin && meRow?.hierarchySlot !== 'osd') {
      return fail('Only OSD or Super Admin can change the division.', epoch);
    }
    data.divisionId = parsed.data.divisionId;
    // The current sub-division belongs to the old division's subtree, so it
    // no longer applies — clear it as part of the move.
    if (task.subDivisionId) data.subDivisionId = null;
    // A PMU-team share is scoped to the old PMU; drop it on any move so it
    // can't linger against a division that isn't that PMU.
    if (task.sharedWithPmuTeam) data.sharedWithPmuTeam = false;
    const oldDiv = await prisma.division.findUnique({ where: { id: task.divisionId }, select: { name: true } });
    const newDiv = await prisma.division.findUnique({ where: { id: parsed.data.divisionId }, select: { name: true } });
    events.push({
      eventType: 'division_changed',
      payload: { from: oldDiv?.name ?? task.divisionId, to: newDiv?.name ?? parsed.data.divisionId },
    });

    // Ownership follows the new division/PMU per Structure & Hierarchy: the
    // new division's head, or the PMU's team leader (falling back to the
    // creator when unset). Reassign, log it, and notify the new owner.
    const nextOwnerId = await resolveDivisionOwner(parsed.data.divisionId, task.createdById);
    if (nextOwnerId !== task.ownerId) {
      const nextOwner = await prisma.user.findUnique({
        where: { id: nextOwnerId },
        select: { name: true },
      });
      data.ownerId = nextOwnerId;
      events.push({
        eventType: 'owner_changed',
        payload: { from: task.ownerId, to: nextOwnerId, toName: nextOwner?.name ?? null },
      });
      reassignedOwnerId = nextOwnerId;
    }
  }

  if (Object.keys(data).length === 0) return ok(epoch);

  // A real field change landed above — mark it as recent activity.
  data.lastActivityAt = new Date();

  try {
    await prisma.$transaction([
      prisma.task.update({ where: { id: task.id }, data }),
      ...events.map((e) =>
        prisma.taskActivity.create({
          data: { taskId: task.id, actorId: me.id, eventType: e.eventType, payload: e.payload as object },
        }),
      ),
    ]);
  } catch (err) {
    logError('updateTaskFieldsAction failed', err);
    return fail('Could not save changes.', epoch);
  }

  // Notify the head / team leader who now owns the task after a division
  // or PMU change (self-excluded).
  if (reassignedOwnerId && reassignedOwnerId !== me.id) {
    await prisma.notification.create({
      data: {
        userId: reassignedOwnerId,
        type: 'task_assigned',
        payload: {
          taskId: task.id,
          taskName: task.name,
          assignedById: me.id,
          assignedByName: me.name ?? null,
          dueDate: task.dueDate?.toISOString() ?? null,
        },
      },
    });
  }

  revalidateTask(task.id);
  return ok(epoch);
}

// ============================================================
// Subtasks — add + toggle
// ============================================================

const addSubtaskSchema = z.object({
  parentTaskId: z.string().uuid(),
  name: z.string().trim().min(1, 'Subtask name is required').max(200),
  assigneeId: z.string().uuid().optional(),
  dueDate: z
    .string()
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined))
    .refine((s) => !s || !Number.isNaN(Date.parse(s)), 'Due date is invalid'),
});

export async function addSubtaskAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = addSubtaskSchema.safeParse({
    parentTaskId: formData.get('parentTaskId'),
    name: formData.get('name'),
    assigneeId: formData.get('assigneeId') || undefined,
    dueDate: formData.get('dueDate'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  const parent = await prisma.task.findUnique({
    where: { id: parsed.data.parentTaskId },
    select: {
      id: true,
      parentTaskId: true,
      divisionId: true,
      subDivisionId: true,
      visibility: true,
      ownerId: true,
      createdById: true,
      dueDate: true,
      division: { select: { kind: true, headUserId: true } },
    },
  });
  if (!parent) return fail('Parent task not found.', epoch);

  // Subtasks are a single level deep: a subtask cannot itself have subtasks.
  // Enforced here (not just hidden in the UI) so the invariant the numbering
  // scheme relies on holds for every code path. (Mirrors the pull guard.)
  if (parent.parentTaskId) {
    return fail('Subtasks cannot have their own subtasks.', epoch);
  }

  // A subtask inherits the parent's visibility, so adding one to a
  // division task creates another division-level task. Creating subtasks is
  // a contribute right: the owner, creator, or a head/OSD/Super Admin of the
  // parent's division, plus any explicit collaborator on the task (they are
  // meant to help break the work down). A plain division member who merely
  // *sees* the task still cannot add subtasks.
  if (!(await canEditTask(me.id, parent)) && !(await isTaskCollaborator(me.id, parent.id))) {
    return fail('Only the task owner, creator, a collaborator, or a head of division can add subtasks.', epoch);
  }

  if (parsed.data.dueDate && parent.dueDate) {
    const subtaskDue = new Date(parsed.data.dueDate);
    const parentEndOfDay = new Date(parent.dueDate);
    parentEndOfDay.setHours(23, 59, 59, 999);
    if (subtaskDue > parentEndOfDay) {
      return { ok: false, fieldErrors: { dueDate: 'Subtask deadline cannot exceed the parent task deadline' }, epoch };
    }
  }

  const assigneeId = parsed.data.assigneeId ?? me.id;

  if (assigneeId !== me.id) {
    const assignee = await prisma.user.findUnique({
      where: { id: assigneeId },
      select: { id: true, isActive: true },
    });
    if (!assignee || !assignee.isActive) {
      return fail('Assignee not found or inactive.', epoch);
    }
    // Subtask assignees come from the task's participants — the division's
    // members (home or admin-granted extra membership), its head, and oversight
    // roles — all resolved by isTaskParticipant.
    if (!(await isTaskParticipant(assigneeId, parent))) {
      return fail('Subtask assignee is not eligible for this task.', epoch);
    }
  }

  let newSubtaskId = '';
  try {
    const subtask = await prisma.$transaction(async (tx) => {
      // Subtasks are numbered relative to their parent: <parent ref>-NN,
      // e.g. OJS-28 -> OJS-28-01. They do not consume the division / TL sequence.
      const refNumber = await nextSubtaskRefNumber(parent.id, tx);
      return tx.task.create({
        data: {
          refNumber,
          name: parsed.data.name,
          ownerId: assigneeId,
          divisionId: parent.divisionId,
          subDivisionId: parent.subDivisionId,
          status: 'not_started',
          priority: 'low',
          visibility: parent.visibility,
          dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
          parentTaskId: parent.id,
          createdById: me.id,
        },
      });
    });
    newSubtaskId = subtask.id;
    await prisma.taskActivity.create({
      data: {
        taskId: parent.id,
        actorId: me.id,
        eventType: 'subtask_added',
        payload: { name: subtask.name, subtaskId: subtask.id, assigneeId: assigneeId !== me.id ? assigneeId : undefined },
      },
    });
    // Adding a subtask is a meaningful update to the parent task.
    await touchTaskActivity(prisma, parent.id);
    if (assigneeId !== me.id) {
      await prisma.notification.create({
        data: {
          userId: assigneeId,
          type: 'task_assigned',
          payload: {
            taskId: subtask.id,
            taskName: subtask.name,
            parentTaskId: parent.id,
            assignedById: me.id,
            assignedByName: me.name ?? null,
            dueDate: subtask.dueDate?.toISOString() ?? null,
          },
        },
      });
    }
  } catch (err) {
    logError('addSubtaskAction failed', err);
    return fail('Could not add subtask.', epoch);
  }

  revalidateTask(parent.id);
  // Return the new subtask id so the client can attach a document to it.
  return { ok: true, epoch, subtaskId: newSubtaskId };
}

const toggleSubtaskSchema = z.object({ subtaskId: z.string().uuid() });

export async function toggleSubtaskAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = toggleSubtaskSchema.safeParse({ subtaskId: formData.get('subtaskId') });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const subtask = await prisma.task.findUnique({
    where: { id: parsed.data.subtaskId },
    select: { id: true, status: true, parentTaskId: true, name: true },
  });
  if (!subtask) return fail('Subtask not found.', epoch);

  if (subtask.parentTaskId) {
    const parent = await prisma.task.findUnique({
      where: { id: subtask.parentTaskId },
      select: { id: true, ownerId: true, createdById: true, divisionId: true, visibility: true },
    });
    if (!parent || !(await canEditTask(me.id, parent))) {
      return fail('You do not have permission to modify this task.', epoch);
    }
  }

  const nextStatus = subtask.status === 'completed' ? 'not_started' : 'completed';
  const eventType = nextStatus === 'completed' ? 'subtask_completed' : 'subtask_reopened';

  try {
    await prisma.$transaction([
      prisma.task.update({ where: { id: subtask.id }, data: { status: nextStatus } }),
      ...(subtask.parentTaskId
        ? [
            prisma.taskActivity.create({
              data: {
                taskId: subtask.parentTaskId,
                actorId: me.id,
                eventType,
                payload: { subtaskId: subtask.id, name: subtask.name },
              },
            }),
            // Completing/reopening a subtask advances the parent's progress.
            touchTaskActivity(prisma, subtask.parentTaskId),
          ]
        : []),
    ]);
  } catch (err) {
    logError('toggleSubtaskAction failed', err);
    return fail('Could not toggle subtask.', epoch);
  }

  if (subtask.parentTaskId) revalidateTask(subtask.parentTaskId);
  revalidatePath('/tasks');
  return ok(epoch);
}

// ============================================================
// updateSubtask — reassign + deadline
// ============================================================

const updateSubtaskSchema = z.object({
  subtaskId: z.string().uuid(),
  assigneeId: z.string().uuid().optional(),
  dueDate: z
    .string()
    .optional()
    .transform((s) => (s && s.length > 0 ? s : undefined))
    .refine((s) => !s || !Number.isNaN(Date.parse(s)), 'Due date is invalid'),
});

export async function updateSubtaskAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = updateSubtaskSchema.safeParse({
    subtaskId: formData.get('subtaskId'),
    assigneeId: formData.get('assigneeId') || undefined,
    dueDate: formData.get('dueDate') || undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  const subtask = await prisma.task.findUnique({
    where: { id: parsed.data.subtaskId },
    select: { id: true, parentTaskId: true, ownerId: true, name: true, dueDate: true },
  });
  if (!subtask || !subtask.parentTaskId) return fail('Subtask not found.', epoch);

  const parent = await prisma.task.findUnique({
    where: { id: subtask.parentTaskId },
    select: {
      id: true,
      ownerId: true,
      createdById: true,
      divisionId: true,
      visibility: true,
      dueDate: true,
      division: { select: { kind: true, headUserId: true } },
    },
  });
  if (!parent) return fail('Parent task not found.', epoch);

  const allowed = await canEditTask(me.id, parent);
  if (!allowed) return fail('You do not have permission to edit this subtask.', epoch);

  if (parsed.data.dueDate && parent.dueDate) {
    const subtaskDue = new Date(parsed.data.dueDate);
    const parentEndOfDay = new Date(parent.dueDate);
    parentEndOfDay.setHours(23, 59, 59, 999);
    if (subtaskDue > parentEndOfDay) {
      return { ok: false, fieldErrors: { dueDate: 'Subtask deadline cannot exceed the parent task deadline' }, epoch };
    }
  }

  const updates: Record<string, unknown> = {};
  const activityChanges: string[] = [];
  // Extra activity detail for a reassignment — who it moved from and to —
  // so the log plainly records the hand-off, not just "reassigned".
  let reassignDetail: {
    fromId?: string;
    fromName?: string | null;
    toId?: string;
    toName?: string | null;
  } = {};

  if (parsed.data.assigneeId && parsed.data.assigneeId !== subtask.ownerId) {
    if (!(await isTaskParticipant(parsed.data.assigneeId, parent))) {
      return fail('Subtask assignee is not eligible for this task.', epoch);
    }
    updates.ownerId = parsed.data.assigneeId;
    activityChanges.push('reassigned');
    const [fromUser, toUser] = await Promise.all([
      prisma.user.findUnique({ where: { id: subtask.ownerId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: parsed.data.assigneeId }, select: { name: true } }),
    ]);
    reassignDetail = {
      fromId: subtask.ownerId,
      fromName: fromUser?.name ?? null,
      toId: parsed.data.assigneeId,
      toName: toUser?.name ?? null,
    };
  }
  if (parsed.data.dueDate !== undefined) {
    updates.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
    activityChanges.push('deadline updated');
  }

  if (Object.keys(updates).length === 0) return ok(epoch);

  try {
    await prisma.$transaction([
      prisma.task.update({ where: { id: subtask.id }, data: updates }),
      prisma.taskActivity.create({
        data: {
          taskId: parent.id,
          actorId: me.id,
          eventType: 'subtask_updated',
          payload: {
            subtaskId: subtask.id,
            name: subtask.name,
            changes: activityChanges,
            ...reassignDetail,
          },
        },
      }),
      // Reassigning/rescheduling a subtask is a meaningful parent update.
      touchTaskActivity(prisma, parent.id),
    ]);

    if (parsed.data.assigneeId && parsed.data.assigneeId !== subtask.ownerId && parsed.data.assigneeId !== me.id) {
      // Effective due date after this update — the payload snapshot must
      // reflect what the assignee will actually see on the subtask.
      const nextDueDate =
        parsed.data.dueDate !== undefined
          ? parsed.data.dueDate
            ? new Date(parsed.data.dueDate)
            : null
          : subtask.dueDate;
      await prisma.notification.create({
        data: {
          userId: parsed.data.assigneeId,
          type: 'task_assigned',
          payload: {
            taskId: subtask.id,
            taskName: subtask.name,
            parentTaskId: parent.id,
            assignedById: me.id,
            assignedByName: me.name ?? null,
            dueDate: nextDueDate?.toISOString() ?? null,
          },
        },
      });
    }
  } catch (err) {
    logError('updateSubtaskAction failed', err);
    return fail('Could not update subtask.', epoch);
  }

  revalidateTask(parent.id);
  return ok(epoch);
}

// ============================================================
// postComment — plus optional status transition
// ============================================================

const postCommentSchema = z.object({
  taskId: z.string().uuid(),
  body: z.string().trim().min(1, 'Comment cannot be empty').max(4000),
  parentCommentId: z.string().uuid().optional(),
});

/**
 * Naive @-mention extraction. Phase 1 keeps it simple: anywhere a
 * `@username` pattern appears in the body, look up the matching user.
 * The mention picker UI (with type-ahead) lands when there are multiple
 * users to pick from.
 */
function extractMentionIds(_body: string): string[] {
  // Phase 1: no synchronous DB lookup here; we'd need to await.
  // Real mention resolution happens in the calling action where we can await.
  return [];
}

async function resolveMentions(body: string, taskId: string): Promise<string[]> {
  const handles = Array.from(body.matchAll(/@([a-z0-9][a-z0-9._-]{1,40})/gi)).map(
    (m) => m[1].toLowerCase(),
  );
  if (handles.length === 0) return [];
  // A mention only resolves (and grants access + notifies) if the target may
  // take part in this task — same rule as the collaborator / assignee pickers,
  // so you cannot pull in someone outside the task's division by @-name.
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { divisionId: true, division: { select: { kind: true, headUserId: true } } },
  });
  if (!task) return [];
  const participantWhere = await buildTaskParticipantWhere(task);
  const users = await prisma.user.findMany({
    where: { AND: [{ username: { in: handles } }, participantWhere] },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function postCommentAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const rawParent = formData.get('parentCommentId');
  const parsed = postCommentSchema.safeParse({
    taskId: formData.get('taskId'),
    body: formData.get('body'),
    parentCommentId: rawParent && rawParent !== '' ? String(rawParent) : undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      collaborators: { select: { userId: true } },
    },
  });
  if (!task) return fail('Task not found.', epoch);

  if (!(await canViewTask(me.id, task.id))) {
    return fail('Task not found.', epoch);
  }

  const mentions = await resolveMentions(parsed.data.body, task.id);

  try {
    const comment = await prisma.taskComment.create({
      data: {
        taskId: task.id,
        userId: me.id,
        body: parsed.data.body,
        mentions,
        parentCommentId: parsed.data.parentCommentId ?? null,
      },
    });
    // A comment is a discussion update — surface the task in "Recently modified".
    await touchTaskActivity(prisma, task.id);

    const mentionNotifs = mentions
      .filter((uid) => uid !== me.id)
      .map((uid) => ({
        userId: uid,
        type: 'mention' as const,
        payload: {
          taskId: task.id,
          taskName: task.name,
          commentId: comment.id,
          actorId: me.id,
          actorName: me.name ?? null,
        },
      }));
    if (mentionNotifs.length > 0) {
      await prisma.notification.createMany({ data: mentionNotifs });
    }

    // A plain comment (no @mention) still notifies whoever owns or collaborates
    // on the task — minus the author and anyone already pinged via a mention
    // above, so no one receives a duplicate for the same comment.
    const mentioned = new Set(mentions);
    const commentRecipients = new Set<string>([
      task.ownerId,
      ...task.collaborators.map((c) => c.userId),
    ]);
    commentRecipients.delete(me.id);
    for (const uid of mentioned) commentRecipients.delete(uid);
    if (commentRecipients.size > 0) {
      await prisma.notification.createMany({
        data: [...commentRecipients].map((uid) => ({
          userId: uid,
          type: 'comment_on_my_task' as const,
          payload: {
            taskId: task.id,
            taskName: task.name,
            commentId: comment.id,
            actorId: me.id,
            actorName: me.name ?? null,
          },
        })),
      });
    }
  } catch (err) {
    logError('postCommentAction failed', err);
    return fail('Could not post comment.', epoch);
  }

  revalidateTask(task.id);
  return ok(epoch);
}

// ============================================================
// editComment + deleteComment — 5-minute window, own comments only
// ============================================================

const COMMENT_EDIT_WINDOW_MS = 5 * 60 * 1000;

const editCommentSchema = z.object({
  commentId: z.string().uuid(),
  body: z.string().trim().min(1, 'Comment cannot be empty').max(4000),
});

export async function editCommentAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = editCommentSchema.safeParse({
    commentId: formData.get('commentId'),
    body: formData.get('body'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  const comment = await prisma.taskComment.findUnique({
    where: { id: parsed.data.commentId },
    select: { id: true, userId: true, taskId: true, createdAt: true },
  });
  if (!comment) return fail('Comment not found.', epoch);
  if (comment.userId !== me.id) return fail('You can only edit your own comments.', epoch);

  const elapsed = Date.now() - comment.createdAt.getTime();
  if (elapsed > COMMENT_EDIT_WINDOW_MS) {
    return fail('Comments can only be edited within 5 minutes of posting.', epoch);
  }

  const mentions = await resolveMentions(parsed.data.body, comment.taskId);

  try {
    await prisma.taskComment.update({
      where: { id: comment.id },
      data: {
        body: parsed.data.body,
        mentions,
        editedAt: new Date(),
      },
    });
  } catch (err) {
    logError('editCommentAction failed', err);
    return fail('Could not edit comment.', epoch);
  }

  revalidateTask(comment.taskId);
  return ok(epoch);
}

const deleteCommentSchema = z.object({
  commentId: z.string().uuid(),
});

export async function deleteCommentAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = deleteCommentSchema.safeParse({
    commentId: formData.get('commentId'),
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const comment = await prisma.taskComment.findUnique({
    where: { id: parsed.data.commentId },
    select: { id: true, userId: true, taskId: true, createdAt: true },
  });
  if (!comment) return fail('Comment not found.', epoch);
  if (comment.userId !== me.id) return fail('You can only delete your own comments.', epoch);

  const elapsed = Date.now() - comment.createdAt.getTime();
  if (elapsed > COMMENT_EDIT_WINDOW_MS) {
    return fail('Comments can only be deleted within 5 minutes of posting.', epoch);
  }

  try {
    await prisma.taskComment.delete({ where: { id: comment.id } });
  } catch (err) {
    logError('deleteCommentAction failed', err);
    return fail('Could not delete comment.', epoch);
  }

  revalidateTask(comment.taskId);
  return ok(epoch);
}

// ============================================================
// deleteTask
// ============================================================

const taskIdSchema = z.object({ taskId: z.string().uuid() });

/**
 * Hard-delete a task (and its subtasks, attachments, and cascading
 * children). Allowed for the owner or creator, a Super Admin (any task),
 * or the head of the task's division — see the permission check below.
 */
export async function deleteTaskAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = taskIdSchema.safeParse({ taskId: formData.get('taskId') });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
    select: {
      id: true,
      name: true,
      createdById: true,
      ownerId: true,
      divisionId: true,
      visibility: true,
      parentTaskId: true,
    },
  });
  if (!task) return fail('Task not found.', epoch);

  const actor = await getRbacActor(me.id);
  let allowed: boolean;
  if (task.parentTaskId) {
    // Subtask deletion is a lifecycle action reserved for the parent task's
    // owner, the head of the task's division, or a Super Admin — never the
    // subtask's own assignee, who was merely allotted the work. (No personal
    // self-delete path either: a subtask's owner does not own its lifecycle.)
    // A PMU Team Head may also delete subtasks of their team's OWN division
    // tasks — but not of a task allotted by an elevated role (see below).
    const parent = await prisma.task.findUnique({
      where: { id: task.parentTaskId },
      select: { ownerId: true, createdById: true, divisionId: true, visibility: true },
    });
    allowed =
      (parent !== null && parent.ownerId === me.id) ||
      (actor !== null && canActAsHeadOf(actor, task.divisionId));
    if (!allowed && parent && (await canPmuHeadDeleteOwnedTask(me.id, parent))) {
      // The PMU head may delete this subtask — unless it carries a document
      // uploaded by an elevated role, which the delete would cascade away.
      if (await taskIdsHaveElevatedUpload([task.id], task.divisionId)) {
        return fail(
          'This subtask has a document from a division head, Super Admin, or OSD — only they can delete it.',
          epoch,
        );
      }
      allowed = true;
    }
    if (!allowed) {
      return fail(
        'Only the parent task owner, a division head, a Super Admin, or the PMU team head can delete this subtask.',
        epoch,
      );
    }
  } else {
    // Delete rights: a Super Admin (any task) or the head of the task's
    // division (canActAsHeadOf covers both, plus active delegates), and a
    // user for their own personal task. A normal user who merely owns a
    // division task — e.g. after a transfer — can no longer delete it.
    allowed =
      (task.visibility === 'personal' && task.ownerId === me.id) ||
      (actor !== null && canActAsHeadOf(actor, task.divisionId));
    // A PMU Team Head may delete their PMU team's OWN division tasks — but
    // never a task allotted (created) by a Division Head / Super Admin / OSD,
    // which stays under those elevated roles' control.
    if (!allowed && (await canPmuHeadDeleteOwnedTask(me.id, task))) {
      // Refuse if the task (or a subtask) carries a document uploaded by an
      // elevated role — deleting the task tree would cascade it away.
      const subIds = (
        await prisma.task.findMany({
          where: { parentTaskId: task.id },
          select: { id: true },
        })
      ).map((s) => s.id);
      if (await taskIdsHaveElevatedUpload([task.id, ...subIds], task.divisionId)) {
        return fail(
          'This task has a document from a division head, Super Admin, or OSD — only they can delete it.',
          epoch,
        );
      }
      allowed = true;
    }
    if (!allowed) {
      return fail(
        'Only a division head, a Super Admin, or the PMU team head can delete this task.',
        epoch,
      );
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const subtaskIds = (
        await tx.task.findMany({
          where: { parentTaskId: task.id },
          select: { id: true },
        })
      ).map((s) => s.id);

      if (subtaskIds.length > 0) {
        await tx.attachment.deleteMany({
          where: { ownerType: 'task', ownerId: { in: subtaskIds } },
        });
        await tx.task.deleteMany({ where: { parentTaskId: task.id } });
      }

      await tx.attachment.deleteMany({
        where: { ownerType: 'task', ownerId: task.id },
      });
      await tx.task.delete({ where: { id: task.id } });
      await tx.auditLog.create({
        data: {
          actorId: me.id,
          action: 'delete',
          entityType: 'task',
          entityId: task.id,
          before: { name: task.name },
          after: {},
        },
      });
    });
  } catch (err) {
    logError('deleteTaskAction failed', err);
    return fail('Could not delete.', epoch);
  }

  revalidatePath('/tasks');
  return ok(epoch);
}

// ============================================================
// setJsPriorityLane — Phase 2 (OSD-only curation)
// ============================================================

const setJsLaneSchema = z.object({
  taskId: z.string().uuid(),
  lane: z
    .union([
      z.literal('today'),
      z.literal('week'),
      z.literal('month'),
      z.literal('watchlist'),
      z.literal(''),
    ])
    .transform((v) => (v === '' ? null : v)),
});

/**
 * Set / unset a task's JS Priority lane.
 *
 * Permitted: OSD or Super Admin only (per PRD §5.3 "Drag-and-drop … OSD only").
 * Records a `js_priority_changed` activity event + (Phase 2) notifications
 * to the task owner, their Director, and Section Officer.
 */
export async function setJsPriorityLaneAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  // Authorisation: OSD or Super Admin.
  const meRow = await prisma.user.findUnique({
    where: { id: me.id },
    select: { hierarchySlot: true, isSuperAdmin: true },
  });
  if (!meRow) return fail('Account not found.', epoch);
  if (!(meRow.isSuperAdmin || meRow.hierarchySlot === 'osd')) {
    return fail('Only OSD can change JS Priority.', epoch);
  }

  const parsed = setJsLaneSchema.safeParse({
    taskId: formData.get('taskId'),
    lane: formData.get('lane') ?? '',
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
    select: {
      id: true,
      name: true,
      jsPriorityLane: true,
      ownerId: true,
      owner: { select: { supervisorId: true, divisionId: true } },
    },
  });
  if (!task) return fail('Task not found.', epoch);
  if (task.jsPriorityLane === parsed.data.lane) return ok(epoch);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: task.id },
        data: { jsPriorityLane: parsed.data.lane, lastActivityAt: new Date() },
      });
      await tx.taskActivity.create({
        data: {
          taskId: task.id,
          actorId: me.id,
          eventType: 'js_priority_changed',
          payload: { from: task.jsPriorityLane, to: parsed.data.lane },
        },
      });

      if (parsed.data.lane) {
        const notifTargets: string[] = [];
        if (task.ownerId !== me.id) notifTargets.push(task.ownerId);

        if (task.owner.divisionId) {
          const chainOfficers = await tx.user.findMany({
            where: {
              divisionId: task.owner.divisionId,
              hierarchySlot: { in: ['director', 'section_officer'] },
              isActive: true,
              id: { notIn: [me.id, task.ownerId] },
            },
            select: { id: true },
          });
          for (const u of chainOfficers) notifTargets.push(u.id);
        }

        if (notifTargets.length > 0) {
          await tx.notification.createMany({
            data: notifTargets.map((uid) => ({
              userId: uid,
              type: 'js_priority_added',
              payload: {
                taskId: task.id,
                taskName: task.name,
                lane: parsed.data.lane,
                actorId: me.id,
                actorName: me.name ?? null,
              },
            })),
          });
        }
      }
    });
  } catch (err) {
    logError('setJsPriorityLaneAction failed', err);
    return fail('Could not update JS Priority.', epoch);
  }

  revalidatePath('/priority-board');
  revalidateTask(task.id);
  return ok(epoch);
}

// ============================================================
// reorderBoardAction — persist within-lane drag-drop order
// ============================================================

const reorderSchema = z.object({
  lane: z.enum(['today', 'week', 'month', 'watchlist']),
  taskIds: z.array(z.string().uuid()),
});

export async function reorderBoardAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  if (!me.isSuperAdmin && me.hierarchySlot !== 'osd') {
    return fail('Only OSD or Super Admin can reorder the board.', epoch);
  }

  const raw = formData.get('payload');
  if (typeof raw !== 'string') return fail('Invalid input.', epoch);

  let parsed: z.infer<typeof reorderSchema>;
  try {
    parsed = reorderSchema.parse(JSON.parse(raw));
  } catch {
    return fail('Invalid input.', epoch);
  }

  try {
    await prisma.$transaction(
      parsed.taskIds.map((id, i) =>
        prisma.task.updateMany({
          where: { id, jsPriorityLane: parsed.lane },
          data: { jsPrioritySortOrder: i },
        }),
      ),
    );
  } catch (err) {
    logError('reorderBoardAction failed', err);
    return fail('Could not save order.', epoch);
  }

  revalidatePath('/priority-board');
  return ok(epoch);
}

// ============================================================
// addCollaborator / removeCollaborator — Phase 2 cross-division
// ============================================================

const COLLABORATOR_ROLES = ['collaborator', 'division_lead', 'co_owner'] as const;

const addCollaboratorSchema = z.object({
  taskId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(COLLABORATOR_ROLES).default('collaborator'),
});

export async function addCollaboratorAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = addCollaboratorSchema.safeParse({
    taskId: formData.get('taskId'),
    userId: formData.get('userId'),
    role: formData.get('role') ?? 'collaborator',
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, fieldErrors, epoch };
  }

  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      createdById: true,
      divisionId: true,
      visibility: true,
      archivedAt: true,
      dueDate: true,
      division: { select: { kind: true, headUserId: true } },
    },
  });
  if (!task || task.archivedAt) return fail('Task not found.', epoch);

  if (!(await canEditTask(me.id, task))) {
    return fail('You do not have permission to edit this task.', epoch);
  }

  if (parsed.data.userId === task.ownerId) {
    return fail('The task owner is already on the task.', epoch);
  }

  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, name: true, isActive: true },
  });
  if (!target || !target.isActive) return fail('User not found or disabled.', epoch);

  // Collaborators are drawn from the task's participants (its division plus its
  // head, the oversight roles, and any cross-linked division) — the same rule as
  // the picker, enforced server-side.
  if (!(await isTaskParticipant(target.id, task))) {
    return fail('Collaborator is not eligible for this task.', epoch);
  }

  // Co-owner cap: max 3 per task.
  if (parsed.data.role === 'co_owner') {
    const coOwnerCount = await prisma.taskCollaborator.count({
      where: { taskId: task.id, role: 'co_owner' },
    });
    if (coOwnerCount >= 3) {
      return fail('A task can have at most 3 co-owners.', epoch);
    }
  }

  try {
    await prisma.taskCollaborator.create({
      data: {
        taskId: task.id,
        userId: parsed.data.userId,
        role: parsed.data.role,
        addedById: me.id,
      },
    });
    await prisma.taskActivity.create({
      data: {
        taskId: task.id,
        actorId: me.id,
        eventType: 'collaborator_added',
        payload: {
          userId: parsed.data.userId,
          userName: target.name,
          role: parsed.data.role,
        },
      },
    });
    await touchTaskActivity(prisma, task.id);
    // Notify the new collaborator.
    if (parsed.data.userId !== me.id) {
      await prisma.notification.create({
        data: {
          userId: parsed.data.userId,
          type: 'task_assigned',
          payload: {
            taskId: task.id,
            taskName: task.name,
            role: parsed.data.role,
            assignedById: me.id,
            assignedByName: me.name ?? null,
            dueDate: task.dueDate?.toISOString() ?? null,
          },
        },
      });
    }
  } catch (err: unknown) {
    // Unique-constraint violation → already a collaborator
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      return fail('Already a collaborator on this task.', epoch);
    }
    logError('addCollaboratorAction failed', err);
    return fail('Could not add collaborator.', epoch);
  }

  revalidateTask(task.id);
  return ok(epoch);
}

const removeCollaboratorSchema = z.object({
  taskId: z.string().uuid(),
  userId: z.string().uuid(),
});

export async function removeCollaboratorAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = removeCollaboratorSchema.safeParse({
    taskId: formData.get('taskId'),
    userId: formData.get('userId'),
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
    select: { id: true, ownerId: true, createdById: true, divisionId: true, visibility: true },
  });
  if (!task) return fail('Task not found.', epoch);

  if (!(await canEditTask(me.id, task))) {
    return fail('You do not have permission to edit this task.', epoch);
  }

  const existing = await prisma.taskCollaborator.findUnique({
    where: {
      taskId_userId: { taskId: parsed.data.taskId, userId: parsed.data.userId },
    },
    include: { user: { select: { name: true } } },
  });
  if (!existing) return ok(epoch);

  try {
    await prisma.taskCollaborator.delete({
      where: {
        taskId_userId: { taskId: parsed.data.taskId, userId: parsed.data.userId },
      },
    });
    await prisma.taskActivity.create({
      data: {
        taskId: parsed.data.taskId,
        actorId: me.id,
        eventType: 'collaborator_removed',
        payload: {
          userId: parsed.data.userId,
          userName: existing.user.name,
          role: existing.role,
        },
      },
    });
    await touchTaskActivity(prisma, parsed.data.taskId);
  } catch (err) {
    logError('removeCollaboratorAction failed', err);
    return fail('Could not remove collaborator.', epoch);
  }

  revalidateTask(parsed.data.taskId);
  return ok(epoch);
}

// ============================================================
// PMU team share — a PMU team leader shares their owned task with the
// whole PMU team (every member except the PMU's home-division head)
// ============================================================

const setPmuTeamShareSchema = z.object({
  taskId: z.string().uuid(),
  shared: z.union([z.literal('on'), z.literal('')]).transform((v) => v === 'on'),
});

export async function setPmuTeamShareAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = setPmuTeamShareSchema.safeParse({
    taskId: formData.get('taskId'),
    shared: formData.get('shared') ?? '',
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      divisionId: true,
      archivedAt: true,
      sharedWithPmuTeam: true,
      dueDate: true,
      division: { select: { kind: true } },
    },
  });
  if (!task || task.archivedAt) return fail('Task not found.', epoch);

  if (task.division.kind !== 'pmu') {
    return fail('Only a PMU task can be shared with a PMU team.', epoch);
  }

  const meRow = await prisma.user.findUnique({
    where: { id: me.id },
    select: { id: true, isSuperAdmin: true, hierarchySlot: true, pmuId: true, pmuRole: true },
  });
  if (!meRow) return fail('Your account could not be found.', epoch);

  // The PMU team leader who owns the task may share it with their team; OSD
  // and Super Admin may also manage the share on any PMU task.
  const isPmuLeaderOwner =
    task.ownerId === me.id &&
    meRow.pmuRole === 'pmu_team_leader' &&
    meRow.pmuId === task.divisionId;
  const isAdmin = meRow.isSuperAdmin || meRow.hierarchySlot === 'osd';
  if (!isPmuLeaderOwner && !isAdmin) {
    return fail('Only the PMU team leader who owns this task can share it with the team.', epoch);
  }

  if (task.sharedWithPmuTeam === parsed.data.shared) return ok(epoch);

  try {
    await prisma.$transaction([
      prisma.task.update({
        where: { id: task.id },
        data: { sharedWithPmuTeam: parsed.data.shared, lastActivityAt: new Date() },
      }),
      prisma.taskActivity.create({
        data: {
          taskId: task.id,
          actorId: me.id,
          eventType: parsed.data.shared ? 'pmu_team_shared' : 'pmu_team_unshared',
          payload: {},
        },
      }),
    ]);
  } catch (err) {
    logError('setPmuTeamShareAction failed', err);
    return fail('Could not update PMU team sharing.', epoch);
  }

  // Best-effort notifications AFTER the committed share — on enabling, notify
  // each PMU member so the task surfaces in their assigned list, excluding the
  // actor, the owner, and the PMU's home-division head (not a share recipient).
  // A notify failure must not report the already-applied share as failed.
  if (parsed.data.shared) {
    try {
      const headId = await getPmuParentDivisionHeadId(task.divisionId);
      const excluded = [me.id, task.ownerId, ...(headId ? [headId] : [])];
      const members = await prisma.user.findMany({
        where: { pmuId: task.divisionId, isActive: true, id: { notIn: excluded } },
        select: { id: true },
      });
      if (members.length > 0) {
        const notifs: Prisma.NotificationCreateManyInput[] = members.map((u) => ({
          userId: u.id,
          type: 'task_assigned',
          payload: {
            taskId: task.id,
            taskName: task.name,
            assignedById: me.id,
            assignedByName: me.name ?? null,
            dueDate: task.dueDate?.toISOString() ?? null,
          },
        }));
        await prisma.notification.createMany({ data: notifs });
      }
    } catch (err) {
      logError('setPmuTeamShareAction notify failed', err);
    }
  }

  revalidateTask(task.id);
  return ok(epoch);
}

// ============================================================
// Reassignment — request + resolve (approve / reject)
// ============================================================

const reassignSchema = z.object({
  taskId: z.string().uuid(),
  newOwnerId: z.string().uuid(),
});

async function isSubordinateOf(userId: string, superiorId: string): Promise<boolean> {
  let current = userId;
  for (let depth = 0; depth < 20; depth++) {
    const user = await prisma.user.findUnique({
      where: { id: current },
      select: { supervisorId: true },
    });
    if (!user?.supervisorId) return false;
    if (user.supervisorId === superiorId) return true;
    current = user.supervisorId;
  }
  return false;
}

export async function reassignTaskAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = reassignSchema.safeParse({
    taskId: formData.get('taskId'),
    newOwnerId: formData.get('newOwnerId'),
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
    select: { id: true, name: true, ownerId: true, createdById: true, divisionId: true, dueDate: true, visibility: true },
  });
  if (!task) return fail('Task not found.', epoch);
  if (task.ownerId === parsed.data.newOwnerId) return fail('Already the owner.', epoch);

  const newOwner = await prisma.user.findUnique({
    where: { id: parsed.data.newOwnerId, isActive: true },
    select: { id: true, name: true },
  });
  if (!newOwner) return fail('User not found.', epoch);

  const meRow = await prisma.user.findUnique({
    where: { id: me.id },
    select: { id: true, supervisorId: true, isSuperAdmin: true, hierarchySlot: true },
  });
  if (!meRow) return fail('User not found.', epoch);

  const [actor, targetRbac, pmuTeamMemberIds] = await Promise.all([
    getRbacActor(me.id),
    getRbacTarget(parsed.data.newOwnerId),
    getPmuTeamMemberIds(me.id),
  ]);
  if (!actor || !targetRbac) return fail('User not found.', epoch);

  // A PMU team leader may reassign a DIVISION task OWNED BY one of their team
  // members — and freely, without approval, when the new owner is also on the
  // team. The scope stays inside the PMU team; a non-team target still falls to
  // the transfer matrix below. Personal tasks are out of scope, matching the
  // read + manage gates.
  const pmuLeaderManagesTask =
    task.visibility === 'division' && pmuTeamMemberIds.includes(task.ownerId);

  // Initiation guard: reassigning the owner from the Owner row is a head
  // power — Super Admin, OSD, or the head of the task's division only — plus a
  // PMU team leader over their team's tasks. Everyone else (including the
  // owner) hands the task off via Transfer task, which requires a comment.
  // Matches the surface the UI shows.
  const mayInitiate =
    meRow.isSuperAdmin ||
    meRow.hierarchySlot === 'osd' ||
    canActAsHeadOf(actor, task.divisionId) ||
    pmuLeaderManagesTask;
  if (!mayInitiate) {
    return fail('Only a division head or Super Admin can reassign the owner here. Use Transfer task instead.', epoch);
  }

  const isDownward = await isSubordinateOf(parsed.data.newOwnerId, me.id);
  // Free (no approval): Super Admin / OSD anywhere; downward within own
  // chain (existing hierarchy rule); a Division Head assigning the tasks
  // of a division they head to users within their division scope; a PMU team
  // leader reassigning a team task to another team member.
  const isFree =
    isDownward ||
    meRow.isSuperAdmin ||
    meRow.hierarchySlot === 'osd' ||
    (canActAsHeadOf(actor, task.divisionId) && canAssignTaskTo(actor, targetRbac)) ||
    (pmuLeaderManagesTask && pmuTeamMemberIds.includes(parsed.data.newOwnerId));

  if (!isFree && !canTransferTaskTo(actor, targetRbac)) {
    // Approval requests must still stay inside the transfer matrix —
    // no proposing owners across division lines.
    return fail(
      'You can reassign within your division, to your division head, or to Super Admin.',
      epoch,
    );
  }

  try {
    if (isFree) {
      await prisma.$transaction([
        prisma.task.update({
          where: { id: task.id },
          data: { ownerId: parsed.data.newOwnerId, lastActivityAt: new Date() },
        }),
        prisma.taskActivity.create({
          data: {
            taskId: task.id,
            actorId: me.id,
            eventType: 'owner_changed',
            payload: { from: task.ownerId, to: parsed.data.newOwnerId, toName: newOwner.name },
          },
        }),
      ]);
      if (parsed.data.newOwnerId !== me.id) {
        await prisma.notification.create({
          data: {
            userId: parsed.data.newOwnerId,
            type: 'task_assigned',
            payload: {
              taskId: task.id,
              taskName: task.name,
              actorId: me.id,
              assignedById: me.id,
              assignedByName: me.name ?? null,
              dueDate: task.dueDate?.toISOString() ?? null,
            },
          },
        });
      }
    } else {
      const approverId = meRow.supervisorId;
      if (!approverId) return fail('No supervisor found to approve this reassignment.', epoch);

      const existing = await prisma.reassignmentRequest.findFirst({
        where: { taskId: task.id, status: 'pending' },
      });
      if (existing) return fail('A reassignment is already pending approval.', epoch);

      await prisma.reassignmentRequest.create({
        data: {
          taskId: task.id,
          requestedById: me.id,
          proposedOwnerId: parsed.data.newOwnerId,
          approverId,
        },
      });
      await prisma.notification.create({
        data: {
          userId: approverId,
          type: 'reassignment_approval_requested',
          payload: {
            taskId: task.id,
            taskName: task.name,
            actorId: me.id,
            actorName: me.name ?? null,
            proposedOwnerId: parsed.data.newOwnerId,
          },
        },
      });
      await prisma.taskActivity.create({
        data: {
          taskId: task.id,
          actorId: me.id,
          eventType: 'reassignment_requested',
          payload: { proposedOwnerId: parsed.data.newOwnerId, proposedOwnerName: newOwner.name },
        },
      });
    }
  } catch (err) {
    logError('reassignTaskAction failed', err);
    return fail('Could not reassign task.', epoch);
  }

  revalidateTask(task.id);
  return ok(epoch);
}

const resolveReassignmentSchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(['approve', 'reject']),
});

export async function resolveReassignmentAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = resolveReassignmentSchema.safeParse({
    requestId: formData.get('requestId'),
    action: formData.get('action'),
  });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const request = await prisma.reassignmentRequest.findUnique({
    where: { id: parsed.data.requestId },
    include: {
      task: { select: { id: true, name: true, ownerId: true, dueDate: true } },
      proposedOwner: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, name: true } },
    },
  });
  if (!request) return fail('Request not found.', epoch);
  if (request.status !== 'pending') return fail('This request has already been resolved.', epoch);
  if (request.approverId !== me.id) return fail('You are not the approver for this request.', epoch);

  const approved = parsed.data.action === 'approve';

  const claimed = await prisma.reassignmentRequest.updateMany({
    where: { id: request.id, status: 'pending' },
    data: { status: approved ? 'approved' : 'rejected', resolvedAt: new Date() },
  });
  if (claimed.count === 0) return fail('This request has already been resolved.', epoch);

  if (approved) {
    await prisma.$transaction([
      prisma.task.update({
        where: { id: request.taskId },
        data: { ownerId: request.proposedOwnerId, lastActivityAt: new Date() },
      }),
      prisma.taskActivity.create({
        data: {
          taskId: request.taskId,
          actorId: me.id,
          eventType: 'owner_changed',
          payload: {
            from: request.task.ownerId,
            to: request.proposedOwnerId,
            toName: request.proposedOwner.name,
            viaApproval: true,
          },
        },
      }),
    ]);
    await prisma.notification.createMany({
      data: [
        {
          userId: request.requestedById,
          type: 'reassignment_approved',
          payload: {
            taskId: request.taskId,
            taskName: request.task.name,
            actorId: me.id,
            actorName: me.name ?? null,
          },
        },
        ...(request.proposedOwnerId !== request.requestedById
          ? [{
              userId: request.proposedOwnerId,
              type: 'task_assigned' as const,
              payload: {
                taskId: request.taskId,
                taskName: request.task.name,
                actorId: me.id,
                assignedById: request.requestedById,
                assignedByName: request.requestedBy.name,
                dueDate: request.task.dueDate?.toISOString() ?? null,
              },
            }]
          : []),
      ],
    });
  } else {
    await prisma.taskActivity.create({
      data: {
        taskId: request.taskId,
        actorId: me.id,
        eventType: 'reassignment_rejected',
        payload: { proposedOwnerId: request.proposedOwnerId, proposedOwnerName: request.proposedOwner.name },
      },
    });
    await prisma.notification.create({
      data: {
        userId: request.requestedById,
        type: 'reassignment_rejected',
        payload: {
          taskId: request.taskId,
          taskName: request.task.name,
          actorId: me.id,
          actorName: me.name ?? null,
        },
      },
    });
  }

  revalidateTask(request.taskId);
  return ok(epoch);
}

// ============================================================
// transferTask — owner hands the task off per the RBAC transfer matrix
// ============================================================

/**
 * Allowed targets (enforced in `canTransferTaskTo`, src/lib/rbac):
 *   Super Admin   → anyone
 *   Division Head → a member of any division they head, a co-member of any
 *                   division they belong to, another Division Head, Super Admin
 *   Division User → a co-member of any division they belong to, the head of any
 *                   division they belong to, Super Admin
 * "Belong to" is the member set (home + admin-granted extra divisions), so
 * cross-division transfer now flows from shared membership — the hardcoded
 * KI→NSDF allocation link is retired. A comment is mandatory on every transfer.
 * The full trail lands in task_activity (with the comment), the comment thread,
 * and audit_log.
 */
const transferTaskSchema = z.object({
  taskId: z.string().uuid(),
  targetUserId: z.string().uuid(),
  comment: z
    .string()
    .trim()
    .min(1, 'A comment is required to transfer a task')
    .max(2000, 'Comment is too long'),
});

export async function transferTaskAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out. Refresh and try again.', epoch);

  const parsed = transferTaskSchema.safeParse({
    taskId: formData.get('taskId'),
    targetUserId: formData.get('targetUserId'),
    comment: formData.get('comment'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, error: fieldErrors.comment, fieldErrors, epoch };
  }

  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
    select: { id: true, name: true, ownerId: true, createdById: true, divisionId: true, visibility: true, dueDate: true, parentTaskId: true },
  });
  if (!task) return fail('Task not found.', epoch);

  if (task.ownerId !== me.id) return fail('Only the current owner can transfer a task.', epoch);

  if (parsed.data.targetUserId === me.id) return fail('You already own this task.', epoch);

  const target = await prisma.user.findUnique({
    where: { id: parsed.data.targetUserId },
    select: { id: true, name: true, isActive: true, divisionId: true },
  });
  if (!target || !target.isActive) return fail('Target user not found or inactive.', epoch);

  const [actor, targetRbac] = await Promise.all([
    getRbacActor(me.id),
    getRbacTarget(target.id),
  ]);
  if (!actor) return fail('Your account could not be found.', epoch);
  if (!targetRbac || !canTransferTaskTo(actor, targetRbac)) {
    return fail(
      'You can transfer within a division you belong to, to a division head, or to Super Admin.',
      epoch,
    );
  }

  const comment = parsed.data.comment;
  const mentions = await resolveMentions(comment, task.id);

  const updates: Parameters<typeof prisma.task.update>[0]['data'] = {
    ownerId: target.id,
    lastActivityAt: new Date(),
  };
  // A top-level personal task auto-promotes to division on transfer so it
  // does not vanish from the recipient's view (§5.6). Subtasks are exempt:
  // a subtask inherits its parent's visibility and must never become more
  // permissive than the parent (§5.1), so its visibility is left untouched.
  if (task.visibility === 'personal' && !task.parentTaskId) {
    if (canCreateDivisionTask(actor, task.divisionId)) {
      updates.visibility = 'division';
    }
  }

  try {
    await prisma.$transaction([
      prisma.task.update({ where: { id: task.id }, data: updates }),
      prisma.taskActivity.create({
        data: {
          taskId: task.id,
          actorId: me.id,
          eventType: 'task_transferred',
          payload: {
            from: me.id,
            fromName: me.name,
            to: target.id,
            toName: target.name,
            comment,
          },
        },
      }),
      // The mandatory transfer note joins the comment thread so the
      // hand-off reason is visible where the discussion lives.
      prisma.taskComment.create({
        data: {
          taskId: task.id,
          userId: me.id,
          body: comment,
          mentions,
        },
      }),
      prisma.auditLog.create({
        data: {
          actorId: me.id,
          action: 'update',
          entityType: 'task',
          entityId: task.id,
          before: { ownerId: task.ownerId },
          after: { ownerId: target.id, transfer: true, comment },
        },
      }),
    ]);
  } catch (err) {
    logError('transferTaskAction failed', err);
    return fail('Could not transfer the task.', epoch);
  }

  const notifications = [
    prisma.notification.create({
      data: {
        userId: target.id,
        type: 'task_assigned',
        payload: {
          taskId: task.id,
          taskName: task.name,
          assignedById: me.id,
          assignedByName: me.name ?? null,
          dueDate: task.dueDate?.toISOString() ?? null,
          comment,
        },
      },
    }),
  ];

  if (task.createdById !== me.id && task.createdById !== target.id) {
    notifications.push(
      prisma.notification.create({
        data: {
          userId: task.createdById,
          type: 'task_transferred',
          payload: { taskId: task.id, taskName: task.name, fromName: me.name, toName: target.name, comment },
        },
      }),
    );
  }

  await Promise.all(notifications);

  revalidateTask(task.id);
  return ok(epoch);
}

// ---------------------------------------------------------------
// Pull task — division user claims an unassigned task
// ---------------------------------------------------------------

const pullTaskSchema = z.object({ taskId: z.string().uuid() });

export async function pullTaskAction(
  prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const epoch = bump(prev);
  const me = await requireSession();
  if (!me) return fail('You are signed out.', epoch);

  const parsed = pullTaskSchema.safeParse({ taskId: formData.get('taskId') });
  if (!parsed.success) return fail('Invalid input.', epoch);

  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
    select: { id: true, name: true, ownerId: true, createdById: true, divisionId: true, visibility: true, parentTaskId: true },
  });
  if (!task) return fail('Task not found.', epoch);

  if (task.ownerId !== task.createdById) return fail('This task is already assigned.', epoch);
  if (task.ownerId === me.id) return fail('You already own this task.', epoch);
  if (task.visibility === 'personal') return fail('Personal tasks cannot be pulled.', epoch);
  if (task.parentTaskId) return fail('Subtasks cannot be pulled.', epoch);

  const meRow = await prisma.user.findUnique({
    where: { id: me.id },
    select: { id: true, name: true },
  });
  if (!meRow) return fail('User not found.', epoch);
  // A member (home or admin-granted extra) of the task's division may pull it.
  const memberDivisionIds = await getMemberDivisionIds(me.id);
  if (!memberDivisionIds.includes(task.divisionId)) {
    return fail('You can only pull tasks from a division you belong to.', epoch);
  }

  await prisma.$transaction([
    prisma.task.update({
      where: { id: task.id },
      data: { ownerId: me.id, lastActivityAt: new Date() },
    }),
    prisma.taskActivity.create({
      data: {
        taskId: task.id,
        actorId: me.id,
        eventType: 'task_pulled',
        payload: { pulledBy: me.id, pulledByName: meRow.name },
      },
    }),
  ]);

  if (task.createdById !== me.id) {
    await prisma.notification.create({
      data: {
        userId: task.createdById,
        type: 'task_pulled',
        payload: { taskId: task.id, taskName: task.name, pulledByName: meRow.name },
      },
    });
  }

  revalidateTask(task.id);
  return ok(epoch);
}
