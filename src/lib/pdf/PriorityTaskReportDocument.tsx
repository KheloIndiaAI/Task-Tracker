import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';

import type { ReportDivisionGroup, ReportTask } from '@/lib/reports';
import { REPORT_CADENCES, REPORT_CADENCE_LABEL, type ReportCadence } from '@/lib/reports-shared';
import { REPORT_COLOURS, divisionWash } from './colors';

/**
 * The Priority Task Report PDF — two layouts over the same fetched data,
 * chosen by the caller (the route handler) from the "Status include" /
 * "JS Comment include" checkboxes in the filter dialog:
 *
 *   - 'detailed' — grouped visually by division then priority: the division
 *     name and each priority label print once, as a heading above the rows
 *     they cover, instead of repeating on every row. Picked the moment
 *     either checkbox is on, since Status/JS Comment only make sense next
 *     to their own task.
 *   - 'compact'  — one row per division, tasks bucketed into Daily / Weekly /
 *     Fortnightly / Monthly columns as numbered name lists, narrowed to just
 *     the chosen priorities when one or more are selected. The default when
 *     neither checkbox is on — the crisp, at-a-glance view.
 *
 * The division/priority headings deliberately do NOT use a stretched
 * side-rail cell (a cell whose height is derived from a sibling subtree of
 * unbounded, paginating rows) — an earlier version did, and it made
 * @react-pdf/renderer's layout pass hang on a division with real-world scale
 * (50+ tasks): the side-rail's height depends on its sibling's paginated
 * height, and the sibling's pagination in turn depends on the side-rail —
 * exactly the kind of circular flex constraint Yoga struggles with. A
 * heading printed once above naturally-flowing rows needs no such
 * dependency, and the coloured left border + wash on the surrounding
 * section still carries the division's colour onto every page it spans.
 *
 * Unscheduled tasks (scope "All tasks", no lane) never share either layout's
 * main table/grid — mixing them in as a "Not scheduled" row or column reads
 * as clutter next to the real priorities. Instead, when there are any, they
 * print in their own division-grouped section starting on a fresh page.
 *
 * Column headers and the page title print once, at the top of each
 * section — not repeated per page. @react-pdf/renderer's `fixed` elements
 * replay at the Y-offset they first occupied on the page they start on, so a
 * fixed header placed after a one-time hero block leaves a blank gap of that
 * same height on every later page. A single header plus a fixed page-number
 * footer (which anchors to the page bottom, independent of flow) avoids that
 * without the complexity of a hand-rolled repeating-header workaround.
 */

export type PriorityTaskReportProps = {
  groups: ReportDivisionGroup[];
  layout: 'detailed' | 'compact';
  /** Empty = every priority — the compact grid then shows all four columns. */
  selectedPriorities: ReportCadence[];
  /** Whether unscheduled tasks are in scope — they get their own page, grouped by division, when true. */
  includeUnscheduled: boolean;
  includeStatus: boolean;
  includeJsComment: boolean;
  /** Pre-formatted IST date/time, e.g. "13 Sep 2026, 4:05 pm" — formatting policy lives with the caller. */
  generatedAtLabel: string;
};

const C = REPORT_COLOURS;
const DIVISION_WASH_ALPHA = 0.12;

