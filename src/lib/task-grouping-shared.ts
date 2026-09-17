/**
 * Tasks list — the Group-by-division view rules: who may see the grouped view,
 * who lands on it, and how an explicit `?group=` param overrides both.
 *
 * Pure and prisma-free so the page (a Server Component) and the unit tests
 * share one rule — the same split as reports-shared.ts vs the report route.
 *
 * Grouping no longer has an on-page toggle (removed by request — it only
 * ever showed the state that was already the default), but the tri-state
 * `?group=` param resolved below is still honoured for anyone who links in
 * with it explicitly.
 */

/** What `?group=` may say. Absent means "use the caller's default". */
export type TaskGroupParam = string | undefined | null;

/**
 * Whether the tasks list renders grouped by division.
 *
 * Tri-state on purpose. A Super Admin opens the list grouped — their remit is
 * cross-division, so one flat ministry-wide pile is the wrong first screen —
 * but they must still be able to switch it off. With only "present or absent"
 * to work with, switching off would drop the param and immediately re-apply the
 * default, leaving the button stuck. So:
 *
 *   'division' → grouped        (explicit on)
 *   'none'     → flat           (explicit off)
 *   absent     → `defaultGrouped`
 *
 * An explicit param always beats the default, so the toggle always wins.
 * Matches the 'none' | 'division' vocabulary the Timeline Files list already
 * uses for its own group param.
 */
export function resolveGroupByDivision(
  group: TaskGroupParam,
  defaultGrouped: boolean,
): boolean {
  if (group === 'division') return true;
  if (group === 'none') return false;
  return defaultGrouped;
}

/**
 * The caller facts the two rules below need. Same shape as
 * `canAccessReportGeneration`'s inputs — a thin slice of the user row plus the
 * two division sets `src/lib/rbac` resolves, kept separate as always:
 *   - `headedDivisionIds` — head powers (direct headship + active delegation)
 *   - `memberDivisionIds` — home division + admin-granted extras
 */
export type TaskGroupingActor = {
  isSuperAdmin: boolean;
  hierarchySlot: string;
  headedDivisionIds: string[];
  memberDivisionIds: string[];
};

/**
 * Whether the grouped-by-division view is available to this caller at all.
 *
 * Grouping is what carries the whole division-card surface — the Notice board,
 * the sub-division / PMU filter pills, the Daily / Weekly / FortNight / Monthly
 * / Watchlist lane board with its inline Latest status and JS Comment rows, and
 * the per-division completed list. The flat three-segment list has none of it.
 *
 * Offered to:
 *   - leadership (Super Admin / OSD / JS), whose remit is cross-division;
 *   - any division head — direct headship or an active delegation. A head
 *     already curates that division's lanes (`canSetJsPriorityLane`), edits its
 *     Notice board (`canEditDivisionNotice`) and generates its report
 *     (`canAccessReportGeneration`); without grouping, none of those controls
 *     had anywhere to appear. Same `headedDivisionIds.length > 0` predicate the
 *     report button uses, so the two can never disagree;
 *   - any multi-division member, whose flat list already spans more than one
 *     division and so reads better split by it.
 *
 * A single-division non-head's `?group=division` is ignored — there is nothing
 * to group.
 */
export function canGroupTasksByDivision(actor: TaskGroupingActor): boolean {
  return (
    actor.isSuperAdmin ||
    actor.hierarchySlot === 'osd' ||
    actor.hierarchySlot === 'js' ||
    actor.headedDivisionIds.length > 0 ||
    actor.memberDivisionIds.length > 1
  );
}

/**
 * Whether /tasks OPENS grouped for this caller, with no `?group=` param.
 *
 * Leadership and division heads land on the division board, because for them
 * it is the working surface rather than an alternate layout. A multi-division
 * member may group (above) but still opens flat: their own tasks, not a board
 * they run, are what they came for.
 *
 * Always a subset of `canGroupTasksByDivision` — never default someone into a
 * view they cannot have.
 */
export function opensTasksGrouped(actor: TaskGroupingActor): boolean {
  return (
    actor.isSuperAdmin ||
    actor.hierarchySlot === 'osd' ||
    actor.hierarchySlot === 'js' ||
    actor.headedDivisionIds.length > 0
  );
}
