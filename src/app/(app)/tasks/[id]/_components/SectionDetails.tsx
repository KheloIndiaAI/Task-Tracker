'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';

import { Avatar, Sheet } from '@/components/ui';
import {
  updateTaskFieldsAction,
  reassignTaskAction,
  resolveReassignmentAction,
} from '@/app/actions/tasks';
import {
  INITIAL_FIELDS_STATE,
  type UpdateFieldsState,
} from '@/app/actions/states';
import { initialsOf, formatDue } from '@/lib/format';
import { cn } from '@/lib/utils';

import { RecurrencePicker, humanRecurrence } from './RecurrencePicker';

type ReassignCandidate = {
  id: string;
  name: string;
  designation: string;
  divisionName: string;
  divisionColour: string;
};

type PendingReassignment = {
  id: string;
  proposedOwnerName: string;
  requestedByName: string;
  approverName: string;
  approverId: string;
  isApprover: boolean;
};

type DivisionOption = {
  id: string;
  name: string;
  avatarColour: string;
  kind: string;
};

type SubDivisionOption = {
  id: string;
  name: string;
  avatarColour: string;
};

type SectionDetailsProps = {
  taskId: string;
  owner: { id: string; name: string; division: { avatarColour: string } };
  /** True when the task has no owner yet (a division task awaiting a pull). */
  isUnassigned: boolean;
  due: Date | null;
  divisionId: string;
  divisionName: string;
  recurrence: string | null;
  reassignCandidates: ReassignCandidate[];
  pendingReassignment: PendingReassignment | null;
  canReassign: boolean;
  canEditFields: boolean;
  /** Visibility is a head power — stricter than canEditFields. */
  canChangeDivision: boolean;
  divisions: DivisionOption[];
  /** Current sub-division id, or null when the task is tagged to none. */
  subDivisionId: string | null;
  subDivisionName: string | null;
  /** Sub-divisions of the task's division; the row hides when empty. */
  subDivisions: SubDivisionOption[];
  /** Sub-division is a definition edit — same gate as the due date. */
  canChangeSubDivision: boolean;
  canViewProfiles: boolean;
};

export function SectionDetails(props: SectionDetailsProps) {
  return (
    <section aria-labelledby="sec-details" className="px-4 md:px-6 py-5 border-b border-line-2">
      <h2 id="sec-details" className="section-label mb-3">
        Details
      </h2>

      {props.pendingReassignment ? (
        <PendingReassignmentBanner
          taskId={props.taskId}
          pending={props.pendingReassignment}
        />
      ) : null}

      <div className="flex flex-col">
        <OwnerRow
          taskId={props.taskId}
          owner={props.owner}
          isUnassigned={props.isUnassigned}
          candidates={props.reassignCandidates}
          canReassign={props.canReassign && !props.pendingReassignment}
          canViewProfile={props.canViewProfiles}
        />

        <DueRow taskId={props.taskId} due={props.due} canEdit={props.canEditFields} />

        <DivisionRow
          taskId={props.taskId}
          divisionId={props.divisionId}
          divisionName={props.divisionName}
          canChange={props.canChangeDivision}
          divisions={props.divisions}
        />

        {props.subDivisions.length > 0 ? (
          <SubDivisionRow
            taskId={props.taskId}
            subDivisionId={props.subDivisionId}
            subDivisionName={props.subDivisionName}
            canChange={props.canChangeSubDivision}
            subDivisions={props.subDivisions}
          />
        ) : null}

        <RecurrenceRow taskId={props.taskId} recurrence={props.recurrence} canEdit={props.canEditFields} />
      </div>
    </section>
  );
}

