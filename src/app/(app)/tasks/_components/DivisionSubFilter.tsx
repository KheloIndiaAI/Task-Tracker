'use client';

import { useState } from 'react';
import Link from 'next/link';

import type { TaskCardInteractiveProps } from '@/components/ui';
import { cn } from '@/lib/utils';

import { DivisionCardsToggle } from './DivisionCardsToggle';
import { DivisionLaneBoard, type LaneBoardTask } from './DivisionLaneBoard';
import { TaskListItem } from './TaskListItem';

type Child = { id: string; name: string };
type GridTask = TaskCardInteractiveProps & { subDivisionId: string | null };

type DivisionSubFilterProps = {
  divisionName: string;
  subDivisions: Child[];
  /** A division's PMUs are a structurally separate division row — their tasks
   *  already form their own card elsewhere in this same grouped list, so a
   *  PMU pill is a quick link to that card, not an in-place filter. */
  pmus: Child[];
  laneBoardTasks: LaneBoardTask[];
  canCurate: boolean;
  canEditJsComment: boolean;
  activeGridTasks: GridTask[];
  completedGridTasks: GridTask[];
};

/**
 * Sub-division filter pills for one division's card on the grouped tasks
 * list, plus the lane board and task grid they narrow.
 *
 * Sections aren't offered here — a task can only be tagged with a division
 * and, optionally, one of its sub-divisions (task.sub_division_id); there is
 * no per-task section field, so a section pill would have nothing real to
 * filter by.
 *
 * No pill selected (the default, and what "All" resets to) shows every task
 * in the division, same as before this existed. Selecting one or more
 * sub-divisions shows the union of their tasks — a task with no
 * sub-division at all only ever shows in that unfiltered default, never
 * under a specific pill.
 */
export function DivisionSubFilter({
  divisionName,
  subDivisions,
  pmus,
  laneBoardTasks,
  canCurate,
  canEditJsComment,
  activeGridTasks,
  completedGridTasks,
}: DivisionSubFilterProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSubDivision = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const matches = (subDivisionId: string | null) =>
    selected.size === 0 || (subDivisionId !== null && selected.has(subDivisionId));

  const filteredLaneTasks =
    selected.size === 0 ? laneBoardTasks : laneBoardTasks.filter((t) => matches(t.subDivisionId));
  const filteredActive =
    selected.size === 0 ? activeGridTasks : activeGridTasks.filter((t) => matches(t.subDivisionId));
  const filteredCompleted =
    selected.size === 0 ? completedGridTasks : completedGridTasks.filter((t) => matches(t.subDivisionId));
  const nothingMatches = filteredActive.length === 0 && filteredCompleted.length === 0 && filteredLaneTasks.length === 0;

  return (
    <>
      {subDivisions.length > 0 || pmus.length > 0 ? (
        <div
          role="group"
          aria-label={`Narrow ${divisionName} by sub-division`}
          className="flex flex-wrap items-center gap-1.5 mb-3"
        >
          <PillButton active={selected.size === 0} onClick={() => setSelected(new Set())}>
            All
          </PillButton>
          {subDivisions.map((s) => (
            <PillButton key={s.id} active={selected.has(s.id)} onClick={() => toggleSubDivision(s.id)}>
              {s.name}
            </PillButton>
          ))}
          {pmus.map((p) => (
            <Link
              key={p.id}
              href={`/tasks?division=${p.id}`}
              className={cn(pillBase, pillInactive, 'inline-flex items-center gap-1')}
              title={`Open ${p.name}'s own task list`}
            >
              {p.name}
              <i className="ti ti-arrow-up-right text-[10px]" aria-hidden="true" />
            </Link>
          ))}
        </div>
      ) : null}

      {nothingMatches ? (
        <p className="rounded-lg border border-dashed border-line bg-panel px-3 py-3 text-[12px] text-ink-3 mb-3">
          No tasks match this selection.
        </p>
      ) : (
        <>
          <DivisionLaneBoard tasks={filteredLaneTasks} canCurate={canCurate} canEditJsComment={canEditJsComment} />

          <DivisionCardsToggle count={filteredActive.length} completedCount={filteredCompleted.length}>
            <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-3">
              {filteredActive.map((props) => (
                <li key={props.taskId}>
                  <TaskListItem {...props} />
                </li>
              ))}
            </ul>

            {filteredCompleted.length > 0 ? (
              <>
                <h5 className="section-label mt-4 mb-2 flex items-center gap-1.5">
                  <i className="ti ti-circle-check text-[13px] text-success" aria-hidden="true" />
                  Completed
                  <span className="font-normal normal-case tracking-normal text-ink-3">
                    {filteredCompleted.length}
                  </span>
                </h5>
                <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-3 opacity-75">
                  {filteredCompleted.map((props) => (
                    <li key={props.taskId}>
                      <TaskListItem {...props} />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </DivisionCardsToggle>
        </>
      )}
    </>
  );
}

const pillBase = 'px-3 py-1.5 rounded-full border text-[12px] font-medium transition-colors';
const pillActive = 'bg-ink text-onink border-ink';
const pillInactive = 'bg-panel text-ink-2 border-line hover:border-ink-4';

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn(pillBase, active ? pillActive : pillInactive)}>
      {children}
    </button>
  );
}
