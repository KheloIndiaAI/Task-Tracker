import type { Prisma } from '@prisma/client';

/**
 * Pure task-visibility clause builder — no database imports, so the
 * rules are unit-testable in isolation. `src/lib/visibility.ts` wraps
 * this with the DB-backed headship lookup; everything else should import
 * from there.
 */

export type CallerSummary = {
  id: string;
  hierarchySlot: string;
  isSuperAdmin: boolean;
  divisionId: string;
  isPmu: boolean;
  /** The caller's PMU id (users.pmu_id), or null when not a PMU member. */
  pmuId: string | null;
};

/** Extra caller facts resolved from the DB, injected into the pure builder. */
/**
 * What a caller may read.
 *
 *   - an ARRAY — the OR-arms that scope them. Every arm must carry a real
 *     condition: Prisma folds an empty one out of the array, which under OR
 *     NARROWS the result to the remaining arms rather than widening it.
 *   - `null` — UNRESTRICTED. The caller reads every task, so no visibility
 *     filter is applied at all. Expressed as an absence rather than a
 *     match-everything condition, because there is no honest way to write
 *     "no filter" as a filter — the attempt is what broke Super Admin on
 *     2026-09-17.
 *
 * An EMPTY array is neither: `OR: []` matches nothing, which is the correct
 * fail-closed value for "this caller may read no task at all".
 *
 * Never spread a scope into a `where` yourself — pass it through
 * `visibilityAnd` so the unrestricted case is handled the one way.
 */
export type VisibilityScope = Prisma.TaskWhereInput[] | null;

/**
 * A scope as AND-able clauses: `[{ OR: scope }]`, or nothing at all when the
 * caller is unrestricted. Spread it into the `AND` of any task query:
 *
 *     where: { archivedAt: null, AND: [...visibilityAnd(scope), filter] }
 *
 * Under AND an absent clause means "no restriction", which is exactly what
 * unrestricted should mean — the same shape `buildTfVisibilityClause` has
 * always used for Timeline Files.
 */
export function visibilityAnd(scope: VisibilityScope): Prisma.TaskWhereInput[] {
  return scope === null ? [] : [{ OR: scope }];
}

export type VisibilityOptions = {
  /**
   * True when the caller is the head of their PMU's home (parent) division.
   * That head is excluded from the "shared with the PMU team" clause — they
   * still see such a task via the owner-scoped PMU clause, but it is not
   * surfaced to them as a whole-team share.
   */
  isPmuParentDivisionHead?: boolean;
  /**
   * For a PMU caller: the division their PMU hangs off (`getPmuParentDivision`).
   * Scopes the "shown down to the PMU team" clause below — a division task
   * carrying `shared_with_pmu_team` is visible to the PMUs of THAT division
   * only, never to a PMU under some other division.
   */
  pmuParentDivisionId?: string | null;
  /**
   * Divisions the caller is a MEMBER of: their home division plus any
   * admin-granted extra divisions (user_division_access). Grants FULL board
   * visibility of each division's tasks. The home division is handled per role
   * — an officer always sees their home board, a PMU member does NOT (PMU
   * isolation is preserved), and a JS user sees the priority board rather than
   * a home board — so only the EXTRA granted divisions widen the JS/PMU
   * branches. Defaults to [me.divisionId] (home-only) when omitted.
   * Populated by buildVisibilityClauses; this replaces the retired
   * cross-division allocation-link visibility.
   */
  memberDivisionIds?: string[];
  /**
   * When the caller is a PMU team leader, the ids of their PMU team (see
   * `getPmuTeamMemberIds`). Grants owner-scoped visibility of the team's tasks
   * so the leader can oversee and manage them — the read side of their
   * PMU-team admin scope. Empty/omitted for everyone else.
   */
  pmuTeamLeaderMemberIds?: string[];
  /**
   * PMUs attached to the caller's own divisions (resolved by
   * `getPmuDivisionIdsFor`, which honours `pmu_parent_division_id` and falls
   * back to `parent_id`). A ministry officer reads their divisions' PMU boards
   * alongside their own — the read-side counterpart of the create targets in
   * src/app/(app)/layout.tsx, which already treat a head's divisions and those
   * divisions' PMUs as one set.
   *
   * Only the ministry-officer branch consumes this. PMU members return earlier
   * and never gain a sibling team's board, so PMU isolation is unaffected.
   */
  pmuDivisionIds?: string[];
};

/**
 * Build the OR-of-visibility-clauses for a caller from an injected list
 * of divisions they head (direct headships + active delegations) and, for
 * PMU members, the ids of everyone in their PMU (themselves + teammates).
 *
 * Returns `null` for callers who read everything (see VisibilityScope) —
 * never a match-everything clause.
 *
 * There is no per-task privacy setting: a task belongs to a division, and
 * everyone who can read that division's board can read it. The old
 * `tasks.visibility` enum ('personal' | 'division') and the
 * `can_see_personal_tasks` grant that peered through it were removed on
 * 2026-09-17 — every task that existed then became readable by its division,
 * and none was deleted. The base clauses below still matter for reach ACROSS
 * a board boundary: a task you own, created, collaborate on, or were
 * @mentioned in stays readable even when its division is not yours.
 */
