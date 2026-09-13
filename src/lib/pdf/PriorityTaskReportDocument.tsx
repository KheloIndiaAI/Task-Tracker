import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';

import type { ReportDivisionGroup, ReportTask } from '@/lib/reports';
import { REPORT_CADENCES, REPORT_CADENCE_LABEL, type ReportCadence } from '@/lib/reports-shared';
import { REPORT_COLOURS, divisionWash } from './colors';

/**
 * The Priority Task Report PDF — two layouts over the same fetched data,
 * chosen by the caller (the route handler) from the "Status include" /
 * "JS Comment include" checkboxes in the filter dialog:
 *
 *   - 'detailed' — one row per task: Division · Priority · Task · (Status) ·
 *     (JS Comment). Picked the moment either checkbox is on, since those
 *     columns only make sense next to their own task.
 *   - 'compact'  — one row per division, tasks bucketed into Daily / Weekly /
 *     Fortnightly / Monthly (+ Not scheduled, when the scope is "All tasks")
 *     columns as numbered name lists, narrowed to just the chosen priorities
 *     when one or more are selected. The default when neither checkbox is
 *     on — the crisp, at-a-glance view.
 *
 * Column headers and the filter summary print once, at the top — not
 * repeated per page. @react-pdf/renderer's `fixed` elements replay at the
 * Y-offset they first occupied on page 1, so a fixed header placed after a
 * one-time hero block leaves a blank gap of that same height on every later
 * page. A single header plus a fixed page-number footer (which anchors to
 * the page bottom, independent of flow) avoids that without the complexity
 * of a hand-rolled repeating-header workaround.
 */

export type PriorityTaskReportProps = {
  groups: ReportDivisionGroup[];
  layout: 'detailed' | 'compact';
  /** Empty = every priority — the compact grid then shows all four columns. */
  selectedPriorities: ReportCadence[];
  /** Whether "Not scheduled" tasks are in scope — adds the 5th compact column. */
  includeUnscheduled: boolean;
  includeStatus: boolean;
  includeJsComment: boolean;
  /** Pre-formatted IST date/time, e.g. "13 Sep 2026, 4:05 pm" — formatting policy lives with the caller. */
  generatedAtLabel: string;
};

const C = REPORT_COLOURS;

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

  // ---- Detailed table ----
  colHeadRow: {
    flexDirection: 'row',
    paddingBottom: 5,
  },
  colHead: {
    fontSize: 7.5,
    fontWeight: 600,
    color: C.ink3,
    letterSpacing: 0.5,
  },
  detailRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.line2,
  },
  strip: { width: 3, marginRight: 7, borderRadius: 1.5 },
  cellDivision: { flex: 0.9, fontSize: 9, fontWeight: 500, color: C.ink, paddingRight: 6 },
  cellCadence: { flex: 0.85, fontSize: 8.5, color: C.ink2, paddingRight: 6 },
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
  gridDivisionName: { fontSize: 9.5, fontWeight: 600, color: C.ink },
  gridDivisionCount: { fontSize: 7.5, color: C.ink3, marginTop: 2 },
  gridCell: { flex: 1, paddingLeft: 8 },
  gridCellEmpty: { fontSize: 8.5, color: C.ink3 },
  gridItem: { fontSize: 8.5, color: C.ink, marginBottom: 3 },
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
          <CompactGrid
            groups={groups}
            selectedPriorities={selectedPriorities}
            includeUnscheduled={includeUnscheduled}
          />
        )}

        <View style={styles.footer} fixed>
          <Text>Priority Task Report</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// ------------------------------------------------------------
// Detailed table — one row per task
// ------------------------------------------------------------

function cadenceRank(c: ReportCadence | null): number {
  if (c === null) return REPORT_CADENCES.length;
  return REPORT_CADENCES.indexOf(c);
}

