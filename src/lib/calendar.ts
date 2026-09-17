import { nowIST, isoDay as isoDayIST, formatTimeIST } from '@/lib/date';
import { prisma } from '@/lib/db';
import { USER_SUMMARY_SELECT } from '@/lib/prisma-selects';
import {
  canAccessEngagements,
  fetchEngagements,
  getOfficeOfJsDivisionId,
} from '@/lib/engagements';
import { getMemberDivisionIds } from '@/lib/rbac';
import { buildTfVisibilityClause } from '@/lib/timeline-files';
import { buildVisibilityClauses, visibilityAnd } from '@/lib/visibility';

/**
 * Unified planning calendar — data fetch + grid helpers.
 *
 * Three item kinds share one grid, each visibility-scoped to the caller:
 *   - engagement — Office of JS meetings (only OJS members + Super Admins)
 *   - task       — every visible task with a due date (same scoper as /tasks,
 *                  so division users see only their division and PMU members
 *                  only their team)
 *   - tf         — Timeline File deadlines the caller can see
 *
 * Filters (kinds, my-items, division, priority, status) are applied at the
 * query layer so the grid only ever holds what should be shown.
 */

export type CalendarKind = 'engagement' | 'task' | 'tf';

export type CalendarEvent = {
  id: string;
  kind: CalendarKind;
  title: string;
  date: Date;
  /** Detail link for tasks/TFs; null for engagements (open a detail sheet). */
  href: string | null;
  /** For engagements — opens the detail sheet by id. */
  engagementId?: string;
  /** Extra context shown on hover / in list view. */
  sub: string;
  /** Task/TF priority; drives an optional dot. */
  priority?: string;
  /** IST clock time for engagements, e.g. "2:30 pm". */
  time?: string;
};

export type CalendarFilters = {
  /** Which kinds to include. */
  kinds: Set<CalendarKind>;
  /** Only items that are "mine" (owned / created / participating). */
  mine: boolean;
  /** Narrow divisional items (tasks + TFs) to one division. */
  divisionId?: string;
  /** Task/TF priority. */
  priority?: string;
  /** Task status (tasks only — TFs use a different status vocabulary). */
  status?: string;
};

// ============================================================
// fetchCalendarEvents
// ============================================================

export async function fetchCalendarEvents(opts: {
  callerId: string;
  from: Date;
  to: Date;
  filters: CalendarFilters;
}): Promise<CalendarEvent[]> {
  const { filters } = opts;
  const me = await prisma.user.findUnique({
    where: { id: opts.callerId },
    select: {
      id: true,
      hierarchySlot: true,
      isSuperAdmin: true,
      divisionId: true,
      isPmu: true,
      pmuId: true,
    },
  });
  if (!me) return [];

  const officeOfJsDivisionId = await getOfficeOfJsDivisionId();
  const memberDivisionIds = await getMemberDivisionIds(me.id);
  const maySeeEngagements = canAccessEngagements(
    { memberDivisionIds, isSuperAdmin: me.isSuperAdmin },
    officeOfJsDivisionId,
  );

  const wantTasks = filters.kinds.has('task');
  const wantTfs = filters.kinds.has('tf');
  const wantEngagements = filters.kinds.has('engagement') && maySeeEngagements;

  // Same scoper as /tasks and search — visibility parity across surfaces.
  // `[]` is the fail-closed placeholder for the branch that never runs —
  // an empty OR matches nothing, unlike `null`, which would mean unrestricted.
  const taskVisibility = wantTasks ? await buildVisibilityClauses(me) : [];
  const tfVisibility = wantTfs ? await buildTfVisibilityClause(me) : null;

  const [tasks, tfs, engagements] = await Promise.all([
    wantTasks
      ? prisma.task.findMany({
          where: {
            archivedAt: null,
            parentTaskId: null,
            dueDate: { gte: opts.from, lte: opts.to },
            AND: visibilityAnd(taskVisibility),
            ...(filters.mine ? { ownerId: me.id } : {}),
            ...(filters.divisionId ? { divisionId: filters.divisionId } : {}),
            ...(filters.priority ? { priority: filters.priority as never } : {}),
            ...(filters.status ? { status: filters.status as never } : {}),
          },
          include: {
            owner: { select: USER_SUMMARY_SELECT },
            division: true,
          },
        })
      : Promise.resolve([]),
    wantTfs && tfVisibility
      ? prisma.timelineFile.findMany({
          where: {
            archivedAt: null,
            deadlineDate: { gte: opts.from, lte: opts.to },
            AND: [tfVisibility],
            ...(filters.mine ? { createdById: me.id } : {}),
            ...(filters.divisionId
              ? { markedTo: { some: { divisionId: filters.divisionId } } }
              : {}),
            ...(filters.priority ? { priority: filters.priority as never } : {}),
          },
          select: {
            id: true,
            refNo: true,
            subject: true,
            deadlineDate: true,
            status: true,
            priority: true,
            markedTo: { select: { division: { select: { name: true } } } },
          },
        })
      : Promise.resolve([]),
    wantEngagements
      ? fetchEngagements({ from: opts.from, to: opts.to })
      : Promise.resolve([]),
  ]);

  const events: CalendarEvent[] = [];

  for (const t of tasks) {
    if (!t.dueDate) continue;
    events.push({
      id: `task:${t.id}`,
      kind: 'task',
      title: t.name,
      date: t.dueDate,
      href: `/tasks/${t.id}`,
      sub: `${t.division.name} · ${t.owner.name}`,
      priority: t.priority,
    });
  }

  for (const tf of tfs) {
    if (!tf.deadlineDate) continue;
    const markedList =
      tf.markedTo.length > 0
        ? tf.markedTo.map((m) => m.division.name).join(', ')
        : 'no division';
    events.push({
      id: `tf:${tf.id}`,
      kind: 'tf',
      title: tf.subject,
      date: tf.deadlineDate,
      href: `/timeline-files/${tf.id}`,
      sub: `${tf.refNo} · ${markedList}`,
      priority: tf.priority,
    });
  }

  for (const e of engagements) {
    // "My items" for engagements = created by me or I'm a participant.
    if (filters.mine && e.createdBy.id !== me.id && !e.participants.some((p) => p.id === me.id)) {
      continue;
    }
    const who =
      e.participants.length > 0
        ? `${e.participants.length} ${e.participants.length === 1 ? 'participant' : 'participants'}`
        : e.createdBy.name;
    events.push({
      id: `engagement:${e.id}`,
      kind: 'engagement',
      engagementId: e.id,
      title: e.title,
      date: e.startsAt,
      href: null,
      sub: `${formatTimeIST(e.startsAt)}${e.venue ? ` · ${e.venue}` : ` · ${who}`}`,
      time: formatTimeIST(e.startsAt),
    });
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime());
  return events;
}

