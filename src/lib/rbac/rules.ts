/**
 * Division-based RBAC — pure rules.
 *
 * Three roles overlay the existing hierarchy model without replacing it:
 *
 *   super_admin   — users.is_super_admin = true. Unrestricted.
 *   division_head — the user is divisions.head_user_id for at least one
 *                   division, or holds an active DivisionAccessDelegation.
 *   division_user — everyone else.
 *
 * `headedDivisionIds` always means direct headships PLUS active
 * delegations — a delegate acts as the division's head for the whole
 * window (visibility, assignment, receiving transfers). The one thing a
 * delegate cannot do is re-delegate; see `canDelegateDivision`.
 *
 * This file must stay free of Prisma / database imports so the rules are
 * unit-testable in isolation. DB-backed context builders live in
 * `src/lib/rbac/index.ts`.
 */

export type RbacRole = 'super_admin' | 'division_head' | 'division_user';

export type RbacActor = {
  id: string;
  /**
   * The actor's single HOME division (users.division_id). Drives ownership,
   * display, PMU home, and reference-number identity — NOT membership reach
   * (use `memberDivisionIds` for that; home is always included in it).
   */
  divisionId: string;
  isSuperAdmin: boolean;
  /** hierarchy_slot = 'osd' — the JS-office coordinator acts across divisions. */
  isOsd?: boolean;
  /** Divisions where the actor holds head powers — direct + delegated. */
  headedDivisionIds: string[];
  /**
   * Divisions the actor is a MEMBER of: their home division plus any
   * admin-granted extra divisions (user_division_access). Drives member-level
   * reach — being a co-member for transfer, an assignment target within a
   * headed division, and (for a Director) managing that division's tasks. Home
   * is always included. It grants NO head powers (no delete, no delegation, no
   * division-task creation). Populated by `getRbacActor`. This replaces the
   * retired hardcoded cross-division allocation link.
   */
  memberDivisionIds: string[];
};

export type RbacTarget = {
  id: string;
  divisionId: string;
  isSuperAdmin: boolean;
  headedDivisionIds: string[];
  /** Divisions the target is a MEMBER of (home + granted extras). A task may be
   *  transferred/assigned to a user in ANY of their member divisions. */
  memberDivisionIds: string[];
  isActive: boolean;
};

export function roleOf(actor: Pick<RbacActor, 'isSuperAdmin' | 'headedDivisionIds'>): RbacRole {
  if (actor.isSuperAdmin) return 'super_admin';
  if (actor.headedDivisionIds.length > 0) return 'division_head';
  return 'division_user';
}

/**
 * Is a delegation live at `now`? The window is inclusive on both ends and
 * a revocation wins over the window. Expiry is purely query/time-based —
 * no scheduled job flips anything.
 */
export function isDelegationActive(
  d: { startsAt: Date; endsAt: Date; revokedAt: Date | null },
  now: Date,
): boolean {
  if (d.revokedAt) return false;
  const t = now.getTime();
  return d.startsAt.getTime() <= t && t <= d.endsAt.getTime();
}

/** True when two member-division sets share at least one division. */
function sharesMemberDivision(a: string[], b: string[]): boolean {
  return a.some((d) => b.includes(d));
}

/**
 * Task transfer matrix (current owner hands the task off):
 *
 *   Super Admin   → anyone.
 *   Division Head → users in divisions they head, a co-member of any division
 *                   they belong to, another Division Head, or Super Admin.
 *   Division User → a co-member of any division they belong to, the head of any
 *                   division they belong to, or Super Admin.
 *
 * "Belong to" means the member set (home + admin-granted extra divisions), so a
 * multi-division member can transfer within any of their divisions and receive
 * tasks in any of theirs. This membership reach replaces the retired
 * cross-division allocation link. Inactive targets and self-transfers are
 * always rejected.
 */
export function canTransferTaskTo(actor: RbacActor, target: RbacTarget): boolean {
  if (!target.isActive || target.id === actor.id) return false;
  if (actor.isSuperAdmin) return true;
  if (target.isSuperAdmin) return true;

  if (roleOf(actor) === 'division_head') {
    if (target.headedDivisionIds.length > 0) return true;
    // A co-member of any division the actor belongs to, or a member of any
    // division the actor heads.
    return (
      sharesMemberDivision(actor.memberDivisionIds, target.memberDivisionIds) ||
      target.memberDivisionIds.some((d) => actor.headedDivisionIds.includes(d))
    );
  }

  // Division user → a co-member of any of their divisions, or the head of any
  // division they belong to.
  return (
    sharesMemberDivision(actor.memberDivisionIds, target.memberDivisionIds) ||
    actor.memberDivisionIds.some((d) => target.headedDivisionIds.includes(d))
  );
}

