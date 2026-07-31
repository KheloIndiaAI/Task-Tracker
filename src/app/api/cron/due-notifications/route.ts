import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';

/**
 * GET /api/cron/due-notifications
 *
 * Creates deadline-reminder notifications, deduped against the last day's:
 *   - task_due_soon (bucketed 'today' / 'tomorrow' by IST calendar day) → owner
 *   - task_overdue → owner
 *   - timeline_file_due_soon (due today/tomorrow) → marked-to Directors
 * Designed to be hit by an external cron (e.g. each morning, IST).
 *
 * Protected by CRON_SECRET env var — pass it as the
 * `Authorization: Bearer <value>` header.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured' },
      { status: 503 },
    );
  }

  const hSecret = request.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const a = Buffer.from(hSecret);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();

  // IST (UTC+5:30, no DST) calendar-day edges, so "today" / "tomorrow" mean the
  // officer's local day regardless of the server timezone. Computed from a
  // fixed offset — no dependency on the process TZ.
  const IST_SHIFT_MS = (5 * 60 + 30) * 60 * 1000;
  const istWall = now.getTime() + IST_SHIFT_MS;
  const istMidnightWall = Math.floor(istWall / 86_400_000) * 86_400_000;
  // Real UTC instants for datetime dueDate comparisons:
  const endOfTodayIST = new Date(istMidnightWall + 86_400_000 - IST_SHIFT_MS); // start of IST tomorrow
  const endOfTomorrowIST = new Date(istMidnightWall + 2 * 86_400_000 - IST_SHIFT_MS);
  // Date-only edges for TimelineFile.deadlineDate (@db.Date = UTC midnight of the
  // calendar date), which line up with IST midnight-wall exactly:
  const todayDate = new Date(istMidnightWall); // <IST-today>T00:00:00Z
  const tomorrowDate = new Date(istMidnightWall + 86_400_000); // <IST-tomorrow>T00:00:00Z

  const taskSelect = { id: true, name: true, ownerId: true } as const;

  const dueToday = await prisma.task.findMany({
    where: {
      dueDate: { gt: now, lt: endOfTodayIST },
      status: { notIn: ['completed'] },
      archivedAt: null,
    },
    select: taskSelect,
  });

  const dueTomorrow = await prisma.task.findMany({
    where: {
      dueDate: { gte: endOfTodayIST, lt: endOfTomorrowIST },
      status: { notIn: ['completed'] },
      archivedAt: null,
    },
    select: taskSelect,
  });

  const overdue = await prisma.task.findMany({
    where: {
      dueDate: { lt: now },
      status: { notIn: ['completed'] },
      archivedAt: null,
    },
    select: taskSelect,
  });

  // Timeline Files due today or tomorrow → the Directors of each marked-to
  // division (the same audience notified when a file is marked to them).
  const tfsDue = await prisma.timelineFile.findMany({
    where: {
      deadlineDate: { gte: todayDate, lte: tomorrowDate },
      status: { not: 'closed' },
      archivedAt: null,
    },
    select: {
      id: true,
      refNo: true,
      subject: true,
      markedTo: { select: { divisionId: true } },
    },
  });
  const tfDivisionIds = [...new Set(tfsDue.flatMap((t) => t.markedTo.map((m) => m.divisionId)))];
  const tfDirectors = tfDivisionIds.length
    ? await prisma.user.findMany({
        where: {
          divisionId: { in: tfDivisionIds },
          hierarchySlot: 'director',
          isActive: true,
        },
        select: { id: true, divisionId: true },
      })
    : [];
  const directorsByDivision = new Map<string, string[]>();
  for (const d of tfDirectors) {
    const list = directorsByDivision.get(d.divisionId) ?? [];
    list.push(d.id);
    directorsByDivision.set(d.divisionId, list);
  }

  // Dedup against the last day's reminders. task_due_soon is keyed by its
  // today/tomorrow bucket so a task that was "due tomorrow" yesterday can still
  // get a fresh "due today" reminder.
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const recentNotifs = await prisma.notification.findMany({
    where: {
      type: { in: ['task_due_soon', 'task_overdue', 'timeline_file_due_soon'] },
      createdAt: { gte: oneDayAgo },
    },
    select: { userId: true, type: true, payload: true },
  });
  const keyOf = (type: string, payload: Record<string, unknown>, userId: string): string => {
    if (type === 'task_due_soon')
      return `task_due_soon:${String(payload.bucket ?? '')}:${String(payload.taskId)}:${userId}`;
    if (type === 'timeline_file_due_soon')
      return `timeline_file_due_soon:${String(payload.timelineFileId)}:${userId}`;
    return `${type}:${String(payload.taskId)}:${userId}`;
  };
  const seen = new Set(
    recentNotifs.map((n) => keyOf(n.type, (n.payload ?? {}) as Record<string, unknown>, n.userId)),
  );

  const notifs: Prisma.NotificationCreateManyInput[] = [];

  const pushTaskReminder = (
    t: { id: string; name: string; ownerId: string },
    bucket: 'today' | 'tomorrow',
  ) => {
    const payload = { taskId: t.id, taskName: t.name, bucket };
    if (!seen.has(keyOf('task_due_soon', payload, t.ownerId)))
      notifs.push({ userId: t.ownerId, type: 'task_due_soon', payload });
  };
  for (const t of dueToday) pushTaskReminder(t, 'today');
  for (const t of dueTomorrow) pushTaskReminder(t, 'tomorrow');

  for (const t of overdue) {
    const payload = { taskId: t.id, taskName: t.name };
    if (!seen.has(keyOf('task_overdue', payload, t.ownerId)))
      notifs.push({ userId: t.ownerId, type: 'task_overdue', payload });
  }

  for (const tf of tfsDue) {
    const recipients = new Set<string>();
    for (const m of tf.markedTo)
      for (const id of directorsByDivision.get(m.divisionId) ?? []) recipients.add(id);
    for (const uid of recipients) {
      const payload = { timelineFileId: tf.id, refNo: tf.refNo, subject: tf.subject };
      if (!seen.has(keyOf('timeline_file_due_soon', payload, uid)))
        notifs.push({ userId: uid, type: 'timeline_file_due_soon', payload });
    }
  }

  if (notifs.length > 0) {
    await prisma.notification.createMany({ data: notifs });
  }

  return NextResponse.json({
    created: notifs.length,
    dueToday: dueToday.length,
    dueTomorrow: dueTomorrow.length,
    overdue: overdue.length,
    timelineFilesDue: tfsDue.length,
  });
}
