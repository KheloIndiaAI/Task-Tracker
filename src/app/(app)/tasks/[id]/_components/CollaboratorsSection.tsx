'use client';

import { useEffect, useState, useTransition } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import Link from 'next/link';

import { Avatar, Sheet, Switch, UserPicker, type UserPickerOption } from '@/components/ui';
import {
  addCollaboratorAction,
  removeCollaboratorAction,
  setPmuTeamShareAction,
} from '@/app/actions/tasks';
import { initialsOf } from '@/lib/format';
import { cn } from '@/lib/utils';

export type CollaboratorRow = {
  id: string;
  userId: string;
  name: string;
  designation: string;
  role: 'collaborator' | 'division_lead' | 'co_owner';
  division: { name: string; avatarColour: string };
};

export type Candidate = {
  id: string;
  name: string;
  designation: string;
  divisionName: string;
  divisionColour?: string;
};

export type SubtaskScope = {
  id: string;
  name: string;
};

type CollaboratorsSectionProps = {
  taskId: string;
  collaborators: CollaboratorRow[];
  candidates: Candidate[];
  canEdit: boolean;
  canViewProfiles: boolean;
  subtasks?: SubtaskScope[];
  /**
   * The "Show this task to PMU team" switch. Present only where there is an
   * audience — a PMU's own task, or a division that has a PMU under it.
   * `canManage` is canSharePmuTeam (the PMU team leader who owns a PMU task,
   * or a division head for a division task, plus OSD / Super Admin); everyone
   * else sees a read-only indicator, and only while the task is actually
   * shared.
   */
  pmuTeamShare?: {
    canManage: boolean;
    shared: boolean;
    /** 'pmu' — the task's own PMU team. 'division' — the PMUs under it. */
    scope: 'pmu' | 'division';
    /** Names of the PMUs a division task would reach; empty for scope 'pmu'. */
    pmuNames: string[];
  };
};

const ROLE_LABEL: Record<CollaboratorRow['role'], string> = {
  collaborator: 'Collaborator',
  division_lead: 'Division lead',
  co_owner: 'Co-owner',
};

const ROLE_TONE: Record<CollaboratorRow['role'], string> = {
  collaborator: 'text-ink-3',
  division_lead: 'text-accent',
  co_owner: 'text-primary',
};

