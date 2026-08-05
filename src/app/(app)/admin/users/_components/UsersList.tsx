'use client';

import { format, formatDistanceToNow } from 'date-fns';

import { Avatar } from '@/components/ui';
import { initialsOf } from '@/lib/format';
import {
  CONTRACT_ROLE_LABEL,
  HIERARCHY_SLOT_LABEL,
} from '@/lib/labels';
import { cn } from '@/lib/utils';

import { UserRowMenu } from './UserRowMenu';
import type {
  UserFormDefaults,
  UserFormDivisionOption,
  UserFormSupervisorOption,
} from './UserFormFields';

export type UserRow = {
  id: string;
  name: string;
  username: string;
  designation: string;
  hierarchySlot: string;
  contractRole: string | null;
  divisionName: string;
  divisionColour: string;
  subDivisionName: string | null;
  subDivisionId: string | null;
  sectionId: string | null;
  pmuId: string | null;
  divisionId: string;
  /** Extra divisions this user is a full member of, beyond their home division. */
  extraDivisionIds: string[];
  supervisorId: string | null;
  isActive: boolean;
  isSuperAdmin: boolean;
  canAccessDocumentCentre: boolean;
  canAccessBusinessCards: boolean;
  lastLogin: Date | null;
};

type UsersListProps = {
  users: UserRow[];
  divisions: UserFormDivisionOption[];
  supervisors: UserFormSupervisorOption[];
  selfId: string;
};

