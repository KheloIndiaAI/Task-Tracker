'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { Avatar, Sheet } from '@/components/ui';
import { setPmuTeamHeadAction } from '@/app/actions/admin-structure';
import { INITIAL_STRUCTURE_STATE } from '@/app/actions/states';
import { initialsOf } from '@/lib/format';
import { cn } from '@/lib/utils';

export type PmuHeadCandidate = {
  id: string;
  name: string;
  designation: string;
  divisionColour: string;
};

type PmuTeamHeadCardProps = {
  /** The PMU this card is for — one card per PMU, never per division. */
  pmuId: string;
  pmuName: string;
  currentHead: PmuHeadCandidate | null;
  /** Active members of THIS PMU — the only eligible heads. */
  candidates: PmuHeadCandidate[];
  /** Only Super Admin may change it; others see it read-only. */
  canEdit: boolean;
};

/**
 * Shows and (for Super Admin) sets one PMU's Team Head — the member of that
 * PMU with `pmu_role = 'pmu_team_leader'` who administers the team's tasks
 * (edit, allot, collaborators, attachments, and delete of the team's own
 * tasks; never a task or document from a Division Head / Super Admin / OSD).
 *
 * One card per PMU. A division can carry several — Khelo India Scheme has
 * INFRA_PMU, KIS_PMU and PPP_PMU — and each runs its own team, so the card is
 * named after the PMU rather than the division and pools candidates from that
 * PMU alone.
 */
export function PmuTeamHeadCard({
  pmuId,
  pmuName,
  currentHead,
  candidates,
  canEdit,
}: PmuTeamHeadCardProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [state, formAction] = useFormState(setPmuTeamHeadAction, INITIAL_STRUCTURE_STATE);

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
    <div className="mb-3 bg-panel border border-line rounded-xl px-4 py-3 flex items-center gap-3">
      <i className="ti ti-user-star text-[16px] text-primary shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-ink-3">
          <span className="font-mono">{pmuName}</span> · team head
        </p>
        {currentHead ? (
          <p className="text-[13px] font-medium text-ink truncate">
            {currentHead.name}
            <span className="ml-1.5 font-normal text-ink-3">{currentHead.designation}</span>
          </p>
        ) : (
          <p className="text-[13px] text-ink-3">No PMU team head assigned</p>
        )}
      </div>

      {canEdit ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 px-3 py-1.5 rounded-md border border-line text-[12px] font-medium text-ink-2 hover:bg-line-2 transition-colors"
        >
          Change
        </button>
      ) : null}

      <Sheet open={open} onClose={close} title="PMU team head" subtitle={pmuName}>
        {open ? (
          <div className="flex flex-col gap-3">
            <p className="text-[12px] text-ink-3">
              The PMU team head can edit, allot, add collaborators to and attach
              documents on the PMU team&rsquo;s tasks, and delete the team&rsquo;s
              own tasks. They cannot delete a task or document from a division
              head, Super Admin, or OSD.
            </p>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${pmuName} members…`}
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
                    <input type="hidden" name="pmuId" value={pmuId} />
                    <input type="hidden" name="headUserId" value="" />
                    <RowButton
                      label="Remove current head"
                      sub={`${currentHead.name} loses PMU team-head access`}
                    />
                  </form>
                </li>
              ) : null}
              {filtered.length === 0 ? (
                <li className="py-6 text-center text-[13px] text-ink-3">
                  {candidates.length === 0 ? 'No members in this PMU' : 'No matches'}
                </li>
              ) : (
                filtered.map((c) => (
                  <li key={c.id}>
                    <form action={formAction}>
                      <input type="hidden" name="pmuId" value={pmuId} />
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
  candidate: PmuHeadCandidate;
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
        <span className="block text-[11px] text-ink-3 truncate">{candidate.designation}</span>
      </span>
      {isCurrent ? (
        <span className="shrink-0 text-[10px] font-medium text-primary bg-primary-soft border border-primary-line/40 px-1.5 py-0.5 rounded">
          Current
        </span>
      ) : null}
    </button>
  );
}

function RowButton({ label, sub }: { label: string; sub: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-bg transition-colors disabled:opacity-60"
    >
      <span className="w-[26px] h-[26px] grid place-items-center rounded-full shrink-0 bg-urgent-soft">
        <i className="ti ti-user-off text-[14px] text-urgent" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-urgent truncate">{label}</span>
        <span className="block text-[11px] text-ink-3 truncate">{sub}</span>
      </span>
    </button>
  );
}