export function buildVisibilityClausesFrom(
  me: CallerSummary,
  headedDivisionIds: string[],
  pmuMemberIds: string[] = [],
  opts: VisibilityOptions = {},
): VisibilityScope {
  const clauses: Prisma.TaskWhereInput[] = [
    // Always: tasks I own.
    { ownerId: me.id },
    // Always: tasks I'm explicitly added to as a collaborator.
    { collaborators: { some: { userId: me.id } } },
    // Always: tasks I created — so the creator keeps sight of one after
    // handing it to someone else, or after moving division.
    { createdById: me.id },
    // Always: tasks where someone @mentioned me in the discussion. Pulling a
    // colleague into a conversation has to let them read what it is about —
    // without this the notification pointed at a task they could not open.
    //
    // A base clause on purpose: it sits above every role branch, so it reaches
    // a mentioned user whatever their slot, including the PMU and JS branches
    // that return before the division clauses. `resolveMentions` only resolves
    // a handle belonging to someone who may take part in the task, so this
    // widens sight by explicit invitation, never by guessing a name.
    { comments: { some: { mentions: { has: me.id } } } },
  ];

  // A PMU team leader additionally sees their PMU team's tasks (owner-scoped)
  // — the read side of their team-admin scope. Empty for everyone else, so
  // this is inert outside that role.
  if (opts.pmuTeamLeaderMemberIds && opts.pmuTeamLeaderMemberIds.length > 0) {
    clauses.push({ ownerId: { in: opts.pmuTeamLeaderMemberIds } });
  }

  if (me.isSuperAdmin || me.hierarchySlot === 'osd') {
    // Super Admin + OSD read every task across the ministry — unrestricted,
    // so no filter at all rather than a filter that tries to mean "any task".
    // The base clauses above are a subset of everything, so dropping them here
    // loses nothing.
    return null;
  }

  // The caller's member divisions (home + admin-granted extras). The EXTRA
  // grants (member set minus home) widen every role's board; home is added only
  // in the officer branch, so PMU isolation and the JS surface are preserved
  // for callers with no extra grants.
  const memberDivisionIds = opts.memberDivisionIds ?? [me.divisionId];
  const extraDivisionIds = memberDivisionIds.filter((d) => d !== me.divisionId);

  const divisionIds = new Set(headedDivisionIds);
  for (const d of extraDivisionIds) divisionIds.add(d);

  if (me.hierarchySlot === 'js') {
    // JS sees own + the JS Priority Board surface, plus any division they head
    // or hold a delegation for, plus any admin-granted extra division board.
    clauses.push({ jsPriorityLane: { not: null } });
    if (divisionIds.size > 0) {
      clauses.push({ divisionId: { in: [...divisionIds] } });
    }
    return clauses;
  }

  if (me.isPmu) {
    // PMU isolation (PERMISSIONS.md §5.2): a PMU team member sees the
    // tasks of their own PMU — those owned by anyone in the PMU
    // (themselves + teammates) — but never the division's internal
    // ministry tasks. A delegation still grants head-level visibility
    // over the delegated division.
    if (pmuMemberIds.length > 0) {
      clauses.push({ ownerId: { in: pmuMemberIds } });
    }
    // Tasks a PMU team leader explicitly shared with the whole PMU team.
    // Live: matches any current member of the caller's PMU at read time.
    // The PMU's home-division head is excluded (they already see it via the
    // owner-scoped clause; it is just not treated as a whole-team share).
    if (me.pmuId && !opts.isPmuParentDivisionHead) {
      clauses.push({ sharedWithPmuTeam: true, divisionId: me.pmuId });
    }
    // The other direction of the same switch: a task on the PARENT division's
    // own board, which the head opted to show to the division's PMU team(s).
    // This is the one deliberate hole in PMU isolation — without the flag a
    // PMU member never sees an internal ministry task, and the flag is a head
    // power (canSharePmuTeam), so the hole is opened per task by the person
    // who owns that board. Everything else about isolation is unchanged.
    if (opts.pmuParentDivisionId) {
      clauses.push({ sharedWithPmuTeam: true, divisionId: opts.pmuParentDivisionId });
    }
    if (divisionIds.size > 0) {
      clauses.push({ divisionId: { in: [...divisionIds] } });
    }
    return clauses;
  }

  // Ministry officers (director down to ASO) — every task in every division
  // they are a MEMBER of (home + admin-granted extras), plus every division
  // they head. Without the home-division clause a fresh division user saw an
  // empty board on first login.
  divisionIds.add(me.divisionId);
  // A division's PMUs count as part of it here: an officer of Khelo India reads
  // the KI PMU's board too. This is the read side of a rule the create side
  // already applies, and of PERMISSIONS.md's "ministry officers in a division
  // can see their PMU's tasks".
  for (const d of opts.pmuDivisionIds ?? []) divisionIds.add(d);
  clauses.push({ divisionId: { in: [...divisionIds] } });

  return clauses;
}