function RecurrenceRow({
  taskId,
  recurrence,
  canEdit,
}: {
  taskId: string;
  recurrence: string | null;
  canEdit: boolean;
}) {
  const label = humanRecurrence(recurrence);

  if (!canEdit) {
    return (
      <Row icon="ti-repeat" label="Recurrence">
        <span className={cn(!recurrence && 'text-ink-3 font-normal')}>{label}</span>
      </Row>
    );
  }

  return (
    <RecurrencePicker
      taskId={taskId}
      current={recurrence}
      trigger={
        <Row icon="ti-repeat" label="Recurrence" onClick={() => undefined}>
          <span className={cn(!recurrence && 'text-ink-3 font-normal')}>{label}</span>
        </Row>
      }
    />
  );
}

// ------------------------------------------------------------
// Owner row — clickable if canReassign; opens a user picker sheet
// ------------------------------------------------------------

// Placeholder shown in the Owner row when a division task has no owner yet
// (owner still its creator) — the state a division member can pull from.
function UnassignedOwner() {
  return (
    <span className="inline-flex items-center gap-2 text-ink-3">
      <span
        className="w-[22px] h-[22px] rounded-full border border-dashed border-line grid place-items-center shrink-0"
        aria-hidden="true"
      >
        <i className="ti ti-user text-[11px]" />
      </span>
      Unassigned
    </span>
  );
}

function OwnerRow({
  taskId,
  owner,
  isUnassigned,
  candidates,
  canReassign,
  canViewProfile,
}: {
  taskId: string;
  owner: { id: string; name: string; division: { avatarColour: string } };
  isUnassigned: boolean;
  candidates: ReassignCandidate[];
  canReassign: boolean;
  canViewProfile: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [state, formAction] = useFormState(reassignTaskAction, INITIAL_FIELDS_STATE);

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      setSearch('');
    }
  }, [state.ok, state.epoch]);

  const filtered = search
    ? candidates.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.designation.toLowerCase().includes(search.toLowerCase()) ||
          c.divisionName.toLowerCase().includes(search.toLowerCase()),
      )
    : candidates;

  if (!canReassign) {
    if (isUnassigned) {
      return (
        <Row icon="ti-user" label="Owner">
          <UnassignedOwner />
        </Row>
      );
    }
    const display = (
      <div className="inline-flex items-center gap-2">
        <Avatar
          initials={initialsOf(owner.name)}
          colour={owner.division.avatarColour}
          size="xs"
          ariaLabel={`Owner ${owner.name}`}
        />
        <span>{owner.name}</span>
      </div>
    );
    return (
      <Row icon="ti-user" label="Owner">
        {canViewProfile ? (
          <Link href={`/users/${owner.id}`} className="hover:opacity-80">
            {display}
          </Link>
        ) : display}
      </Row>
    );
  }

  return (
    <>
      <Row icon="ti-user" label="Owner" onClick={() => setOpen(true)}>
        {isUnassigned ? (
          <UnassignedOwner />
        ) : (
          <div className="inline-flex items-center gap-2">
            <Avatar
              initials={initialsOf(owner.name)}
              colour={owner.division.avatarColour}
              size="xs"
              ariaLabel={`Owner ${owner.name}`}
            />
            {canViewProfile ? (
              <Link
                href={`/users/${owner.id}`}
                onClick={(e) => e.stopPropagation()}
                className="hover:underline"
              >
                {owner.name}
              </Link>
            ) : (
              <span>{owner.name}</span>
            )}
          </div>
        )}
      </Row>

      <Sheet open={open} onClose={() => { setOpen(false); setSearch(''); }} title="Reassign task">
        <div className="flex flex-col gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people…"
            autoFocus
            className="w-full px-3 py-2.5 rounded-lg border border-line bg-panel text-[14px] outline-none focus:border-ink"
          />

          {state.error ? (
            <p className="text-[12px] text-urgent">{state.error}</p>
          ) : null}

          <p className="text-[11px] text-ink-3">
            Downward reassignment is instant. Sideways or upward requires your supervisor&apos;s approval.
          </p>

          <ul className="max-h-[320px] overflow-y-auto flex flex-col gap-0.5">
            {filtered.length === 0 ? (
              <li className="py-6 text-center text-[13px] text-ink-3">No matches</li>
            ) : (
              filtered.map((c) => (
                <li key={c.id}>
                  <form action={formAction}>
                    <input type="hidden" name="taskId" value={taskId} />
                    <input type="hidden" name="newOwnerId" value={c.id} />
                    <button
                      type="submit"
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-bg transition-colors"
                    >
                      <Avatar
                        initials={initialsOf(c.name)}
                        colour={c.divisionColour}
                        size="xs"
                        ariaLabel={c.name}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-ink truncate">{c.name}</p>
                        <p className="text-[11px] text-ink-3 truncate">{c.designation} · {c.divisionName}</p>
                      </div>
                    </button>
                  </form>
                </li>
              ))
            )}
          </ul>
        </div>
      </Sheet>
    </>
  );
}