export function CollaboratorsSection({
  taskId,
  collaborators,
  candidates,
  canEdit,
  canViewProfiles,
  subtasks,
  pmuTeamShare,
}: CollaboratorsSectionProps) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <section
      aria-labelledby="sec-collab"
      className="px-4 md:px-6 py-5 border-b border-line-2"
    >
      {pmuTeamShare && (pmuTeamShare.canManage || pmuTeamShare.shared) ? (
        <PmuTeamShareControl
          taskId={taskId}
          shared={pmuTeamShare.shared}
          canManage={pmuTeamShare.canManage}
          scope={pmuTeamShare.scope}
          pmuNames={pmuTeamShare.pmuNames}
        />
      ) : null}

      <div className="flex items-center justify-between mb-3">
        <h2 className="section-label" id="sec-collab">
          Collaborators
          <span className="ml-2 text-ink-3 text-[11px] tracking-normal normal-case font-normal">
            {collaborators.length} {collaborators.length === 1 ? 'person' : 'people'}
          </span>
        </h2>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="text-[11px] font-medium text-primary inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-primary-soft"
          >
            <i className="ti ti-user-plus text-[13px]" aria-hidden="true" />
            Add
          </button>
        ) : null}
      </div>

      {collaborators.length === 0 ? (
        <p className="text-[13px] text-ink-3 italic">
          No collaborators yet.{' '}
          {canEdit ? 'Tap Add to share this with people from any division.' : ''}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {collaborators.map((c) => (
            <CollaboratorChip
              key={c.id}
              taskId={taskId}
              row={c}
              canEdit={canEdit}
              canViewProfile={canViewProfiles}
            />
          ))}
        </ul>
      )}

      {canEdit ? (
        <AddDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          taskId={taskId}
          candidates={candidates}
          alreadyAdded={collaborators.map((c) => c.userId)}
          subtasks={subtasks}
        />
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------
// PMU team (entire) share control
// ------------------------------------------------------------

/**
 * "Show this task to PMU team" — one switch, two directions.
 *
 * On a PMU's OWN task it shares the task with that whole PMU team. On a
 * DIVISION task it shows the task down to the PMU team(s) attached to that
 * division, who are otherwise walled off from the division's board by PMU
 * isolation; they can then collaborate on it like any other participant.
 *
 * Rendered only where there is an audience — the task detail page withholds it
 * entirely for a division with no PMU under it. Non-managers see the read-only
 * indicator, and only while the task is actually shared, so the switch never
 * hints at a control they do not have.
 *
 * The on state is tinted with \`--info\`, the same neutral signal the Notice
 * board and the Watchlist lane use: this marks reach, and is neither a JS
 * Priority (amber) nor a Super Admin / Timeline File (indigo) signal.
 */
function PmuTeamShareControl({
  taskId,
  shared,
  canManage,
  scope,
  pmuNames,
}: {
  taskId: string;
  shared: boolean;
  canManage: boolean;
  scope: 'pmu' | 'division';
  pmuNames: string[];
}) {
  const [optimistic, setOptimistic] = useState(shared);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOptimistic(shared);
  }, [shared]);

  const toggle = (next: boolean) => {
    setOptimistic(next);
    setError(null);
    const fd = new FormData();
    fd.set('taskId', taskId);
    fd.set('shared', next ? 'on' : '');
    startTransition(async () => {
      const result = await setPmuTeamShareAction(undefined, fd);
      if (!result.ok) {
        setOptimistic(!next);
        setError(result.error ?? 'Could not update PMU team sharing.');
      }
    });
  };

  // Who the switch actually reaches, named wherever we can name them.
  const audience =
    scope === 'pmu'
      ? 'this PMU team'
      : pmuNames.length === 0
        ? 'the PMU team'
        : pmuNames.length === 1
          ? pmuNames[0]
          : pmuNames.slice(0, -1).join(', ') + ' and ' + pmuNames[pmuNames.length - 1];

  // Read-only for people who cannot manage it — and only once actually shared,
  // so it reads as a fact about the task rather than a disabled control.
  if (!canManage) {
    if (!shared) return null;
    return (
      <p className="mb-4 inline-flex items-center gap-2 rounded-pill border border-info/30 bg-info-soft px-3 py-1.5 text-[11.5px] text-ink-2">
        <i className="ti ti-users-group text-[14px] text-info shrink-0" aria-hidden="true" />
        Visible to {audience}.
      </p>
    );
  }

  const on = optimistic;

  return (
    <div className="mb-4">
      <div
        className={cn(
          'flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors duration-[var(--dur-base)]',
          on ? 'border-info/30 bg-info-soft' : 'border-line bg-panel',
          pending && 'opacity-60',
        )}
      >
        <span
          className={cn(
            'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors duration-[var(--dur-base)]',
            on ? 'bg-info/15 text-info' : 'bg-line-2 text-ink-3',
          )}
        >
          <i className="ti ti-users-group text-[15px]" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">Show this task to PMU team</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-3">
            {scope === 'pmu'
              ? 'Every member of this PMU sees it in their assigned list, except the division head.'
              : on
                ? `Visible to ${audience} — they can open it, comment, attach files, and be added as collaborators.`
                : `Off. ${audience} cannot see this task. Turn it on to let them view and collaborate on it; nothing else from this division's board is exposed.`}
          </p>
        </div>

        <Switch
          checked={on}
          ariaLabel="Show this task to PMU team"
          onChange={toggle}
          disabled={pending}
        />
      </div>

      {error ? (
        <p role="alert" className="mt-1.5 text-[11px] text-urgent">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------
// Chip
// ------------------------------------------------------------

function CollaboratorChip({
  taskId,
  row,
  canEdit,
  canViewProfile,
}: {
  taskId: string;
  row: CollaboratorRow;
  canEdit: boolean;
  canViewProfile: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const remove = () => {
    if (!confirm(`Remove ${row.name} from this task?`)) return;
    const fd = new FormData();
    fd.set('taskId', taskId);
    fd.set('userId', row.userId);
    startTransition(async () => {
      const result = await removeCollaboratorAction(undefined, fd);
      if (!result.ok && result.error) alert(result.error);
    });
  };

  return (
    <li
      className={cn(
        'inline-flex items-center gap-1.5 pl-1 pr-1.5 py-1 rounded-full bg-bg border border-line',
        pending && 'opacity-60',
      )}
    >
      <Avatar
        initials={initialsOf(row.name)}
        colour={row.division.avatarColour}
        size="xs"
        ariaLabel={row.name}
      />
      {canViewProfile ? (
        <Link href={`/users/${row.userId}`} className="text-[11px] text-ink hover:underline">
          {row.name}
        </Link>
      ) : (
        <span className="text-[11px] text-ink">{row.name}</span>
      )}
      <span className={cn('text-[10px]', ROLE_TONE[row.role])}>
        · {ROLE_LABEL[row.role]}
      </span>
      {canEdit ? (
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          aria-label={`Remove ${row.name}`}
          className="w-5 h-5 grid place-items-center rounded-full text-ink-3 hover:bg-line-2 hover:text-ink"
        >
          <i className="ti ti-x text-[12px]" aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

// ------------------------------------------------------------
// Add dialog
// ------------------------------------------------------------

const ROLE_OPTIONS = [
  { value: 'collaborator', label: 'Collaborator', sub: 'Comment + status change' },
  { value: 'division_lead', label: 'Division lead', sub: 'One per participating division' },
  { value: 'co_owner', label: 'Co-owner', sub: 'Equal accountability (max 3)' },
] as const;

function AddDialog({
  open,
  onClose,
  taskId,
  candidates,
  alreadyAdded,
  subtasks,
}: {
  open: boolean;
  onClose: () => void;
  taskId: string;
  candidates: Candidate[];
  alreadyAdded: string[];
  subtasks?: SubtaskScope[];
}) {
  const [state, formAction] = useFormState(addCollaboratorAction, {
    ok: false,
    epoch: 0,
  });
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]['value']>('collaborator');
  const [scopeId, setScopeId] = useState('');

  useEffect(() => {
    if (state.ok) {
      onClose();
      setUserId('');
      setRole('collaborator');
      setScopeId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.epoch]);

  const available = candidates.filter((c) => !alreadyAdded.includes(c.id));
  const pickerOptions: UserPickerOption[] = available.map((c) => ({
    id: c.id,
    name: c.name,
    designation: c.designation,
    divisionName: c.divisionName,
    divisionColour: c.divisionColour,
  }));

  const targetTaskId = scopeId || taskId;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add collaborator"
      subtitle="They get notified and can comment / change status."
    >
      {open ? (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="taskId" value={targetTaskId} />

          {subtasks && subtasks.length > 0 ? (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-ink-2">Scope</span>
              <select
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-line bg-panel text-[13px] outline-none transition-colors appearance-none focus:border-ink"
              >
                <option value="">Entire task</option>
                {subtasks.map((s) => (
                  <option key={s.id} value={s.id}>
                    Subtask: {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-ink-2">Person</span>
            {available.length === 0 ? (
              <p className="text-[12px] text-ink-3 italic px-2 py-3 rounded-lg border border-dashed border-line text-center">
                Everyone is already added. Super Admin can create more users from the
                Users sub-section.
              </p>
            ) : (
              <UserPicker
                options={pickerOptions}
                value={userId}
                onChange={setUserId}
                placeholder="Search by name or designation…"
                name="userId"
                error={!!state.fieldErrors?.userId}
              />
            )}
            {state.fieldErrors?.userId ? (
              <span className="text-[11px] text-urgent">{state.fieldErrors.userId}</span>
            ) : null}
          </label>

          <fieldset className="mt-1">
            <legend className="text-[11px] font-medium text-ink-2 mb-1.5">Role</legend>
            <input type="hidden" name="role" value={role} />
            <div className="flex flex-col gap-1" role="radiogroup">
              {ROLE_OPTIONS.map((o) => {
                const active = role === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setRole(o.value)}
                    className={cn(
                      'flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                      active ? 'bg-primary-soft' : 'hover:bg-bg',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'w-4 h-4 rounded-full border mt-0.5 shrink-0',
                        active ? 'border-primary' : 'border-ink-4',
                      )}
                    >
                      {active ? (
                        <span className="block w-2 h-2 rounded-full bg-primary m-[3px]" />
                      ) : null}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span
                        className={cn(
                          'block text-[13px] font-medium',
                          active ? 'text-primary' : 'text-ink',
                        )}
                      >
                        {o.label}
                      </span>
                      <span className="block text-[11px] text-ink-3 mt-0.5">{o.sub}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {state.error ? (
            <p
              role="alert"
              className="text-[12px] text-urgent bg-urgent-soft border border-urgent/20 rounded-lg px-3 py-2"
            >
              {state.error}
            </p>
          ) : null}

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-line text-[13px] font-medium text-ink-2 hover:bg-line-2"
            >
              Cancel
            </button>
            <AddButton disabled={available.length === 0 || !userId} />
          </div>
        </form>
      ) : null}
    </Sheet>
  );
}

function AddButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="flex-1 py-2.5 rounded-lg bg-ink text-onink text-[13px] font-medium disabled:opacity-60"
    >
      {pending ? 'Adding…' : 'Add'}
    </button>
  );
}
