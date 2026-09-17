/**
 * Tasks list — the Group-by-division view rule.
 *
 * Pure and prisma-free so the page (a Server Component) and the unit tests
 * share one rule — the same split as reports-shared.ts vs the report route.
 *
 * **Everyone lands on the division board.** There is no per-role gate: the
 * division card carries the Notice board, the sub-division / PMU filter pills,
 * the Daily / Weekly / FortNight / Monthly / Watchlist lane board and the
 * per-division completed list, and every one of those is already permissioned
 * per user — `canEditDivisionNotice` for the notice, `canSetJsPriorityLane`
 * for the lane pills, `canManageTask` / contributor rights for Latest status.
 * A reader who may change none of it still gets the far better read of their
 * division's work than a wall of cards gave them.
 *
 * The gate was narrowed three times as roles were added (leadership, then
 * division heads on 2026-09-17, then PMU members via a separate segment
 * layout) before landing here: one design for everyone, 2026-09-17.
 *
 * `?group=none` is the explicit opt-out, and still honoured for anyone who
 * links in with it.
 */

/** What `?group=` may say. Absent means "use the caller's default". */
export type TaskGroupParam = string | undefined | null;

/**
 * Whether the tasks list renders grouped by division.
 *
 * Tri-state on purpose. The list opens grouped for everyone, but a reader must
 * still be able to switch it off. With only "present or absent" to work with,
 * switching off would drop the param and immediately re-apply the default,
 * leaving the control stuck. So:
 *
 *   'division' → grouped        (explicit on)
 *   'none'     → flat           (explicit off)
 *   absent     → `defaultGrouped`
 *
 * An explicit param always beats the default. Matches the 'none' | 'division'
 * vocabulary the Timeline Files list already uses for its own group param.
 */
export function resolveGroupByDivision(
  group: TaskGroupParam,
  defaultGrouped: boolean,
): boolean {
  if (group === 'division') return true;
  if (group === 'none') return false;
  return defaultGrouped;
}