// ------------------------------------------------------------
// Pending reassignment banner — amber accent per the two-accent rule
// ------------------------------------------------------------

function PendingReassignmentBanner({
  taskId,
  pending,
}: {
  taskId: string;
  pending: PendingReassignment;
}) {
  const [state, formAction] = useFormState(resolveReassignmentAction, INITIAL_FIELDS_STATE);

  return (
    <div className="mb-3 p-3 rounded-lg border border-accent/30 bg-accent/5">
      <div className="flex items-start gap-2.5">
        <i className="ti ti-arrows-shuffle text-[16px] text-accent mt-0.5 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-ink">
            Reassignment pending
          </p>
          <p className="text-[12px] text-ink-2 mt-0.5">
            {pending.requestedByName} requested to reassign to {pending.proposedOwnerName}.
            Waiting for {pending.approverName}&apos;s approval.
          </p>

          {state.error ? (
            <p className="text-[12px] text-urgent mt-1">{state.error}</p>
          ) : null}

          {pending.isApprover ? (
            <div className="flex gap-2 mt-2.5">
              <form action={formAction}>
                <input type="hidden" name="requestId" value={pending.id} />
                <input type="hidden" name="action" value="approve" />
                <ApproveBtn />
              </form>
              <form action={formAction}>
                <input type="hidden" name="requestId" value={pending.id} />
                <input type="hidden" name="action" value="reject" />
                <RejectBtn />
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ApproveBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-3 py-1.5 rounded-md bg-ink text-onink text-[12px] font-medium disabled:opacity-60"
    >
      {pending ? 'Approving…' : 'Approve'}
    </button>
  );
}

function RejectBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-3 py-1.5 rounded-md border border-line text-[12px] font-medium text-ink-2 disabled:opacity-60"
    >
      {pending ? 'Rejecting…' : 'Reject'}
    </button>
  );
}

// ------------------------------------------------------------
// Row primitive
// ------------------------------------------------------------

type RowProps = {
  icon: string;
  label: string;
  muted?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
};

function Row({ icon, label, muted, children, onClick }: RowProps) {
  const Wrapper: React.ElementType = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg text-left',
        onClick && 'hover:bg-bg transition-colors',
      )}
    >
      <i className={cn('ti', icon, 'text-[16px] text-ink-3 shrink-0 w-[18px]')} aria-hidden="true" />
      <span className="text-[13px] text-ink-2 w-[100px] shrink-0">{label}</span>
      <span
        className={cn(
          'flex-1 text-[13px] text-right font-medium',
          muted ? 'text-ink-3 font-normal' : 'text-ink',
        )}
      >
        {children}
      </span>
      {onClick ? (
        <i className="ti ti-chevron-right text-[14px] text-ink-4 shrink-0" aria-hidden="true" />
      ) : null}
    </Wrapper>
  );
}

// ------------------------------------------------------------
// Due row — inline date input in a small popover (uses Sheet)
// ------------------------------------------------------------