/**
 * Assignment matrix (setting a task's owner directly, without the target's
 * consent): Super Admin assigns anywhere; otherwise the actor must hold a
 * headship (the head-power gate — a plain member cannot assign). A head may
 * assign to any user who is a MEMBER of a division they head, or to a co-member
 * of any division they belong to. Division users cannot assign directly — they
 * go through transfer (with a mandatory comment) or the approval flow.
 */
export function canAssignTaskTo(actor: RbacActor, target: RbacTarget): boolean {
  if (!target.isActive) return false;
  if (actor.isSuperAdmin) return true;
  if (actor.headedDivisionIds.length === 0) return false;
  return (
    target.memberDivisionIds.some((d) => actor.headedDivisionIds.includes(d)) ||
    sharesMemberDivision(actor.memberDivisionIds, target.memberDivisionIds)
  );
}

/** Head powers over one specific division (curation, free reassignment of its tasks). */
export function canActAsHeadOf(actor: RbacActor, divisionId: string): boolean {
  if (actor.isSuperAdmin) return true;
  return actor.headedDivisionIds.includes(divisionId);
}

/**
 * Division-level task creation (visibility: 'division') — giving work on a
 * division's board is reserved for Super Admin, OSD, the division's head or an
 * active delegate (`headedDivisionIds` covers direct + delegated). Everyone
 * else creates personal tasks only. Crucially, mere MEMBERSHIP of a division
 * does NOT grant this — a non-head member creates personal tasks only, exactly
 * as in their home division. The same rule also gates changing an existing
 * task's visibility. (Moving a task into a different division is a separate,
 * Super-Admin/OSD-only gate in `updateTaskFieldsAction` — not this rule.)
 */
export function canCreateDivisionTask(actor: RbacActor, divisionId: string): boolean {
  if (actor.isSuperAdmin || actor.isOsd) return true;
  return actor.headedDivisionIds.includes(divisionId);
}

/**
 * Who may set a task's JS Priority lane — the Daily / Weekly / Monthly pills on
 * the grouped tasks list, and the Priority Board's drag-and-drop.
 *
 * Super Admin and OSD curate across the ministry. A division's head (direct or
 * active delegate) and its Directors curate that division's OWN tasks, so a
 * division can bucket its own work without routing every change through OSD.
 * Everyone else is read-only: they see which lane a task sits in, but get no
 * interactive pill.
 *
 * Scoping deliberately mirrors `canManageTask` — the same people who can
 * already manage a division's tasks can now also bucket them. Note this widens
 * the board beyond the "OSD-curated" wording in CLAUDE.md / PERMISSIONS.md §5.3;
 * those docs need updating to match.
 */
export function canSetJsPriorityLane(
  caller: {
    isSuperAdmin: boolean;
    hierarchySlot: string;
    /** Home + admin-granted divisions — scopes a Director to their own. */
    memberDivisionIds: string[];
    headedDivisionIds: string[];
  },
  task: { divisionId: string },
): boolean {
  if (caller.isSuperAdmin) return true;
  if (caller.hierarchySlot === 'osd') return true;
  if (caller.hierarchySlot === 'director' && caller.memberDivisionIds.includes(task.divisionId)) {
    return true;
  }
  return caller.headedDivisionIds.includes(task.divisionId);
}

/**
 * Who may MANAGE a task — edit its status / priority / description / subtasks
 * and add or remove its collaborators. The rule is the single source of truth
 * behind the server `canEditTask` guard (see src/app/actions/tasks.ts) and the
 * task-detail page's edit affordances, so the UI never shows a control the
 * server would refuse (nor hides one it would allow).
 *
 * Granted to:
 *   - the current owner or the ORIGINAL creator — the creator keeps management
 *     rights even after ownership is handed to someone else, so a Head / OSD /
 *     Super Admin who set up a task can still curate its collaborators;
 *   - a Super Admin, OSD, or JS (whole-office oversight);
 *   - a Director who is a MEMBER of the task's division (home or an
 *     admin-granted extra division) — a Director member manages that division's
 *     tasks;
 *   - the head of the task's division — INCLUDING an active delegate, since
 *     `headedDivisionIds` folds in live delegations. A delegate is the
 *     temporary head for the delegation's lifetime and manages its tasks
 *     exactly as the head would.
 *   - a PMU team leader, over any DIVISION-visibility task OWNED BY a member of
 *     their PMU team (`pmuTeamMemberIds`, resolved by `getPmuTeamMemberIds`).
 *     This scopes the leader's admin to the PMU team's own board tasks — never
 *     the wider division's ministry tasks, and never a teammate's PERSONAL task
 *     (personal tasks stay private to their creator, exactly as the visibility
 *     scoper keeps them off the leader's board). Management only: never delete.
 *
 * Pure so it can be unit-tested and shared verbatim by client and server.
 */