// ============================================================
// Month grid (6 weeks × 7 days, week starts Monday)
// ============================================================

export type MonthDay = {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
};

export function getMonthGrid(year: number, monthIndex: number): MonthDay[] {
  // monthIndex is 0-based (0 = January, 11 = December)
  const firstOfMonth = new Date(year, monthIndex, 1);
  const weekday = firstOfMonth.getDay(); // 0 = Sun
  // Adjust for Monday start
  const offset = (weekday + 6) % 7;

  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(1 - offset);

  const todayIso = isoDayIST(new Date());

  const days: MonthDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push({
      date: d,
      isCurrentMonth: d.getMonth() === monthIndex,
      isToday: isoDay(d) === todayIso,
    });
  }
  return days;
}

export function isoDay(d: Date): string {
  return isoDayIST(d);
}

export function monthBounds(year: number, monthIndex: number): { from: Date; to: Date } {
  // Inclusive bounds covering the full 6-week grid.
  const grid = getMonthGrid(year, monthIndex);
  const from = new Date(grid[0].date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(grid[grid.length - 1].date);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

export function parseMonthParam(raw: string | undefined): { year: number; monthIndex: number } {
  // ?date=YYYY-MM
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split('-').map(Number);
    if (m >= 1 && m <= 12) return { year: y, monthIndex: m - 1 };
  }
  const now = nowIST();
  return { year: now.getUTCFullYear(), monthIndex: now.getUTCMonth() };
}

export function shiftMonth(year: number, monthIndex: number, delta: number): {
  year: number;
  monthIndex: number;
} {
  const d = new Date(year, monthIndex + delta, 1);
  return { year: d.getFullYear(), monthIndex: d.getMonth() };
}

export function monthParam(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

// ============================================================
// Week grid (7 days, Mon–Sun, containing the given date)
// ============================================================

export type WeekDay = {
  date: Date;
  isToday: boolean;
};

/**
 * Returns the 7 days (Mon–Sun) of the ISO week containing the given date,
 * each annotated with `isToday`.
 */
export function buildWeekGrid(year: number, month: number, day: number): WeekDay[] {
  const target = new Date(year, month, day);
  const weekday = target.getDay(); // 0 = Sun
  const mondayOffset = (weekday + 6) % 7; // how many days back to Monday

  const monday = new Date(target);
  monday.setDate(target.getDate() - mondayOffset);

  const todayIso = isoDayIST(new Date());

  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push({
      date: d,
      isToday: isoDay(d) === todayIso,
    });
  }
  return days;
}

export function weekBounds(grid: WeekDay[]): { from: Date; to: Date } {
  const from = new Date(grid[0].date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(grid[grid.length - 1].date);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

/** Shift a date by `deltaDays` and return { year, month (0-based), day }. */
export function shiftDay(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const d = new Date(year, month, day + deltaDays);
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}

/** Format a date as YYYY-MM-DD for URL params. */
export function dayParam(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseDayParam(raw: string | undefined): {
  year: number;
  month: number;
  day: number;
} {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return { year: y, month: m - 1, day: d };
    }
  }
  const now = nowIST();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth(), day: now.getUTCDate() };
}
