import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { initialsOf } from '@/lib/format';
import { rateLimit } from '@/lib/rate-limit';
import { buildVisibilityClauses, visibilityAnd } from '@/lib/visibility';

/**
 * GET /api/priority-board/search?q=
 *
 * Task search behind the Priority Board's add-tray. Curator-only (OSD /
 * Super Admin — the same gate as setJsPriorityLaneAction): the tray exists
 * to drag tasks onto the board, which only they may do.
 *
 * Only open, top-level tasks are returned, visibility-scoped to the caller.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  if (!session.user.isSuperAdmin && session.user.hierarchySlot !== 'osd') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { ok: allowed } = rateLimit(`board-search:${session.user.id}`, 60, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const q = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 200);
  if (q.length < 2) return NextResponse.json({ tasks: [] });
  const escaped = q.replace(/[%_\\]/g, (c) => `\\${c}`);

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      hierarchySlot: true,
      isSuperAdmin: true,
      divisionId: true,
      isPmu: true,
      pmuId: true,
    },
  });
  if (!me) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const visibilityClauses = await buildVisibilityClauses(me);

  const rows = await prisma.task.findMany({
    where: {
      archivedAt: null,
      parentTaskId: null,
      status: { not: 'completed' },
      AND: [
        ...visibilityAnd(visibilityClauses),
        {
          OR: [
            { name: { contains: escaped, mode: 'insensitive' } },
            { refNumber: { contains: escaped, mode: 'insensitive' } },
            { owner: { name: { contains: escaped, mode: 'insensitive' } } },
          ],
        },
      ],
    },
    select: {
      id: true,
      refNumber: true,
      name: true,
      status: true,
      priority: true,
      jsPriorityLane: true,
      dueDate: true,
      division: { select: { name: true } },
      owner: { select: { name: true, division: { select: { avatarColour: true } } } },
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 20,
  });

  return NextResponse.json({
    tasks: rows.map((t) => ({
      id: t.id,
      refNumber: t.refNumber,
      name: t.name,
      status: t.status,
      priority: t.priority,
      jsPriorityLane: t.jsPriorityLane,
      divisionName: t.division.name,
      due: t.dueDate ? t.dueDate.toISOString() : null,
      owner: {
        name: t.owner.name,
        initials: initialsOf(t.owner.name),
        colour: t.owner.division.avatarColour,
      },
    })),
  });
}