export function canManageTask(
  caller: {
    id: string;
    isSuperAdmin: boolean;
    hierarchySlot: string;
    /** The caller's member divisions (home + granted extras). */
    memberDivisionIds: string[];
    headedDivisionIds: string[];
    /**
     * When the caller is a PMU team leader, the ids of their PMU team (see
     * `getPmuTeamMemberIds`); omitted/empty otherwise. The leader manages a
     * division task whose owner is in this set.
     */
    pmuTeamMemberIds?: string[];
  },
  task: { ownerId: string; createdById: string; divisionId: string; visibility?: string },
): boolean {
  if (task.ownerId === caller.id || task.createdById === caller.id) return true;
  if (caller.isSuperAdmin) return true;
  if (caller.hierarchySlot === 'osd' || caller.hierarchySlot === 'js') return true;
  if (caller.hierarchySlot === 'director' && caller.memberDivisionIds.includes(task.divisionId)) {
    return true;
  }
  if (caller.headedDivisionIds.includes(task.divisionId)) return true;
  // A PMU team leader — only over the team's DIVISION tasks. A teammate's
  // personal task is out of scope (it is off the leader's board too), so the
  // management surface never exceeds what the leader can see.
  return (
    task.visibility === 'division' &&
    (caller.pmuTeamMemberIds?.includes(task.ownerId) ?? false)
  );
}

/**
 * Only the direct head (divisions.head_user_id) or a Super Admin can
 * delegate a division's access — a delegate cannot re-delegate.
 */
export function canDelegateDivision(
  actor: { id: string; isSuperAdmin: boolean },
  division: { headUserId: string | null },
): boolean {
  if (actor.isSuperAdmin) return true;
  return division.headUserId !== null && division.headUserId === actor.id;
}

/**
 * Who may receive a delegation: another direct Division Head, a user in
 * the delegated division, or a user in the delegator's home division.
 * The delegator themselves and inactive users never qualify.
 */
export function isEligibleDelegate(
  target: {
    id: string;
    isActive: boolean;
    /** The target's member divisions (home + granted extras). */
    memberDivisionIds: string[];
    directHeadedDivisionIds: string[];
  },
  ctx: { divisionId: string; delegatorId: string; delegatorHomeDivisionId: string },
): boolean {
  if (!target.isActive || target.id === ctx.delegatorId) return false;
  if (target.directHeadedDivisionIds.length > 0) return true;
  // A member (home or granted) of the delegated division, or of the delegator's
  // home division, qualifies.
  return (
    target.memberDivisionIds.includes(ctx.divisionId) ||
    target.memberDivisionIds.includes(ctx.delegatorHomeDivisionId)
  );
}

/** Longest delegation we accept. Generous, but keeps "temporary" honest. */
export const MAX_DELEGATION_DAYS = 366;

/**
 * Validate a delegation window. Returns a sentence-case error message, or
 * null when the window is acceptable. `now` is injected for testability.
 * Windows may start in the future; they must not already be over.
 */
export function validateDelegationWindow(opts: {
  startsAt: Date;
  endsAt: Date;
  now: Date;
}): string | null {
  const { startsAt, endsAt, now } = opts;
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return 'Dates are invalid.';
  }
  if (endsAt.getTime() < startsAt.getTime()) {
    return 'End date cannot be before the start date.';
  }
  if (endsAt.getTime() < now.getTime()) {
    return 'End date cannot be in the past.';
  }
  const days = (endsAt.getTime() - startsAt.getTime()) / (24 * 60 * 60 * 1000);
  if (days > MAX_DELEGATION_DAYS) {
    return 'Delegations can cover at most one year.';
  }
  return null;
}
