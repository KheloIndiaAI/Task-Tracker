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
export type VisibilityOptions = {
  /**
   * True when the caller is the head of their PMU's home (parent) division.
   * That head is excluded from the "shared with the PMU team" clause — they
   * still see such a task via the owner-scoped PMU clause, but it is not
   * surfaced to them as a whole-team share.
   */
  isPmuParentDivisionHead?: boolean;
  /**
   * Divisions the caller is a MEMBER of: their home division plus any
   * admin-granted extra divisions (user_division_access). Grants FULL board
   * visibility of each division's non-personal tasks. The home division is
   * handled per role — an officer always sees their home board, a PMU member
   * does NOT (PMU isolation is preserved), and a JS user sees the priority
   * board rather than a home board — so only the EXTRA granted divisions widen
   * the JS/PMU branches. Defaults to [me.divisionId] (home-only) when omitted.
   * Populated by buildVisibilityClauses; this replaces the retired
   * cross-division allocation-link visibility.
   */
  memberDivisionIds?: string[];
  /**
   * When the caller is a PMU team leader, the ids of their PMU team (see
   * `getPmuTeamMemberIds`). Grants owner-scoped visibility of the team's
   * (non-personal) tasks so the leader can oversee and manage them — the read
   * side of their PMU-team admin scope. Empty/omitted for everyone else.
   */
  pmuTeamLeaderMemberIds?: string[];
};

/**
 * Slots that read their division's PERSONAL tasks as well as its division
 * tasks. Deliberately a short list: leadership accountable for a division's
 * work, not the whole officer chain. Section Officer, ASO, PMU members and
 * Consultants are NOT here and see personal tasks only when they own them,
 * created them, or are a collaborator.
 *
 * Deputy Secretary, JS and HMYAS are intentionally absent — leadership
 * personal-task access was specified as Super Admin, OSD, Director, Under
 * Secretary and division heads (2026-09-07). Add them here if that widens.
 */
const LEADERSHIP_PERSONAL_SLOTS = new Set(['director', 'under_secretary']);

/**
 * Build the OR-of-visibility-clauses for a caller from an injected list
 * of divisions they head (direct headships + active delegations) and, for
 * PMU members, the ids of everyone in their PMU (themselves + teammates).
 *
 * Personal tasks are visible to: their owner, their creator, anyone added as a
 * collaborator (the three base clauses below) — and, since 2026-09-07, to
 * leadership over the division the task belongs to:
 *
 *   - Super Admin and OSD — every personal task, ministry-wide.
 *   - A division's head (direct or active delegate) — that division's.
 *   - Directors and Under Secretaries — their member divisions' (home +
 *     admin-granted extras).
 *
 * Everyone else — Section Officer, ASO, PMU members, Consultants — still sees
 * no one else's personal tasks. "Personal" now means "off the division board
 * and out of ministry-wide aggregates", not "invisible to my chain"; the tasks
 * list says so in as many words.
 */
export function buildVisibilityClausesFrom(
  me: CallerSummary,
  headedDivisionIds: string[],
  pmuMemberIds: string[] = [],
  opts: VisibilityOptions = {},
): Prisma.TaskWhereInput[] {
  const clauses: Prisma.TaskWhereInput[] = [
    // Always: tasks I own.
    { ownerId: me.id },
    // Always: tasks I'm explicitly added to as a collaborator.
    { collaborators: { some: { userId: me.id } } },
    // Personal tasks I created — so the creator keeps sight of a Personal
    // task even after assigning it to someone else. Scoped to `personal`
    // so it never widens division-task visibility (division tasks I created
    // are already covered by the role clauses below).
    { createdById: me.id, visibility: 'personal' },
  ];

  // A PMU team leader additionally sees their PMU team's non-personal tasks
  // (owner-scoped) — the read side of their team-admin scope. Empty for
  // everyone else, so this is inert outside that role. Personal tasks a
  // teammate owns stay private (the clause is `division`-scoped).
  if (opts.pmuTeamLeaderMemberIds && opts.pmuTeamLeaderMemberIds.length > 0) {
    clauses.push({
      visibility: 'division',
      ownerId: { in: opts.pmuTeamLeaderMemberIds },
    });
  }

  if (me.isSuperAdmin || me.hierarchySlot === 'osd') {
    // Super Admin + OSD see every task across the ministry — division AND
    // personal, in every division and PMU. Written as two explicit clauses
    // rather than one catch-all so the personal grant is impossible to miss
    // when reading this rule.
    clauses.push({ visibility: 'division' });
    clauses.push({ visibility: 'personal' });
    return clauses;
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
    clauses.push({
      visibility: 'division',
      jsPriorityLane: { not: null },
    });
    if (divisionIds.size > 0) {
      clauses.push({ visibility: 'division', divisionId: { in: [...divisionIds] } });
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
      clauses.push({ visibility: 'division', ownerId: { in: pmuMemberIds } });
    }
    // Tasks a PMU team leader explicitly shared with the whole PMU team.
    // Live: matches any current member of the caller's PMU at read time.
    // The PMU's home-division head is excluded (they already see it via the
    // owner-scoped clause; it is just not treated as a whole-team share).
    if (me.pmuId && !opts.isPmuParentDivisionHead) {
      clauses.push({
        visibility: 'division',
        sharedWithPmuTeam: true,
        divisionId: me.pmuId,
      });
    }
    if (divisionIds.size > 0) {
      clauses.push({ visibility: 'division', divisionId: { in: [...divisionIds] } });
    }
    return clauses;
  }

  // Ministry officers (director down to ASO) — all non-personal tasks in every
  // division they are a MEMBER of (home + admin-granted extras), plus every
  // division they head. Without the home-division clause a fresh division user
  // saw an empty board on first login.
  divisionIds.add(me.divisionId);
  clauses.push({ visibility: 'division', divisionId: { in: [...divisionIds] } });

  // Leadership additionally reads the PERSONAL tasks of the divisions they are
  // accountable for. Headship always carries it (whatever the head's slot);
  // a Director or Under Secretary gets it across their member divisions. Any
  // other slot lands here with an empty set and is unaffected.
  const personalDivisionIds = new Set(headedDivisionIds);
  if (LEADERSHIP_PERSONAL_SLOTS.has(me.hierarchySlot)) {
    for (const d of memberDivisionIds) personalDivisionIds.add(d);
  }
  if (personalDivisionIds.size > 0) {
    clauses.push({ visibility: 'personal', divisionId: { in: [...personalDivisionIds] } });
  }
  return clauses;
}
