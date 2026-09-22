'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { Avatar, Sheet } from '@/components/ui';
import { setDivisionHeadAction } from '@/app/actions/admin-structure';
import { INITIAL_STRUCTURE_STATE } from '@/app/actions/states';
import { initialsOf } from '@/lib/format';
import { cn } from '@/lib/utils';

export type HeadCandidate = {
  id: string;
  name: string;
  designation: string;
  divisionName: string;
  divisionColour: string;
};

export type ActiveDelegate = {
  id: string;
  name: string;
  designation: string;
  /** Human date the delegation window closes, e.g. "5 Aug 2026". */
  until: string;
};

type DivisionHeadCardProps = {
  divisionId: string;
  divisionName: string;
  currentHead: HeadCandidate | null;
  candidates: HeadCandidate[];
  /**
   * Users currently holding an active delegation of this division's head
   * access. While a delegation is live the recipient is the temporary head,
   * so they are surfaced next to the Change control. Usually one.
   */
  activeDelegates?: ActiveDelegate[];
  /** Only Super Admin may change the mapping; others see it read-only. */
  canEdit: boolean;
  /**
   * What is being headed. A directorate's head (an Assistant Director) gets
   * head powers over every division in it, and can delegate that access.
   */
  kind?: 'division' | 'directorate';
};

/**
 * Shows and (for Super Admin) edits the division's head — the mapping
 * that drives division-based RBAC and delegation rights. Also used for a
 * directorate, whose single head is stored the same way (head_user_id).
 */
export function DivisionHeadCard({
  divisionId,
  divisionName,
  currentHead,
  candidates,
  activeDelegates = [],
  canEdit,
  kind = 'division',
}: DivisionHeadCardProps) {
  const roleLabel = kind === 'directorate' ? 'Directorate head' : 'Division head';
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [state, formAction] = useFormState(setDivisionHeadAction, INITIAL_STRUCTURE_STATE);

  const close = () => {
    setOpen(false);
    setSearch('');
  };

  useEffect(() => {
    if (state.ok) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.epoch]);

  const filtered = search
    ? candidates.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.designation.toLowerCase().includes(search.toLowerCase()),
      )
    : candidates;

  return (
    <div className="mb-4 bg-panel border border-line rounded-xl px-4 py-3 flex items-center gap-3">
      <i className="ti ti-crown text-[16px] text-primary shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-ink-3">{roleLabel}</p>
        {currentHead ? (
          <p className="text-[13px] font-medium text-ink truncate">
            {currentHead.name}
            <span className="ml-1.5 font-normal text-ink-3">{currentHead.designation}</span>
          </p>
        ) : (
          <p className="text-[13px] text-ink-3">No head assigned</p>
        )}
      </div>
      {activeDelegates.length > 0 ? (
        <div
          className="shrink-0 max-w-[46%] flex items-center gap-1.5 rounded-lg border border-line bg-bg px-2.5 py-1.5"
          title={activeDelegates
            .map((d) => `${d.name} · acting head until ${d.until}`)
            .join('\n')}
        >
          <i className="ti ti-user-check text-[14px] text-primary shrink-0" aria-hidden="true" />
          <div className="min-w-0 leading-tight">
            <p className="text-[10px] text-ink-3">Acting head</p>
            <p className="text-[12px] font-medium text-ink truncate">
              {activeDelegates[0].name}
              {activeDelegates.length > 1 ? (
                <span className="font-normal text-ink-3"> +{activeDelegates.length - 1}</span>
              ) : null}
            </p>
          </div>
        </div>
      ) : null}

      {canEdit ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 px-3 py-1.5 rounded-md border border-line text-[12px] font-medium text-ink-2 hover:bg-line-2 transition-colors"
        >
          Change
        </button>
      ) : null}

      <Sheet open={open} onClose={close} title={roleLabel} subtitle={divisionName}>
        {open ? (
          <div className="flex flex-col gap-3">
            {kind === 'directorate' ? (
              <p className="text-[12px] text-ink-3">
                The head gets full head powers over every division in this
                directorate — the same as each division&rsquo;s own head, who
                keeps theirs — and can delegate that access. Super Admin is
                notified of every delegation.
              </p>
            ) : (
              <p className="text-[12px] text-ink-3">
                The head can assign tasks within the division, receives transfers
                from its users, and can delegate access. Super Admin is notified of
                every delegation.
              </p>
            )}

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people…"
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg border border-line bg-panel text-[14px] outline-none focus:border-ink"
            />

            {state.error ? (
              <p role="alert" className="text-[12px] text-urgent">{state.error}</p>
            ) : null}

            <ul className="max-h-[300px] overflow-y-auto flex flex-col gap-0.5">
              {currentHead ? (
                <li>
                  <form action={formAction}>
                    <input type="hidden" name="divisionId" value={divisionId} />
                    <input type="hidden" name="headUserId" value="" />
                    <RowButton
                      label="Remove current head"
                      sub={`${currentHead.name} loses head access`}
                      tone="danger"
                    />
                  </form>
                </li>
              ) : null}
              {filtered.length === 0 ? (
                <li className="py-6 text-center text-[13px] text-ink-3">No matches</li>
              ) : (
                filtered.map((c) => (
                  <li key={c.id}>
                    <form action={formAction}>
                      <input type="hidden" name="divisionId" value={divisionId} />
                      <input type="hidden" name="headUserId" value={c.id} />
                      <CandidateButton candidate={c} isCurrent={c.id === currentHead?.id} />
                    </form>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

function CandidateButton({
  candidate,
  isCurrent,
}: {
  candidate: HeadCandidate;
  isCurrent: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || isCurrent}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-bg transition-colors disabled:opacity-60',
        isCurrent && 'bg-bg',
      )}
    >
      <Avatar
        initials={initialsOf(candidate.name)}
        colour={candidate.divisionColour}
        size="xs"
        ariaLabel={candidate.name}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink truncate">{candidate.name}</span>
        <span className="block text-[11px] text-ink-3 truncate">
          {candidate.designation} · {candidate.divisionName}
        </span>
      </span>
      {isCurrent ? (
        <span className="shrink-0 text-[10px] font-medium text-primary bg-primary-soft border border-primary-line/40 px-1.5 py-0.5 rounded">
          Current
        </span>
      ) : null}
    </button>
  );
}

function RowButton({
  label,
  sub,
  tone,
}: {
  label: string;
  sub: string;
  tone?: 'danger';
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-bg transition-colors disabled:opacity-60"
    >
      <span
        className={cn(
          'w-[26px] h-[26px] grid place-items-center rounded-full shrink-0',
          tone === 'danger' ? 'bg-urgent-soft' : 'bg-line-2',
        )}
      >
        <i
          className={cn('ti ti-crown-off text-[14px]', tone === 'danger' ? 'text-urgent' : 'text-ink-3')}
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block text-[13px] font-medium truncate',
            tone === 'danger' ? 'text-urgent' : 'text-ink',
          )}
        >
          {label}
        </span>
        <span className="block text-[11px] text-ink-3 truncate">{sub}</span>
      </span>
    </button>
  );
}
