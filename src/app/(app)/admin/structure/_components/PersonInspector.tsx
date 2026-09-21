'use client';

import { useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';

import { Avatar } from '@/components/ui';
import { EditUserDialog } from '@/app/(app)/admin/users/_components/EditUserDialog';
import { ResetPasswordDialog } from '@/app/(app)/admin/users/_components/ResetPasswordDialog';
import { setUserSupervisorAction } from '@/app/actions/admin-structure';
import { setUserActiveAction } from '@/app/actions/admin-users';
import { initialsOf } from '@/lib/format';
import {
  CONTRACT_ROLE_LABEL,
  HIERARCHY_SLOT_LABEL,
  HIERARCHY_SLOT_LEVEL,
  PMU_ROLE_LABEL,
} from '@/lib/labels';
import { cn } from '@/lib/utils';

import type {
  UserFormDefaults,
  UserFormDivisionOption,
  UserFormSupervisorOption,
} from '@/app/(app)/admin/users/_components/UserFormFields';
import { useTransition } from 'react';

import { ManageMembersDialog } from './ManageMembersDialog';
import type { TreeUser } from './StructureTree';
import type { StructureKind } from '@/lib/structure-shared';

export type InspectorUser = {
  id: string;
  name: string;
  username: string;
  designation: string;
  hierarchySlot: string;
  contractRole: string | null;
  isPmu: boolean;
  pmuRole: string | null;
  isActive: boolean;
  isSuperAdmin: boolean;
  lastLogin: Date | null;
  division: { id: string; name: string; avatarColour: string };
  subDivision: { name: string } | null;
  section: { name: string } | null;
  supervisor: { id: string; name: string; designation: string; division: { avatarColour: string } } | null;
  directReports: {
    id: string;
    name: string;
    designation: string;
    division: { avatarColour: string };
  }[];
  defaults: UserFormDefaults;
};

type PersonInspectorProps = {
  user: InspectorUser | null;
  divisions: UserFormDivisionOption[];
  supervisors: UserFormSupervisorOption[];
  selfId: string;
  activeDivision?: { id: string; name: string; kind: StructureKind };
  allUsers?: TreeUser[];
};

export function PersonInspector({
  user,
  divisions,
  supervisors,
  selfId,
  activeDivision,
  allUsers,
}: PersonInspectorProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!user) {
    return (
      <div className="bg-panel border border-line rounded-xl p-6 text-center">
        <i
          className="ti ti-user-circle text-[34px] text-ink-3 block mb-2"
          aria-hidden="true"
        />
        <h3 className="font-serif text-[18px] text-ink mb-1">Select an officer</h3>
        <p className="text-[12px] text-ink-3 leading-relaxed">
          Click any officer in the chart to see their details and act on their account.
        </p>
      </div>
    );
  }

  const isSelf = user.id === selfId;
  const slotLevel = HIERARCHY_SLOT_LEVEL[user.hierarchySlot] ?? null;

  const toggleActive = () => {
    if (isSelf) return;
    const fd = new FormData();
    fd.set('userId', user.id);
    fd.set('isActive', user.isActive ? 'false' : 'true');
    startTransition(async () => {
      const result = await setUserActiveAction(undefined, fd);
      if (!result.ok && result.error) alert(result.error);
    });
  };

  return (
    <>
      <div className="bg-panel border border-line rounded-xl">
        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-4 border-b border-line-2">
          <Avatar
            initials={initialsOf(user.name)}
            colour={user.division.avatarColour}
            size="lg"
            ariaLabel={user.name}
          />
          <div className="min-w-0">
            <h3 className="font-serif text-[18px] text-ink truncate">{user.name}</h3>
            <p className="text-[11px] text-ink-2 truncate">{user.designation}</p>
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              {!user.isActive ? (
                <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.06em] font-medium text-low bg-low-soft border border-line px-1.5 py-0.5 rounded">
                  Disabled
                </span>
              ) : null}
              {user.isSuperAdmin ? (
                <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.06em] font-medium text-primary bg-primary-soft border border-primary-line/40 px-1.5 py-0.5 rounded">
                  <i className="ti ti-shield-check text-[11px]" aria-hidden="true" />
                  Admin
                </span>
              ) : null}
              {user.contractRole ? (
                <span className="inline-flex items-center text-[9px] uppercase tracking-[0.06em] font-medium text-accent bg-accent-soft border border-accent-line px-1.5 py-0.5 rounded">
                  {CONTRACT_ROLE_LABEL[user.contractRole]}
                </span>
              ) : null}
            </div>
          </div>
        </header>

        {/* Details */}
        <dl className="px-4 py-3 flex flex-col gap-2.5">
          <Row label="Hierarchy slot">
            <span>{HIERARCHY_SLOT_LABEL[user.hierarchySlot]}</span>
            {slotLevel != null ? (
              <span className="ml-2 inline-flex text-[10px] font-medium text-primary bg-primary-soft border border-primary-line/40 px-1.5 py-0.5 rounded">
                Level {slotLevel}
              </span>
            ) : (
              <span className="ml-2 inline-flex text-[10px] font-medium text-ink-3 bg-line-2 border border-line px-1.5 py-0.5 rounded">
                Support role
              </span>
            )}
          </Row>

          <Row label="Division">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: user.division.avatarColour }}
                aria-hidden="true"
              />
              {user.division.name}
            </span>
          </Row>

          {user.subDivision ? (
            <Row label="Sub-division">{user.subDivision.name}</Row>
          ) : null}
          {user.section ? <Row label="Section">{user.section.name}</Row> : null}

          {user.isPmu && user.pmuRole ? (
            <Row label="PMU role">{PMU_ROLE_LABEL[user.pmuRole]}</Row>
          ) : null}

          <SupervisorRow user={user} supervisors={supervisors} />

          <Row label="Username">
            <span className="font-mono text-[12px]">{user.username}</span>
          </Row>

          <Row label="Last sign-in" muted>
            {user.lastLogin ? (
              <span title={format(user.lastLogin, 'd LLL yyyy, h:mm a')}>
                {formatDistanceToNow(user.lastLogin, { addSuffix: true })}
              </span>
            ) : (
              <span className="italic">Never signed in</span>
            )}
          </Row>
        </dl>

        {/* Direct reports */}
        {user.directReports.length > 0 ? (
          <section className="px-4 pb-3">
            <h4 className="section-label mb-1.5">
              Direct reports{' '}
              <span className="ml-1 text-ink-3 text-[10px] tracking-normal normal-case font-normal">
                {user.directReports.length}
              </span>
            </h4>
            <ul className="flex flex-col gap-1">
              {user.directReports.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-bg"
                >
                  <Avatar
                    initials={initialsOf(r.name)}
                    colour={r.division.avatarColour}
                    size="xs"
                    ariaLabel={r.name}
                  />
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-ink truncate">{r.name}</div>
                    <div className="text-[10px] text-ink-3 truncate">{r.designation}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Actions */}
        <footer className="px-3 py-3 border-t border-line-2 flex flex-col gap-1.5">
          <ActionButton
            icon="ti-edit"
            label="Edit details"
            onClick={() => setEditOpen(true)}
          />
          <ActionButton
            icon="ti-lock-cog"
            label="Reset password"
            onClick={() => setResetOpen(true)}
          />
          <ActionButton
            icon={user.isActive ? 'ti-user-off' : 'ti-user-check'}
            label={user.isActive ? 'Disable user' : 'Enable user'}
            danger={user.isActive && !isSelf}
            disabled={isSelf || pending}
            onClick={toggleActive}
            disabledReason={isSelf ? 'You cannot disable your own account.' : undefined}
          />
          {activeDivision && activeDivision.kind === 'division' ? (
            <ActionButton
              icon="ti-users-plus"
              label="Add member to this unit"
              onClick={() => setMembersOpen(true)}
            />
          ) : null}
          <p className="text-[10px] text-ink-3 mt-2 leading-relaxed px-2">
            <i className="ti ti-arrows-move text-[11px] mr-1" aria-hidden="true" />
            Change the supervisor by dragging the card in the chart, or with
            the Change control on the Reports-to row above.
          </p>
        </footer>
      </div>

      <EditUserDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        userId={user.id}
        defaults={user.defaults}
        divisions={divisions}
        supervisors={supervisors.filter((s) => s.id !== user.id)}
      />

      <ResetPasswordDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        userId={user.id}
        userName={user.name}
      />

      {activeDivision && allUsers ? (
        <ManageMembersDialog
          open={membersOpen}
          onClose={() => setMembersOpen(false)}
          divisionId={activeDivision.id}
          divisionName={activeDivision.name}
          pmu={null}
          existingUsers={allUsers}
          divisions={divisions}
          supervisors={supervisors.filter((s) => s.id !== user.id)}
        />
      ) : null}
    </>
  );
}

