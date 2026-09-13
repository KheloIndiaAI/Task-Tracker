/**
 * Priority Task Report — client-safe constants and the pure access rule.
 *
 * Kept free of any server-only import (no prisma) so client components (the
 * report button, the filter dialog) and the server route
 * (src/app/api/reports/priority-task/route.ts) share one rule — the same
 * split as business-cards-shared.ts (pure) vs business-cards.ts (db-backed).
 */

/**
 * Who may generate the Priority Task Report PDF from /tasks:
 *
 *   - Super Admin and OSD, by role.
 *   - Any division head — direct headship or an active delegation, i.e.
 *     `headedDivisionIds.length > 0` (the same set `canActAsHeadOf` draws on).
 *   - Any user carrying the Super-Admin-managed `can_generate_reports` grant
 *     (the "Report generation access" toggle on Users > Create / Edit).
 *
 * A head or grant-holder is NOT restricted to reporting on only their own
 * division — the report route scopes candidate tasks through the caller's
 * normal task visibility (buildVisibilityClauses) regardless of why this
 * function returned true, so "Division: All" in the filter dialog means "all
 * divisions this caller can already see", never the whole ministry for a
 * non-leadership grant-holder.
 */
export function canAccessReportGeneration(
  user: { isSuperAdmin: boolean; hierarchySlot: string; canGenerateReports: boolean },
  headedDivisionIds: string[],
): boolean {
  return (
    user.isSuperAdmin ||
    user.hierarchySlot === 'osd' ||
    headedDivisionIds.length > 0 ||
    user.canGenerateReports
  );
}

/** The four JS Priority lanes as report cadences, in display order. Reuses
 *  the board's own LaneKey values so the report and the board can never
 *  disagree about what a task's cadence is. */
export const REPORT_CADENCES = ['today', 'week', 'fortnight', 'month'] as const;
export type ReportCadence = (typeof REPORT_CADENCES)[number];

/**
 * Display labels for the report specifically. "Fortnightly" here, not the
 * app's own "FortNight" board label — a formal, printable document reads
 * better with the adjectival form; this is scoped to report output only; not
 * a rename of the board itself.
 */
export const REPORT_CADENCE_LABEL: Record<ReportCadence, string> = {
  today: 'Daily',
  week: 'Weekly',
  fortnight: 'Fortnightly',
  month: 'Monthly',
};

export function isReportCadence(v: string): v is ReportCadence {
  return (REPORT_CADENCES as readonly string[]).includes(v);
}
