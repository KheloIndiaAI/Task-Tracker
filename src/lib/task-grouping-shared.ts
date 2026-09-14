/**
 * Tasks list — the Group-by-division view rule.
 *
 * Grouping no longer has an on-page toggle (removed by request — it only
 * ever showed the state that was already the default), but the tri-state
 * `?group=` param this resolves is still honoured for anyone who links in
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