export function UsersList({ users, divisions, supervisors, selfId }: UsersListProps) {
  if (users.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-panel p-10 text-center">
        <i className="ti ti-users-group text-[28px] text-ink-3 mb-2 block" aria-hidden="true" />
        <p className="text-[13px] text-ink-2">
          No users match this filter. Try a different chip or clear filters.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-panel overflow-hidden">
      {/* Desktop table */}
      <table className="w-full hidden md:table">
        <thead>
          <tr className="text-left bg-bg border-b border-line">
            <Th>Person</Th>
            <Th>Slot</Th>
            <Th>Division</Th>
            <Th>Status</Th>
            <Th>Last sign-in</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <DesktopRow
              key={u.id}
              user={u}
              divisions={divisions}
              supervisors={supervisors}
              isSelf={u.id === selfId}
            />
          ))}
        </tbody>
      </table>

      {/* Mobile cards */}
      <ul className="md:hidden divide-y divide-line-2">
        {users.map((u) => (
          <MobileRow
            key={u.id}
            user={u}
            divisions={divisions}
            supervisors={supervisors}
            isSelf={u.id === selfId}
          />
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------
// Row variants
// ------------------------------------------------------------

function DesktopRow({
  user: u,
  divisions,
  supervisors,
  isSelf,
}: {
  user: UserRow;
  divisions: UserFormDivisionOption[];
  supervisors: UserFormSupervisorOption[];
  isSelf: boolean;
}) {
  return (
    <tr
      className={cn('border-b border-line-2 last:border-b-0', !u.isActive && 'opacity-60')}
    >
      <Td>
        <div className="flex items-center gap-3 min-w-0">
          <Avatar initials={initialsOf(u.name)} colour={u.divisionColour} size="md" ariaLabel={u.name} />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-ink truncate flex items-center gap-1.5">
              {u.name}
              {u.isSuperAdmin ? (
                <span
                  title="Super Admin"
                  className="inline-flex items-center text-[9px] uppercase tracking-[0.06em] font-medium text-primary bg-primary-soft border border-primary-line/40 px-1 py-0.5 rounded"
                >
                  <i className="ti ti-shield-check text-[11px] mr-0.5" aria-hidden="true" />
                  Admin
                </span>
              ) : null}
            </div>
            <div className="text-[11px] text-ink-3 truncate">
              <span className="font-mono">{u.username}</span> · {u.designation}
            </div>
          </div>
        </div>
      </Td>
      <Td>
        <div className="text-[12.5px] text-ink">{HIERARCHY_SLOT_LABEL[u.hierarchySlot]}</div>
        {u.contractRole ? (
          <div className="mt-0.5 inline-flex items-center text-[9px] uppercase tracking-[0.04em] font-medium text-accent bg-accent-soft border border-accent-line px-1 py-0.5 rounded">
            {CONTRACT_ROLE_LABEL[u.contractRole]}
          </div>
        ) : null}
      </Td>
      <Td>
        <div className="inline-flex items-center gap-1.5 text-[12.5px] text-ink">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: u.divisionColour }}
            aria-hidden="true"
          />
          {u.divisionName}
        </div>
        {u.subDivisionName ? (
          <div className="text-[11px] text-ink-3 mt-0.5 ml-3.5">{u.subDivisionName}</div>
        ) : null}
      </Td>
      <Td>
        <StatusPill active={u.isActive} />
      </Td>
      <Td>
        <LastLogin date={u.lastLogin} />
      </Td>
      <Td className="text-right">
        <UserRowMenu
          user={{
            id: u.id,
            name: u.name,
            username: u.username,
            isActive: u.isActive,
            divisionId: u.divisionId,
            defaults: rowToDefaults(u),
          }}
          divisions={divisions}
          supervisors={supervisors}
          isSelf={isSelf}
        />
      </Td>
    </tr>
  );
}

function MobileRow({
  user: u,
  divisions,
  supervisors,
  isSelf,
}: {
  user: UserRow;
  divisions: UserFormDivisionOption[];
  supervisors: UserFormSupervisorOption[];
  isSelf: boolean;
}) {
  return (
    <li className={cn('p-3.5 flex items-start gap-3', !u.isActive && 'opacity-60')}>
      <Avatar initials={initialsOf(u.name)} colour={u.divisionColour} size="md" ariaLabel={u.name} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium text-ink truncate inline-flex items-center gap-1.5">
              {u.name}
              {u.isSuperAdmin ? (
                <i className="ti ti-shield-check text-[14px] text-primary" aria-label="Super Admin" />
              ) : null}
            </div>
            <div className="text-[11px] text-ink-3 truncate">
              <span className="font-mono">{u.username}</span> · {u.designation}
            </div>
          </div>
          <UserRowMenu
            user={{
              id: u.id,
              name: u.name,
              username: u.username,
              isActive: u.isActive,
              divisionId: u.divisionId,
              defaults: rowToDefaults(u),
            }}
            divisions={divisions}
            supervisors={supervisors}
            isSelf={isSelf}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5 items-center">
          <span className="text-[11px] text-ink-2">{HIERARCHY_SLOT_LABEL[u.hierarchySlot]}</span>
          <span className="text-ink-4">·</span>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: u.divisionColour }}
              aria-hidden="true"
            />
            {u.divisionName}
          </span>
          <StatusPill active={u.isActive} />
        </div>
        <div className="mt-1 text-[11px] text-ink-3">
          <LastLogin date={u.lastLogin} />
        </div>
      </div>
    </li>
  );
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function rowToDefaults(u: UserRow): UserFormDefaults {
  return {
    name: u.name,
    username: u.username,
    designation: u.designation,
    hierarchySlot: u.hierarchySlot,
    contractRole: u.contractRole ?? '',
    divisionId: u.divisionId,
    subDivisionId: u.subDivisionId,
    sectionId: u.sectionId,
    pmuId: u.pmuId,
    extraDivisionIds: u.extraDivisionIds,
    supervisorId: u.supervisorId,
    isSuperAdmin: u.isSuperAdmin,
    canAccessDocumentCentre: u.canAccessDocumentCentre,
    canAccessBusinessCards: u.canAccessBusinessCards,
  };
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-[10px] font-medium tracking-pill border',
        active
          ? 'bg-success-soft text-success border-success/20'
          : 'bg-low-soft text-low border-line',
      )}
    >
      <i
        className={cn('ti text-[10px]', active ? 'ti-circle-check' : 'ti-circle-x')}
        aria-hidden="true"
      />
      {active ? 'Active' : 'Disabled'}
    </span>
  );
}

function LastLogin({ date }: { date: Date | null }) {
  if (!date) return <span className="text-[11px] text-ink-3 italic">Never signed in</span>;
  return (
    <span className="text-[11px] text-ink-3" title={format(date, 'd LLL yyyy, h:mm a')}>
      {formatDistanceToNow(date, { addSuffix: true })}
    </span>
  );
}

// ------------------------------------------------------------
// Table cell primitives
// ------------------------------------------------------------

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'text-[10px] uppercase tracking-[0.06em] font-medium text-ink-3 px-3.5 py-2.5',
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('px-3.5 py-3 align-middle', className)}>{children}</td>;
}