function DetailedTable({
  groups,
  includeStatus,
  includeJsComment,
}: {
  groups: ReportDivisionGroup[];
  includeStatus: boolean;
  includeJsComment: boolean;
}) {
  const rows = groups.flatMap((g) =>
    [...g.tasks]
      .sort((a, b) => {
        const ra = cadenceRank(a.cadence);
        const rb = cadenceRank(b.cadence);
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name);
      })
      .map((t) => ({ task: t, divisionName: g.divisionName, colour: g.colour })),
  );

  return (
    <View>
      <View style={styles.colHeadRow}>
        <View style={{ width: 10 }} />
        <Text style={[styles.colHead, { flex: 0.9 }]}>DIVISION</Text>
        <Text style={[styles.colHead, { flex: 0.85 }]}>PRIORITY</Text>
        <Text style={[styles.colHead, { flex: 3 }]}>TASK</Text>
        {includeStatus ? <Text style={[styles.colHead, { flex: 1.6 }]}>STATUS</Text> : null}
        {includeJsComment ? <Text style={[styles.colHead, { flex: 1.6 }]}>JS COMMENT</Text> : null}
      </View>

      {rows.map(({ task, divisionName, colour }) => (
        <View
          key={task.id}
          style={[styles.detailRow, { backgroundColor: divisionWash(colour, 0.05) }]}
          wrap={false}
        >
          <View style={[styles.strip, { backgroundColor: colour }]} />
          <Text style={styles.cellDivision}>{divisionName}</Text>
          <Text style={styles.cellCadence}>
            {task.cadence ? REPORT_CADENCE_LABEL[task.cadence] : 'Not scheduled'}
          </Text>
          <Text style={styles.cellTask}>{task.name}</Text>
          {includeStatus ? (
            <Text style={styles.cellText}>{task.latestStatus?.trim() || '—'}</Text>
          ) : null}
          {includeJsComment ? (
            <Text style={styles.cellText}>{task.jsComment?.trim() || '—'}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

// ------------------------------------------------------------
// Compact grid — one row per division, tasks bucketed by cadence
// ------------------------------------------------------------

type GridColumn = { key: ReportCadence | 'unscheduled'; label: string };

function gridColumns(selectedPriorities: ReportCadence[], includeUnscheduled: boolean): GridColumn[] {
  const priorities = selectedPriorities.length > 0 ? selectedPriorities : REPORT_CADENCES;
  const cols: GridColumn[] = priorities.map((c) => ({ key: c, label: REPORT_CADENCE_LABEL[c] }));
  if (includeUnscheduled) cols.push({ key: 'unscheduled', label: 'Not scheduled' });
  return cols;
}

function tasksForColumn(tasks: ReportTask[], key: GridColumn['key']): ReportTask[] {
  return tasks
    .filter((t) => (key === 'unscheduled' ? t.cadence === null : t.cadence === key))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function CompactGrid({
  groups,
  selectedPriorities,
  includeUnscheduled,
}: {
  groups: ReportDivisionGroup[];
  selectedPriorities: ReportCadence[];
  includeUnscheduled: boolean;
}) {
  const columns = gridColumns(selectedPriorities, includeUnscheduled);

  return (
    <View>
      <View style={styles.gridHeadRow}>
        <Text style={styles.gridDivisionHead}>DIVISION</Text>
        {columns.map((c) => (
          <Text key={c.key} style={styles.gridColHead}>
            {c.label.toUpperCase()}
          </Text>
        ))}
      </View>

      {groups.map((g) => (
        <View
          key={g.divisionId}
          style={[styles.gridRow, { backgroundColor: divisionWash(g.colour, 0.05) }]}
        >
          <View style={styles.gridDivisionCell}>
            <View style={[styles.strip, { backgroundColor: g.colour }]} />
            <View>
              <Text style={styles.gridDivisionName}>{g.divisionName}</Text>
              <Text style={styles.gridDivisionCount}>
                {g.tasks.length} {g.tasks.length === 1 ? 'task' : 'tasks'}
              </Text>
            </View>
          </View>
          {columns.map((c) => {
            const items = tasksForColumn(g.tasks, c.key);
            return (
              <View key={c.key} style={styles.gridCell}>
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
