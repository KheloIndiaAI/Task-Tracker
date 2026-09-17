import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { isMediaAndIt } from '@/lib/divisions';
import { buildVisibilityClauses, visibilityAnd, type CallerSummary } from '@/lib/visibility';
import { REPORT_CADENCES, type ReportCadence } from '@/lib/reports-shared';

export type ReportScope = 'scheduled' | 'all';

export type ReportFilters = {
  /** Empty = every division the caller can see. */
  divisionIds: string[];
  /**
   * Empty = every priority. Choosing one or more here is a precise filter —
   * it already implies "scheduled with this priority", so it overrides
   * `scope` (there is no such thing as an unscheduled task that also carries
   * a priority). `scope` only governs whether unscheduled tasks are included
   * when NO priority is chosen.
   */
  priorities: ReportCadence[];
  /** 'scheduled' = only tasks carrying a JS Priority lane; 'all' = every
   *  matching task, with unscheduled ones grouped under a "Not scheduled"
   *  priority of their own (cadence: null on the row). Ignored once
   *  `priorities` is non-empty. */
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
 * place. Leaving Division unchecked in the filter dialog therefore means
 * "every division this caller can see", not the whole ministry for a
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

  // One or more chosen priorities narrows to exactly those lanes; otherwise
  // `scope` decides whether unscheduled tasks (a null lane) are in play.
  const laneCondition: Prisma.TaskWhereInput['jsPriorityLane'] | undefined =
    filters.priorities.length > 0
      ? { in: filters.priorities }
      : filters.scope === 'scheduled'
        ? { not: null }
        : undefined;

  const where: Prisma.TaskWhereInput = {
    archivedAt: null,
    parentTaskId: null,
    // Matches the list's own "Active tasks" default — a priority report is
    // about ongoing work, not a record of what is already finished.
    status: { not: 'completed' },
    AND: visibilityAnd(visibilityClauses),
    ...(filters.divisionIds.length > 0 ? { divisionId: { in: filters.divisionIds } } : {}),
    ...(laneCondition ? { jsPriorityLane: laneCondition } : {}),
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