const styles = StyleSheet.create({
  page: {
    padding: 32,
    paddingBottom: 44,
    fontFamily: 'Manrope',
    fontSize: 9,
    color: C.ink,
    backgroundColor: C.page,
  },
  title: { fontSize: 19, fontWeight: 700, color: C.ink },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: C.ink, marginBottom: 10 },
  metaLine: { fontSize: 8, color: C.ink3, marginTop: 5 },
  headerRule: {
    borderBottomWidth: 1.5,
    borderBottomColor: C.ink,
    marginTop: 12,
    marginBottom: 10,
  },
  footer: {
    position: 'absolute',
    left: 32,
    right: 32,
    bottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7.5,
    color: C.ink3,
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingTop: 6,
  },
  emptyState: {
    marginTop: 24,
    padding: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: C.line,
    borderRadius: 4,
    fontSize: 9.5,
    color: C.ink3,
    textAlign: 'center',
  },

  // ---- Detailed table (and Not-scheduled detailed section) ----
  colHeadRow: { flexDirection: 'row', paddingBottom: 5, paddingLeft: 11 },
  colHead: { fontSize: 7.5, fontWeight: 600, color: C.ink3, letterSpacing: 0.5 },
  divisionSection: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    paddingVertical: 8,
    marginBottom: 6,
  },
  divisionHeading: { fontSize: 11, fontWeight: 700, color: C.ink },
  priorityHeading: {
    fontSize: 7.5,
    fontWeight: 600,
    color: C.ink3,
    letterSpacing: 0.5,
    marginTop: 7,
    marginBottom: 2,
  },
  taskRow: { flexDirection: 'row', paddingVertical: 4, alignItems: 'flex-start' },
  cellTask: { flex: 3, fontSize: 9, color: C.ink, paddingRight: 6 },
  cellText: { flex: 1.6, fontSize: 8.5, color: C.ink2, paddingRight: 6 },

  // ---- Compact grid ----
  gridHeadRow: { flexDirection: 'row', paddingBottom: 6 },
  gridDivisionHead: { flex: 1.1, fontSize: 7.5, fontWeight: 600, color: C.ink3, letterSpacing: 0.5 },
  gridColHead: { flex: 1, fontSize: 7.5, fontWeight: 600, color: C.ink3, letterSpacing: 0.5, paddingLeft: 8 },
  gridRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.line2,
  },
  gridDivisionCell: { flex: 1.1, flexDirection: 'row', alignItems: 'flex-start' },
  gridStrip: { width: 3, marginRight: 7, borderRadius: 1.5 },
  gridDivisionName: { fontSize: 9.5, fontWeight: 600, color: C.ink },
  gridDivisionCount: { fontSize: 7.5, color: C.ink3, marginTop: 2 },
  gridCell: { flex: 1, paddingLeft: 8 },
  gridCellEmpty: { fontSize: 8.5, color: C.ink3 },
  gridItem: { fontSize: 8.5, color: C.ink, marginBottom: 3 },

  // ---- Not-scheduled (compact) ----
  notSchedRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.line2,
  },
  notSchedDivisionCell: { width: 130, flexDirection: 'row', alignItems: 'flex-start' },
  notSchedList: { flex: 1, paddingLeft: 8 },
});