function DueRow({ taskId, due, canEdit }: { taskId: string; due: Date | null; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const display = formatDue(due);
  const dateStr = due ? due.toISOString().slice(0, 10) : '';

  if (!canEdit) {
    return (
      <Row icon="ti-calendar-event" label="Due">
        <span
          className={cn(
            display.tone === 'overdue' && 'text-urgent',
            display.tone === 'today' && 'text-accent',
            display.tone === 'none' && 'text-ink-3 font-normal',
          )}
        >
          {display.tone === 'none' ? 'No due date' : display.label}
        </span>
      </Row>
    );
  }

  return (
    <>
      <Row
        icon="ti-calendar-event"
        label="Due"
        onClick={() => setOpen(true)}
      >
        <span
          className={cn(
            display.tone === 'overdue' && 'text-urgent',
            display.tone === 'today' && 'text-accent',
          )}
        >
          {display.tone === 'none' ? 'Add due date' : display.label}
        </span>
      </Row>

      <Sheet open={open} onClose={() => setOpen(false)} title="Set due date">
        <DueForm taskId={taskId} initial={dateStr} onDone={() => setOpen(false)} />
      </Sheet>
    </>
  );
}

function DueForm({
  taskId,
  initial,
  onDone,
}: {
  taskId: string;
  initial: string;
  onDone: () => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState<UpdateFieldsState, FormData>(
    updateTaskFieldsAction,
    INITIAL_FIELDS_STATE,
  );

  useEffect(() => {
    if (state.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.epoch]);

  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="taskId" value={taskId} />
      <input
        type="date"
        name="dueDate"
        defaultValue={initial}
        autoFocus
        className="w-full px-3 py-2.5 rounded-lg border border-line bg-panel text-[14px] outline-none focus:border-ink"
      />
      {state.fieldErrors?.dueDate ? (
        <p className="text-[11px] text-urgent">{state.fieldErrors.dueDate}</p>
      ) : null}
      {state.error ? <p className="text-[11px] text-urgent">{state.error}</p> : null}
      <div className="flex gap-2 mt-1">
        <button
          type="button"
          onClick={() => {
            // Submit empty to clear due date.
            if (!ref.current) return;
            const fd = new FormData();
            fd.set('taskId', taskId);
            fd.set('dueDate', '');
            (formAction as unknown as (fd: FormData) => void)(fd);
          }}
          className="px-3 py-2 rounded-md border border-line text-[12px] font-medium text-ink-2 hover:bg-line-2"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={onDone}
          className="px-3 py-2 rounded-md border border-line text-[12px] font-medium text-ink-2 hover:bg-line-2"
        >
          Cancel
        </button>
        <SaveBtn />
      </div>
    </form>
  );
}

// ------------------------------------------------------------
// Division row — editable by OSD / Super Admin only
// ------------------------------------------------------------

function DivisionRow({
  taskId,
  divisionId,
  divisionName,
  canChange,
  divisions,
}: {
  taskId: string;
  divisionId: string;
  divisionName: string;
  canChange: boolean;
  divisions: DivisionOption[];
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(divisionId);
  const [state, formAction] = useFormState<UpdateFieldsState, FormData>(
    updateTaskFieldsAction,
    INITIAL_FIELDS_STATE,
  );

  useEffect(() => {
    if (state.ok) setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.epoch]);

  useEffect(() => {
    if (open) setChosen(divisionId);
  }, [open, divisionId]);

  if (!canChange) {
    return (
      <Row icon="ti-building" label="Division">
        <span>{divisionName}</span>
      </Row>
    );
  }

  return (
    <>
      <Row icon="ti-building" label="Division" onClick={() => setOpen(true)}>
        <span>{divisionName}</span>
      </Row>

      <Sheet open={open} onClose={() => setOpen(false)} title="Change division">
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="divisionId" value={chosen} />

          <p className="text-[12px] text-ink-3">
            Ownership follows the choice: a division goes to its head, a PMU
            to its team leader.
          </p>

          <div className="flex flex-col gap-1" role="radiogroup">
            {divisions.map((d) => {
              const active = chosen === d.id;
              const isPmu = d.kind === 'pmu';
              return (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setChosen(d.id)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-colors',
                    active ? 'bg-primary-soft' : 'hover:bg-bg',
                  )}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: d.avatarColour }}
                    aria-hidden="true"
                  />
                  <span className="flex-1 text-[14px] font-medium text-ink">{d.name}</span>
                  {isPmu ? (
                    <span className="shrink-0 text-[10px] font-medium text-ink-2 bg-line-2 border border-line px-1.5 py-0.5 rounded">
                      PMU
                    </span>
                  ) : null}
                  {active ? (
                    <span className="w-5 h-5 grid place-items-center rounded-full bg-ink text-onink shrink-0">
                      <i className="ti ti-check text-[12px]" aria-hidden="true" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {state.error ? <p className="text-[12px] text-urgent">{state.error}</p> : null}

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 py-3 rounded-lg border border-line text-[14px] font-medium text-ink-2 hover:bg-line-2"
            >
              Cancel
            </button>
            <SaveBtn />
          </div>
        </form>
      </Sheet>
    </>
  );
}

// ------------------------------------------------------------
// Sub-division row — categorisation within the division. Editable
// with the same gate as the definition fields; hidden entirely when
// the division has no sub-divisions. "Whole division" clears the tag.
// ------------------------------------------------------------

function SubDivisionRow({
  taskId,
  subDivisionId,
  subDivisionName,
  canChange,
  subDivisions,
}: {
  taskId: string;
  subDivisionId: string | null;
  subDivisionName: string | null;
  canChange: boolean;
  subDivisions: SubDivisionOption[];
}) {
  const [open, setOpen] = useState(false);
  // '' represents "whole division" (no sub-division).
  const [chosen, setChosen] = useState(subDivisionId ?? '');
  const [state, formAction] = useFormState<UpdateFieldsState, FormData>(
    updateTaskFieldsAction,
    INITIAL_FIELDS_STATE,
  );

  useEffect(() => {
    if (state.ok) setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.epoch]);

  useEffect(() => {
    if (open) setChosen(subDivisionId ?? '');
  }, [open, subDivisionId]);

  if (!canChange) {
    return (
      <Row icon="ti-sitemap" label="Sub-division">
        <span className={cn(!subDivisionName && 'text-ink-3 font-normal')}>
          {subDivisionName ?? 'Whole division'}
        </span>
      </Row>
    );
  }

  return (
    <>
      <Row icon="ti-sitemap" label="Sub-division" onClick={() => setOpen(true)}>
        <span className={cn(!subDivisionName && 'text-ink-3 font-normal')}>
          {subDivisionName ?? 'Whole division'}
        </span>
      </Row>

      <Sheet open={open} onClose={() => setOpen(false)} title="Set sub-division">
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="subDivisionId" value={chosen} />

          <p className="text-[12px] text-ink-3">
            A sub-division groups the task within its division. It does not change
            who owns or can see the task.
          </p>

          <div className="flex flex-col gap-1" role="radiogroup">
            {[{ id: '', name: 'Whole division', avatarColour: '' }, ...subDivisions].map((s) => {
              const active = chosen === s.id;
              const isNone = s.id === '';
              return (
                <button
                  key={s.id || 'none'}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setChosen(s.id)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-colors',
                    active ? 'bg-primary-soft' : 'hover:bg-bg',
                  )}
                >
                  {isNone ? (
                    <span className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: s.avatarColour }}
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={cn(
                      'flex-1 text-[14px] font-medium',
                      isNone ? 'text-ink-2' : 'text-ink',
                    )}
                  >
                    {s.name}
                  </span>
                  {active ? (
                    <span className="w-5 h-5 grid place-items-center rounded-full bg-ink text-onink shrink-0">
                      <i className="ti ti-check text-[12px]" aria-hidden="true" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {state.error ? <p className="text-[12px] text-urgent">{state.error}</p> : null}

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 py-3 rounded-lg border border-line text-[14px] font-medium text-ink-2 hover:bg-line-2"
            >
              Cancel
            </button>
            <SaveBtn />
          </div>
        </form>
      </Sheet>
    </>
  );
}

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex-1 py-2 px-3 rounded-md bg-ink text-onink text-[12px] font-medium disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}
