/**
 * Tasks list — the Group-by-division view rule, client-safe.
 *
 * Kept free of any server-only import so the server page
 * (src/app/(app)/tasks/page.tsx) and the client control
 * (tasks/_components/DivisionControls.tsx) resolve the view from ONE rule.
 * They used to duplicate it, which risks the button lighting up out of step
 * with the list it controls.
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
 * The value the toggle should write when flipping to `next`. Turning grouping
 * off is written explicitly as 'none' when it is on by default; otherwise the
 * param is cleared (empty string) to keep the URL clean.
 */
export function groupParamFor(next: boolean, defaultGrouped: boolean): string {
  if (next) return 'division';
  return defaultGrouped ? 'none' : '';
}