export function PriorityTaskReportDocument({
  groups,
  layout,
  selectedPriorities,
  includeUnscheduled,
  includeStatus,
  includeJsComment,
  generatedAtLabel,
}: PriorityTaskReportProps) {
  const totalTasks = groups.reduce((n, g) => n + g.tasks.length, 0);
  const unscheduledGroups = includeUnscheduled
    ? groups
        .map((g) => ({ ...g, tasks: g.tasks.filter((t) => t.cadence === null) }))
        .filter((g) => g.tasks.length > 0)
    : [];

  return (
    <Document title="Priority Task Report">
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.title}>Priority Task Report</Text>
        <Text style={styles.metaLine}>Generated {generatedAtLabel}</Text>
        <View style={styles.headerRule} />

        {totalTasks === 0 ? (
          <Text style={styles.emptyState}>No tasks match the selected filters.</Text>
        ) : layout === 'detailed' ? (
          <DetailedTable groups={groups} includeStatus={includeStatus} includeJsComment={includeJsComment} />
        ) : (
          <CompactGrid groups={groups} selectedPriorities={selectedPriorities} />
        )}

        {unscheduledGroups.length > 0 ? (
          <View break>
            <Text style={styles.sectionTitle}>Not scheduled tasks</Text>
            {layout === 'detailed' ? (
              <NotScheduledDetailed
                groups={unscheduledGroups}
                includeStatus={includeStatus}
                includeJsComment={includeJsComment}
              />
            ) : (
              <NotScheduledCompact groups={unscheduledGroups} />
            )}
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>Priority Task Report</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// ------------------------------------------------------------
// Shared grouping helper
// ------------------------------------------------------------

type PriorityGroup = { priority: ReportCadence; tasks: ReportTask[] };

/** Buckets a division's SCHEDULED tasks by priority, canonical order, empty buckets dropped. */
function groupByPriority(tasks: ReportTask[]): PriorityGroup[] {
  return REPORT_CADENCES.map((c) => ({
    priority: c,
    tasks: tasks.filter((t) => t.cadence === c).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((pg) => pg.tasks.length > 0);
}

function TaskRow({
  task,
  includeStatus,
  includeJsComment,
}: {
  task: ReportTask;
  includeStatus: boolean;
  includeJsComment: boolean;
}) {
  return (
    <View style={styles.taskRow} wrap={false}>
      <Text style={styles.cellTask}>{task.name}</Text>
      {includeStatus ? <Text style={styles.cellText}>{task.latestStatus?.trim() || '—'}</Text> : null}
      {includeJsComment ? <Text style={styles.cellText}>{task.jsComment?.trim() || '—'}</Text> : null}
    </View>
  );
}

function DetailedColumnHead({ includeStatus, includeJsComment }: { includeStatus: boolean; includeJsComment: boolean }) {
  return (
    <View style={styles.colHeadRow}>
      <Text style={[styles.colHead, { flex: 3 }]}>TASK</Text>
      {includeStatus ? <Text style={[styles.colHead, { flex: 1.6 }]}>STATUS</Text> : null}
      {includeJsComment ? <Text style={[styles.colHead, { flex: 1.6 }]}>JS COMMENT</Text> : null}
    </View>
  );
}

// ------------------------------------------------------------
// Detailed table — grouped by division, then priority. Each name prints
// once as a heading; see the file-level doc comment for why this avoids a
// stretched side-rail.
// ------------------------------------------------------------

function DetailedTable({
  groups,
  includeStatus,
  includeJsComment,
}: {
  groups: ReportDivisionGroup[];
  includeStatus: boolean;
  includeJsComment: boolean;
}) {
  const divisions = groups
    .map((g) => ({ ...g, priorityGroups: groupByPriority(g.tasks) }))
    .filter((g) => g.priorityGroups.length > 0);

  return (
    <View>
      <DetailedColumnHead includeStatus={includeStatus} includeJsComment={includeJsComment} />

      {divisions.map((g) => (
        <View
          key={g.divisionId}
          style={[styles.divisionSection, { borderLeftColor: g.colour, backgroundColor: divisionWash(g.colour, DIVISION_WASH_ALPHA) }]}
        >
          <Text style={styles.divisionHeading}>{g.divisionName}</Text>
          {g.priorityGroups.map((pg) => (
            <View key={pg.priority}>
              <Text style={styles.priorityHeading}>{REPORT_CADENCE_LABEL[pg.priority].toUpperCase()}</Text>
              {pg.tasks.map((t) => (
                <TaskRow key={t.id} task={t} includeStatus={includeStatus} includeJsComment={includeJsComment} />
              ))}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ------------------------------------------------------------
// Not scheduled — detailed variant. Same division heading, but flat (no
// priority sub-groups — every row here is already "Not scheduled",
// repeating that label per row would be the exact clutter this whole
// change removes, and the section heading already says so once).
// ------------------------------------------------------------

function NotScheduledDetailed({
  groups,
  includeStatus,
  includeJsComment,
}: {
  groups: ReportDivisionGroup[];
  includeStatus: boolean;
  includeJsComment: boolean;
}) {
  return (
    <View>
      <DetailedColumnHead includeStatus={includeStatus} includeJsComment={includeJsComment} />

      {groups.map((g) => {
        const tasks = [...g.tasks].sort((a, b) => a.name.localeCompare(b.name));
        return (
          <View
            key={g.divisionId}
            style={[styles.divisionSection, { borderLeftColor: g.colour, backgroundColor: divisionWash(g.colour, DIVISION_WASH_ALPHA) }]}
          >
            <Text style={styles.divisionHeading}>{g.divisionName}</Text>
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} includeStatus={includeStatus} includeJsComment={includeJsComment} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------
// Compact grid — one row per division, tasks bucketed by priority.
// Unscheduled tasks never appear here — see NotScheduledCompact. This
// layout was already proven safe at scale (a single row's siblings stretch
// against each other, not against a paginating subtree), so it keeps its
// existing structure.
// ------------------------------------------------------------

function gridColumns(selectedPriorities: ReportCadence[]): ReportCadence[] {
  return selectedPriorities.length > 0 ? selectedPriorities : [...REPORT_CADENCES];
}

function tasksForColumn(tasks: ReportTask[], key: ReportCadence): ReportTask[] {
  return tasks.filter((t) => t.cadence === key).sort((a, b) => a.name.localeCompare(b.name));
}

function CompactGrid({
  groups,
  selectedPriorities,
}: {
  groups: ReportDivisionGroup[];
  selectedPriorities: ReportCadence[];
}) {
  const columns = gridColumns(selectedPriorities);

  return (
    <View>
      <View style={styles.gridHeadRow}>
        <Text style={styles.gridDivisionHead}>DIVISION</Text>
        {columns.map((c) => (
          <Text key={c} style={styles.gridColHead}>
            {REPORT_CADENCE_LABEL[c].toUpperCase()}
          </Text>
        ))}
      </View>

      {groups.map((g) => (
        <View
          key={g.divisionId}
          style={[styles.gridRow, { backgroundColor: divisionWash(g.colour, DIVISION_WASH_ALPHA) }]}
        >
          <View style={styles.gridDivisionCell}>
            <View style={[styles.gridStrip, { backgroundColor: g.colour }]} />
            <View>
              <Text style={styles.gridDivisionName}>{g.divisionName}</Text>
              <Text style={styles.gridDivisionCount}>
                {g.tasks.length} {g.tasks.length === 1 ? 'task' : 'tasks'}
              </Text>
            </View>
          </View>
          {columns.map((c) => {
            const items = tasksForColumn(g.tasks, c);
            return (
              <View key={c} style={styles.gridCell}>
                {items.length === 0 ? (
                  <Text style={styles.gridCellEmpty}>—</Text>
                ) : (
                  items.map((t, i) => (
                    <Text key={t.id} style={styles.gridItem}>
                      {i + 1}. {t.name}
                    </Text>
                  ))
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ------------------------------------------------------------
// Not scheduled — compact variant: Division + a single numbered list.
// ------------------------------------------------------------

function NotScheduledCompact({ groups }: { groups: ReportDivisionGroup[] }) {
  return (
    <View>
      {groups.map((g) => {
        const tasks = [...g.tasks].sort((a, b) => a.name.localeCompare(b.name));
        return (
          <View
            key={g.divisionId}
            style={[styles.notSchedRow, { backgroundColor: divisionWash(g.colour, DIVISION_WASH_ALPHA) }]}
          >
            <View style={styles.notSchedDivisionCell}>
              <View style={[styles.gridStrip, { backgroundColor: g.colour }]} />
              <View>
                <Text style={styles.gridDivisionName}>{g.divisionName}</Text>
                <Text style={styles.gridDivisionCount}>
                  {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
                </Text>
              </View>
            </View>
            <View style={styles.notSchedList}>
              {tasks.map((t, i) => (
                <Text key={t.id} style={styles.gridItem}>
                  {i + 1}. {t.name}
                </Text>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}
