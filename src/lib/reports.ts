import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { isMediaAndIt } from '@/lib/divisions';
import { buildVisibilityClauses, type CallerSummary } from '@/lib/visibility';
import { REPORT_CADENCES, type ReportCadence } from '@/lib/reports-shared';

export type ReportScope = 'scheduled' | 'all';

export type ReportFilters = {
  /** null = every division the caller can see. */
  divisionId: string | null;
  /** null = all four cadences. */
  cadence: ReportCadence | null;
  /** 'scheduled' = only tasks carrying a JS Priority lane; 'all' = every
   *  matching task, with unscheduled ones grouped under a "Not scheduled"
   *  cadence of their own (cadence: null on the row). */
  scope: ReportScope;
  includeStatus: boolean;
  includeJsComment: boolean;
};

export type ReportTask = {
  id: string;
  name: string;
  /** null only ever appears when scope === 'all' — an unscheduled task. */
  cadence: ReportCadence | null;
  latestStatus: string | null;
  jsComment: string | null;
};

export type ReportDivisionGroup = {
  divisionId: string;
  divisionName: string;
  colour: string;
  tasks: ReportTask[];
};

type SortableGroup = ReportDivisionGroup & { kind: string; displayOrder: number };

function divisionGroupRank(kind: string, name: string): number {
  if (kind === 'pmu') return 2;
  if (isMediaAndIt(name)) return 1;
  return 0;
}

/**
 * Fetch and group the tasks for the Priority Task Report.
 *
 * Scoped through `buildVisibilityClauses` — the exact same scoper the tasks
 * list, search, and calendar already use — so the report can never surface a
 * task the caller could not otherwise see, regardless of which of the three
 * grants (Super Admin / OSD, division head, or the explicit
 * can_generate_reports flag) let them open the report dialog in the first
 * place. "Division: All" in the filter dialog therefore means "every
 * division this caller can see", not the whole ministry for a
 * non-leadership grant-holder.
 *
 * Grouping and division ordering mirror groupTasksByDivision in
 * tasks/page.tsx (Media & IT sinks below the other divisions, PMUs follow
 * it) so a report generated here reads the same way the live board does.
 */
export async function fetchReportDivisionGroups(
  me: CallerSummary,
  filters: ReportFilters,
): Promise<ReportDivisionGroup[]> {
  const visibilityClauses = await buildVisibilityClauses(me);

  const where: Prisma.TaskWhereInput = {
    archivedAt: null,
    parentTaskId: null,
    // Matches the list's own "Active tasks" default — a priority report is
    // about ongoing work, not a record of what is already finished.
    status: { not: 'completed' },
    OR: visibilityClauses,
    ...(filters.divisionId ? { divisionId: filters.divisionId } : {}),
    ...(filters.scope === 'scheduled' ? { jsPriorityLane: { not: null } } : {}),
    ...(filters.cadence ? { jsPriorityLane: filters.cadence } : {}),
  };

  const tasks = await prisma.task.findMany({
    where,
    select: {
      id: true,
      name: true,
      jsPriorityLane: true,
      latestStatus: true,
      jsComment: true,
      divisionId: true,
      division: {
        select: { name: true, avatarColour: true, kind: true, displayOrder: true },
      },
    },
    orderBy: [{ division: { displayOrder: 'asc' } }, { name: 'asc' }],
  });

  const map = new Map<string, SortableGroup>();
  for (const t of tasks) {
    let group = map.get(t.divisionId);
    if (!group) {
      group = {
        divisionId: t.divisionId,
        divisionName: t.division.name,
        colour: t.division.avatarColour,
        kind: t.division.kind,
        displayOrder: t.division.displayOrder,
        tasks: [],
      };
      map.set(t.divisionId, group);
    }
    const lane = t.jsPriorityLane;
    const cadence: ReportCadence | null = lane && (REPORT_CADENCES as readonly string[]).includes(lane)
      ? (lane as ReportCadence)
      : null;
    group.tasks.push({
      id: t.id,
      name: t.name,
      cadence,
      latestStatus: t.latestStatus,
      jsComment: t.jsComment,
    });
  }

  return Array.from(map.values()).sort((a, b) => {
    const ra = divisionGroupRank(a.kind, a.divisionName);
    const rb = divisionGroupRank(b.kind, b.divisionName);
    if (ra !== rb) return ra - rb;
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
    return a.divisionName.localeCompare(b.divisionName);
  });
}
