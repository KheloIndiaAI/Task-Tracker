import { prisma } from '@/lib/db';
import { buildVisibilityClauses, visibilityAnd } from '@/lib/visibility';

/**
 * View-only profile card shown when a person is opened from global search.
 * Deliberately small: the directory-level facts a colleague needs — who they
 * are, how to reach them, who they report to, and what they work on.
 *
 * The type is import-type-safe for the client popup (no prisma leaks into the
 * bundle); the fetch below is server-only.
 */
export type UserProfileCard = {
  id: string;
  name: string;
  username: string;
  designation: string;
  divisionId: string;
  divisionName: string;
  divisionColour: string;
  phone: string | null;
  email: string | null;
  reportsToName: string | null;
  reportsToDesignation: string | null;
  workActivities: string | null;
  isActive: boolean;
  isSuperAdmin: boolean;
};

/**
 * A division-visibility task the profiled person is attached to — as the task
 * owner, a collaborator, or the owner of a subtask. `relation` records which,
 * so the profile popup can label why the task is listed.
 */
export type AllottedTaskRow = {
  id: string;
  name: string;
  status: string;
  dueDate: string | null;
  href: string;
  relation: 'owner' | 'collaborator' | 'subtask';
};

type ViewerContext = {
  /** The viewer's member divisions (home + admin-granted extras). */
  memberDivisionIds: string[];
  isSuperAdmin: boolean;
  hierarchySlot: string;
};

/**
 * Who may see a person's "tasks allotted" list: a colleague who is a **member**
 * of the profiled user's division (home or an admin-granted extra membership),
 * or the oversight roles OSD / Super Admin. Users who share no division do not
 * see the control at all. The task query is additionally visibility-scoped to
 * the viewer, so the list can never leak a task they could not already see.
 */
export function canViewAllottedTasks(
  viewer: ViewerContext,
  profileDivisionId: string,
): boolean {
  return (
    viewer.isSuperAdmin ||
    viewer.hierarchySlot === 'osd' ||
    viewer.memberDivisionIds.includes(profileDivisionId)
  );
}

export async function getUserProfileCard(id: string): Promise<UserProfileCard | null> {
  const u = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      username: true,
      designation: true,
      phone: true,
      email: true,
      workActivities: true,
      isActive: true,
      isSuperAdmin: true,
      divisionId: true,
      division: { select: { name: true, avatarColour: true } },
      supervisor: { select: { name: true, designation: true } },
    },
  });
  if (!u) return null;

  return {
    id: u.id,
    name: u.name,
    username: u.username,
    designation: u.designation,
    divisionId: u.divisionId,
    divisionName: u.division.name,
    divisionColour: u.division.avatarColour,
    phone: u.phone,
    email: u.email,
    reportsToName: u.supervisor?.name ?? null,
    reportsToDesignation: u.supervisor?.designation ?? null,
    workActivities: u.workActivities,
    isActive: u.isActive,
    isSuperAdmin: u.isSuperAdmin,
  };
}

/**
 * Division-visibility tasks the profiled person (`personId`) is attached to —
 * as the task owner (top-level task), a collaborator, or the owner of a subtask
 * — scoped to what `callerId` is actually allowed to see
 * (`buildVisibilityClauses`), so the list can never leak a task the caller
 * could not already see. Callers must still gate the surface with
 * `canViewAllottedTasks`.
 */
export async function getAllottedDivisionTasksFor(
  callerId: string,
  personId: string,
): Promise<AllottedTaskRow[]> {
  const me = await prisma.user.findUnique({
    where: { id: callerId },
    select: {
      id: true,
      hierarchySlot: true,
      isSuperAdmin: true,
      divisionId: true,
      isPmu: true,
      pmuId: true,
    },
  });
  if (!me) return [];

  const visibility = await buildVisibilityClauses(me);
  const rows = await prisma.task.findMany({
    where: {
      AND: [
        // How the profiled person is attached to the task: its owner (a
        // top-level task or a subtask they own — subtasks are just tasks with a
        // parent), or an explicit collaborator.
        {
          archivedAt: null,
          OR: [
            { ownerId: personId },
            { collaborators: { some: { userId: personId } } },
          ],
        },
        // Caller visibility guard — never surface a task the caller can't see.
        ...visibilityAnd(visibility),
      ],
    },
    select: {
      id: true,
      name: true,
      status: true,
      dueDate: true,
      ownerId: true,
      parentTaskId: true,
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 50,
  });

  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    href: `/tasks/${t.id}`,
    relation:
      t.ownerId === personId
        ? t.parentTaskId
          ? 'subtask'
          : 'owner'
        : 'collaborator',
  }));
}
