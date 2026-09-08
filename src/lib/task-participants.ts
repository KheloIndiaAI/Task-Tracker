import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { getOfficeOfJsDivisionId } from '@/lib/engagements';
import { getPmuParentDivisionHeadId } from '@/lib/visibility';

/**
 * Who may take part in a task — the single source of truth for every task
 * user-picker (collaborators, subtask assignees, @mentions) and its
 * server-side guard, so the pickers and the actions never diverge.
 *
 * A task's participants are the active MEMBERS of its division — users whose
 * home division is the task's division OR who hold an admin-granted extra
 * membership in it (user_division_access) — or, for a PMU task, its PMU team,
 * plus that division's head and the always-relevant oversight roles (OSD +
 * Super Admin). The seeded "Office of JS" division is a coordinating office, so
 * its tasks may involve any active user.
 *
 * Cross-division participation is therefore expressed by membership: a user
 * homed elsewhere but granted the task's division as an extra member counts as
 * a participant exactly like a home member. This replaces the retired hardcoded
 * cross-division participant links (KI / KIM ↔ NSDF). See PERMISSIONS §5.17.
 *
 * The task OWNER is deliberately stricter (same division only — see
 * createTaskAction) and is not built from this rule.
 */

export type ParticipantTask = {
  divisionId: string;
  division: { kind: string; headUserId: string | null };
};

/**
 * Pure core — given the resolved division head id and the Office-of-JS
 * division id, build the `where` that selects a task's participants.
 * Unit-testable without a database.
 */
export function buildTaskParticipantWhereFrom(
  task: ParticipantTask,
  headId: string | null,
  officeOfJsDivisionId: string | null,
): Prisma.UserWhereInput {
  // Office of JS coordinates across the ministry — any active user qualifies.
  if (officeOfJsDivisionId && task.divisionId === officeOfJsDivisionId) {
    return { isActive: true };
  }

  const isPmu = task.division.kind === 'pmu';
  const or: Prisma.UserWhereInput[] = [
    // Members of the task's division — or, for a PMU task, its team.
    isPmu ? { pmuId: task.divisionId } : { divisionId: task.divisionId },
    // Oversight roles are relevant to every task.
    { hierarchySlot: 'osd' },
    { isSuperAdmin: true },
  ];
  // Admin-granted extra members of the task's (non-PMU) division participate
  // exactly like home members. Membership is division-level, so a grant never
  // points at a PMU — the PMU-task branch stays pmu_id-only.
  if (!isPmu) {
    or.push({ divisionAccess: { some: { divisionId: task.divisionId } } });
  }
  // The division's head (may sit in a different home division).
  if (headId) or.push({ id: headId });

  return { isActive: true, OR: or };
}

/**
 * DB-backed wrapper: resolves the head + Office-of-JS ids and builds the
 * participant set. Cross-division reach comes from membership (the
 * `divisionAccess` clause in the pure builder), so a user granted the task's
 * division as an extra membership is a participant — the single source every
 * task user-picker and guard reads, so the reach lands on collaborators,
 * subtask assignees, and @mentions alike.
 */
export async function buildTaskParticipantWhere(
  task: ParticipantTask,
): Promise<Prisma.UserWhereInput> {
  const officeOfJsDivisionId = await getOfficeOfJsDivisionId();
  const headId =
    task.division.headUserId ??
    (task.division.kind === 'pmu'
      ? await getPmuParentDivisionHeadId(task.divisionId)
      : null);
  return buildTaskParticipantWhereFrom(task, headId, officeOfJsDivisionId);
}

/** Whether a user is allowed to take part in a task (server-side guard). */
export async function isTaskParticipant(
  userId: string,
  task: ParticipantTask,
): Promise<boolean> {
  const where = await buildTaskParticipantWhere(task);
  const count = await prisma.user.count({ where: { AND: [{ id: userId }, where] } });
  return count > 0;
}

/**
 * Whether a user is an explicit collaborator on a task — any collaborator
 * row (collaborator / division_lead / co_owner). Collaborators may
 * *contribute* to a task they can see (add documents, edit its context,
 * create subtasks) without owning or being able to redefine it. The
 * server-side guards for those contribute actions share this helper.
 */
export async function isTaskCollaborator(
  userId: string,
  taskId: string,
): Promise<boolean> {
  const row = await prisma.taskCollaborator.findFirst({
    where: { taskId, userId },
    select: { id: true },
  });
  return row !== null;
}

/** Whether anyone has @mentioned this user in the task's discussion. */
export async function isMentionedOnTask(
  userId: string,
  taskId: string,
): Promise<boolean> {
  const row = await prisma.taskComment.findFirst({
    where: { taskId, mentions: { has: userId } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Whether a user may CONTRIBUTE to a task — add documents, edit its context,
 * create subtasks — without owning it or being able to redefine it.
 *
 * Granted to explicit collaborators and to anyone @mentioned in the task's
 * discussion. Pulling someone into the conversation is an invitation to help,
 * so it carries the same bounded rights rather than read-only silence; the
 * mention itself is already restricted to users who may take part in the task
 * (see `resolveMentions`), so this cannot hand rights to an arbitrary outsider.
 *
 * Deliberately NOT redefine or delete: those stay with the owner, the creator,
 * and the division's head.
 */
export async function isTaskContributor(
  userId: string,
  taskId: string,
): Promise<boolean> {
  if (await isTaskCollaborator(userId, taskId)) return true;
  return isMentionedOnTask(userId, taskId);
}
