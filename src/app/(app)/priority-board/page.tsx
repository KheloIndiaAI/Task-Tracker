import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { USER_SUMMARY_SELECT } from '@/lib/prisma-selects';
import { initialsOf } from '@/lib/format';
import { buildVisibilityClauses } from '@/lib/visibility';

import { Board, BoardSearch, PrintBoardButton, type BoardTask } from './_components/Board';
import { RemoveModeProvider, RemoveToggle } from './_components/RemoveMode';
import { AccordionProvider } from './_components/AccordionState';

import type { PillJsLane } from '@/components/ui/Pill';

const LANES: PillJsLane[] = ['today', 'week', 'month', 'watchlist'];

export default async function PriorityBoardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // Caller's role — only OSD / Super Admin can curate (drag-drop)
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, hierarchySlot: true, isSuperAdmin: true, divisionId: true, isPmu: true, pmuId: true },
  });
  if (!me) redirect('/login');
  const canCurate = me.isSuperAdmin || me.hierarchySlot === 'osd';

  const visibilityClauses = await buildVisibilityClauses(me);

  const tasks = await prisma.task.findMany({
    where: {
      archivedAt: null,
      parentTaskId: null,
      jsPriorityLane: { not: null },
      // A completed task drops off the board automatically.
      status: { not: 'completed' },
      OR: visibilityClauses,
    },
    include: {
      owner: { select: USER_SUMMARY_SELECT },
      division: true,
    },
    orderBy: [
      { jsPrioritySortOrder: { sort: 'asc', nulls: 'last' } },
      { priority: 'desc' },
      { dueDate: { sort: 'asc', nulls: 'last' } },
    ],
  });

  const tasksByLane: Record<PillJsLane, BoardTask[]> = {
    today: [],
    week: [],
    month: [],
    watchlist: [],
  };

  for (const t of tasks) {
    if (!t.jsPriorityLane) continue;
    const lane = t.jsPriorityLane as PillJsLane;
    tasksByLane[lane].push({
      id: t.id,
      refNumber: t.refNumber,
      name: t.name,
      status: t.status,
      priority: t.priority,
      jsPriorityLane: lane,
      divisionName: t.division.name,
      due: t.dueDate,
      owner: {
        name: t.owner.name,
        initials: initialsOf(t.owner.name),
        colour: t.owner.division.avatarColour,
      },
    });
  }

  const totalOnBoard = LANES.reduce((n, lane) => n + tasksByLane[lane].length, 0);

  return (
    <RemoveModeProvider>
    <AccordionProvider>
    <div className="px-4 md:px-6 lg:px-8 pt-4 md:pt-6 pb-10 max-w-7xl mx-auto">
      <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-1 inline-flex items-center gap-1">
            <i className="ti ti-bookmark-filled text-[11px] text-accent" aria-hidden="true" />
            JS curation
          </p>
          <h1 className="font-serif text-[22px] md:text-[28px] leading-tight text-ink">
            Priority board
          </h1>
          <p className="mt-1.5 text-[12px] text-ink-2 max-w-2xl leading-relaxed">
            The four lanes the JS scans at a glance. {canCurate
              ? 'Use the task search to pull any task straight onto the board, and drag between lanes — owners, their Director, and Section Officer get notified.'
              : 'Only OSD can move tasks between lanes; this view is read-only for you.'}
          </p>
          <p className="mt-2 text-[11px] text-ink-3">
            {totalOnBoard} {totalOnBoard === 1 ? 'task' : 'tasks'} on the board
          </p>
        </div>

        {/* Top-right on desktop; stacks full-width under the title on mobile.
            Print is available to every viewer; search + remove are
            curator-only. */}
        <div className="w-full md:w-auto md:pt-1 shrink-0 flex flex-col gap-2 items-stretch md:items-end">
          {canCurate ? (
            <>
              <BoardSearch />
              <RemoveToggle />
            </>
          ) : null}
          <PrintBoardButton />
        </div>
      </header>

      {totalOnBoard === 0 && !canCurate ? (
        // Curators always get the live board — the search tray is how they
        // put the first tasks on it.
        <EmptyState />
      ) : (
        <Board tasksByLane={tasksByLane} canCurate={canCurate} />
      )}
    </div>
    </AccordionProvider>
    </RemoveModeProvider>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-line bg-panel p-10 md:p-14 text-center">
      <i
        className="ti ti-bookmark text-[36px] text-ink-3 block mb-2"
        aria-hidden="true"
      />
      <h2 className="font-serif text-[20px] text-ink mb-1">No tasks on the board yet</h2>
      <p className="text-[13px] text-ink-2 max-w-md mx-auto leading-relaxed">
        OSD has not flagged any tasks for JS priority yet.
      </p>
    </div>
  );
}