/**
 * Reports-to row with an inline, keyboard-accessible supervisor editor —
 * the non-drag path to the same setUserSupervisorAction the chart uses.
 */
function SupervisorRow({
  user,
  supervisors,
}: {
  user: InspectorUser;
  supervisors: UserFormSupervisorOption[];
}) {
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState(user.supervisor?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    const fd = new FormData();
    fd.set('userId', user.id);
    fd.set('supervisorId', choice);
    startTransition(async () => {
      const result = await setUserSupervisorAction(undefined, fd);
      if (!result.ok && result.error) {
        setError(result.error);
      } else {
        setError(null);
        setEditing(false);
      }
    });
  };

  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.08em] font-medium text-ink-3 flex items-center justify-between">
        Reports to
        <button
          type="button"
          onClick={() => {
            setEditing((v) => !v);
            setChoice(user.supervisor?.id ?? '');
            setError(null);
          }}
          aria-expanded={editing}
          className="text-[10px] font-medium text-primary tracking-normal normal-case px-1.5 py-0.5 rounded hover:bg-primary-soft transition-colors"
        >
          {editing ? 'Cancel' : 'Change'}
        </button>
      </dt>
      <dd className="text-[13px] mt-0.5 text-ink font-medium">
        {editing ? (
          <span className="flex flex-col gap-1.5 mt-1">
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              aria-label={`New supervisor for ${user.name}`}
              className="w-full px-2.5 py-1.5 rounded-lg border border-line bg-panel text-[12.5px] font-normal text-ink outline-none focus:border-ink appearance-none"
            >
              <option value="">— No supervisor (unassigned) —</option>
              {supervisors
                .filter((s) => s.id !== user.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.designation}
                  </option>
                ))}
            </select>
            {error ? (
              <span role="alert" className="text-[11px] text-urgent font-normal">
                {error}
              </span>
            ) : null}
            <button
              type="button"
              onClick={save}
              disabled={pending || choice === (user.supervisor?.id ?? '')}
              className="self-start px-2.5 py-1 rounded-md bg-ink text-onink text-[11px] font-medium disabled:opacity-50 transition-opacity"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
          </span>
        ) : user.supervisor ? (
          <span className="inline-flex items-center gap-1.5">
            <Avatar
              initials={initialsOf(user.supervisor.name)}
              colour={user.supervisor.division.avatarColour}
              size="xs"
              ariaLabel={user.supervisor.name}
            />
            <span>
              <strong className="font-medium text-ink">{user.supervisor.name}</strong>
              <span className="text-ink-3"> · {user.supervisor.designation}</span>
            </span>
          </span>
        ) : (
          <span className="text-ink-3 italic">No supervisor</span>
        )}
      </dd>
    </div>
  );
}

function Row({
  label,
  children,
  muted,
}: {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.08em] font-medium text-ink-3">
        {label}
      </dt>
      <dd
        className={cn(
          'text-[13px] mt-0.5',
          muted ? 'text-ink-2 font-normal' : 'text-ink font-medium',
        )}
      >
        {children}
      </dd>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  danger,
  disabled,
  disabledReason,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabledReason}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-line bg-panel text-[12.5px] hover:bg-bg transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-left',
        danger ? 'text-urgent' : 'text-ink',
      )}
    >
      <i
        className={cn('ti', icon, 'text-[14px]', danger ? 'text-urgent' : 'text-ink-2')}
        aria-hidden="true"
      />
      {label}
    </button>
  );
}
