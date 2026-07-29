'use client';

import { useState } from 'react';

import { Switch } from '@/components/ui';
import {
  CONTRACT_ROLE_LABEL,
  HIERARCHY_SLOT_LABEL,
} from '@/lib/labels';
import { cn } from '@/lib/utils';

/**
 * Shared form fields used inside Create and Edit dialogs.
 *
 * Keep this dumb — it renders inputs with `defaultValue` and exposes its
 * state via standard form submission. The dialog wraps it in a <form>
 * and wires the server action.
 */

export type UserFormDivisionOption = {
  id: string;
  name: string;
  parentId: string | null;
  pmuParentDivisionId: string | null;
  kind: 'division' | 'sub_division' | 'section' | 'pmu';
};

export type UserFormSupervisorOption = {
  id: string;
  name: string;
  designation: string;
};

export type UserFormDefaults = {
  name?: string;
  username?: string;
  designation?: string;
  hierarchySlot?: string;
  contractRole?: string;
  divisionId?: string;
  subDivisionId?: string | null;
  sectionId?: string | null;
  pmuId?: string | null;
  /** Extra divisions this user is a full member of, beyond their home division. */
  extraDivisionIds?: string[];
  supervisorId?: string | null;
  isSuperAdmin?: boolean;
  canAccessDocumentCentre?: boolean;
};

type UserFormFieldsProps = {
  mode: 'create' | 'edit';
  divisions: UserFormDivisionOption[];
  supervisors: UserFormSupervisorOption[];
  defaults?: UserFormDefaults;
  fieldErrors?: Record<string, string>;
  /** Mark the username + password fields readonly when editing. */
  identityLocked?: boolean;
};

const SLOTS: { value: string; label: string }[] = [
  { value: 'hmyas', label: HIERARCHY_SLOT_LABEL.hmyas },
  { value: 'js', label: HIERARCHY_SLOT_LABEL.js },
  { value: 'osd', label: HIERARCHY_SLOT_LABEL.osd },
  { value: 'director', label: HIERARCHY_SLOT_LABEL.director },
  { value: 'deputy_secretary', label: HIERARCHY_SLOT_LABEL.deputy_secretary },
  { value: 'under_secretary', label: HIERARCHY_SLOT_LABEL.under_secretary },
  { value: 'section_officer', label: HIERARCHY_SLOT_LABEL.section_officer },
  { value: 'aso', label: HIERARCHY_SLOT_LABEL.aso },
  { value: 'consultant', label: HIERARCHY_SLOT_LABEL.consultant },
];

const CONTRACT_OPTIONS = [
  { value: '', label: '— None —' },
  { value: 'po', label: CONTRACT_ROLE_LABEL.po },
  { value: 'apo', label: CONTRACT_ROLE_LABEL.apo },
  { value: 'yp', label: CONTRACT_ROLE_LABEL.yp },
];

export function UserFormFields({
  mode,
  divisions,
  supervisors,
  defaults,
  fieldErrors,
  identityLocked,
}: UserFormFieldsProps) {
  const topDivisions = divisions.filter((d) => d.kind === 'division');
  const subDivisionsByParent = (parentId: string) =>
    divisions.filter((d) => d.parentId === parentId && d.kind === 'sub_division');

  const [divisionId, setDivisionId] = useState(defaults?.divisionId ?? topDivisions[0]?.id ?? '');
  const [subDivisionId, setSubDivisionId] = useState(defaults?.subDivisionId ?? '');
  const [sectionId, setSectionId] = useState(defaults?.sectionId ?? '');
  const [pmuId, setPmuId] = useState(defaults?.pmuId ?? '');
  // Extra divisions the user is a full member of, beyond their home division.
  const [extraDivisionIds, setExtraDivisionIds] = useState<Set<string>>(
    () => new Set(defaults?.extraDivisionIds ?? []),
  );

  // Extra-membership options are the top-level divisions other than the home
  // division (a division can't be both home and an extra membership).
  const extraOptions = topDivisions.filter((d) => d.id !== divisionId);

  const subDivisions = divisionId ? subDivisionsByParent(divisionId) : [];
  const sections = subDivisionId
    ? divisions.filter((d) => d.parentId === subDivisionId && d.kind === 'section')
    : [];
  const pmus = divisionId
    ? divisions.filter(
        (d) =>
          d.kind === 'pmu' &&
          (d.pmuParentDivisionId === divisionId || d.parentId === divisionId),
      )
    : [];

  // PMU members sit outside the sub-division/section ladder — selecting a
  // PMU makes those two fields not applicable (cleared and disabled; the
  // server nulls them as well).
  const isPmuMember = pmuId !== '';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Identity */}
      <Section title="Identity" full>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Name" error={fieldErrors?.name}>
            <input
              name="name"
              defaultValue={defaults?.name}
              maxLength={120}
              required
              autoComplete="off"
              className={inputCn(!!fieldErrors?.name)}
            />
          </Field>
          <Field label="Username" hint="a–z, 0–9, dots, underscores" error={fieldErrors?.username}>
            <input
              name="username"
              defaultValue={defaults?.username}
              maxLength={40}
              required={mode === 'create'}
              readOnly={identityLocked}
              autoComplete="off"
              className={cn(inputCn(!!fieldErrors?.username), 'font-mono', identityLocked && 'opacity-60 cursor-not-allowed')}
            />
          </Field>
          <Field label="Designation" error={fieldErrors?.designation}>
            <input
              name="designation"
              defaultValue={defaults?.designation}
              maxLength={120}
              required
              autoComplete="off"
              className={inputCn(!!fieldErrors?.designation)}
            />
          </Field>
        </div>
      </Section>

      {/* Initial password (create only) */}
      {mode === 'create' ? (
        <Section title="Initial password" full>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
            <Field
              label="Initial password"
              hint="Share offline. The user can change it from their profile."
              error={fieldErrors?.password}
            >
              <input
                name="password"
                type="text"
                minLength={8}
                maxLength={200}
                required
                autoComplete="off"
                className={cn(inputCn(!!fieldErrors?.password), 'font-mono')}
              />
            </Field>
            <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-line">
              <span className="text-[12px] text-ink">
                Force password change on next sign-in
              </span>
              <Switch
                name="forcePasswordChange"
                defaultChecked={true}
                ariaLabel="Force password change on next sign-in"
              />
            </label>
          </div>
        </Section>
      ) : null}

      {/* Role */}
      <Section title="Role" full>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Hierarchy slot" error={fieldErrors?.hierarchySlot}>
            <select
              name="hierarchySlot"
              defaultValue={defaults?.hierarchySlot}
              required
              className={selectCn(!!fieldErrors?.hierarchySlot)}
            >
              <option value="" disabled>
                Choose a slot…
              </option>
              {SLOTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Contract role" hint="Optional — overlay on a slot">
            <select
              name="contractRole"
              defaultValue={defaults?.contractRole ?? ''}
              className={selectCn(false)}
            >
              {CONTRACT_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="mt-3 flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-line">
          <span className="inline-flex items-center gap-2 text-[12px] text-ink">
            <i className="ti ti-shield-check text-[14px] text-primary" aria-hidden="true" />
            Super Admin access
          </span>
          <Switch
            name="isSuperAdmin"
            defaultChecked={defaults?.isSuperAdmin}
            ariaLabel="Grant Super Admin access"
          />
        </label>
        <label className="mt-2 flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-line">
          <span className="inline-flex items-center gap-2 text-[12px] text-ink">
            <i className="ti ti-files text-[14px] text-primary" aria-hidden="true" />
            Document Centre access
          </span>
          <Switch
            name="canAccessDocumentCentre"
            defaultChecked={defaults?.canAccessDocumentCentre}
            ariaLabel="Grant Document Centre access"
          />
        </label>
      </Section>

      {/* Placement */}
      <Section title="Placement" full>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Division" error={fieldErrors?.divisionId}>
            <select
              name="divisionId"
              value={divisionId}
              onChange={(e) => {
                const value = e.target.value;
                setDivisionId(value);
                setSubDivisionId('');
                setSectionId('');
                setPmuId('');
                // The new home division can't also be an extra membership.
                setExtraDivisionIds((prev) => {
                  const next = new Set(prev);
                  next.delete(value);
                  return next;
                });
              }}
              required
              className={selectCn(!!fieldErrors?.divisionId)}
            >
              {topDivisions.length === 0 ? (
                <option value="">No divisions yet</option>
              ) : null}
              {topDivisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Sub-division"
            hint={
              isPmuMember
                ? 'Not applicable for PMU members'
                : subDivisions.length === 0
                  ? 'None available for this division'
                  : undefined
            }
          >
            <select
              name="subDivisionId"
              value={isPmuMember ? '' : subDivisionId}
              onChange={(e) => {
                setSubDivisionId(e.target.value);
                setSectionId('');
              }}
              className={selectCn(false)}
              disabled={isPmuMember || subDivisions.length === 0}
            >
              <option value="">— None —</option>
              {subDivisions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Section"
            error={fieldErrors?.sectionId}
            hint={
              isPmuMember
                ? 'Not applicable for PMU members'
                : sections.length === 0
                  ? 'None available for this sub-division'
                  : undefined
            }
          >
            <select
              name="sectionId"
              value={isPmuMember ? '' : sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              className={selectCn(!!fieldErrors?.sectionId)}
              disabled={isPmuMember || sections.length === 0}
            >
              <option value="">— None —</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="PMU"
            error={fieldErrors?.pmuId}
            hint={
              pmus.length === 0
                ? 'No PMU teams for this division'
                : 'Marks the user as a PMU member'
            }
          >
            <select
              name="pmuId"
              value={pmuId}
              onChange={(e) => {
                setPmuId(e.target.value);
                if (e.target.value) {
                  setSubDivisionId('');
                  setSectionId('');
                }
              }}
              className={selectCn(!!fieldErrors?.pmuId)}
              disabled={pmus.length === 0}
            >
              <option value="">— None —</option>
              {pmus.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      {/* Additional divisions — full membership beyond the home division */}
      <Section title="Additional divisions" full>
        <p className="text-[11px] text-ink-3 mb-2.5 leading-relaxed">
          Full member of these divisions in addition to the home division above.
          The user sees their tasks and timeline files, can be assigned work and
          collaborate there, and can group by division — but gains no head powers
          and cannot create division tasks unless they head that division.
        </p>
        {extraOptions.length === 0 ? (
          <p className="text-[11px] text-ink-3">No other divisions available.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
            {extraOptions.map((d) => (
              <label
                key={d.id}
                className="flex items-center gap-2 text-[12.5px] text-ink cursor-pointer"
              >
                <input
                  type="checkbox"
                  name="extraDivisionIds"
                  value={d.id}
                  checked={extraDivisionIds.has(d.id)}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setExtraDivisionIds((prev) => {
                      const next = new Set(prev);
                      if (checked) next.add(d.id);
                      else next.delete(d.id);
                      return next;
                    });
                  }}
                  className="h-3.5 w-3.5 rounded border-line accent-ink"
                />
                {d.name}
              </label>
            ))}
          </div>
        )}
      </Section>

      {/* Supervisor */}
      <Section title="Reporting" full>
        <Field label="Reports to" error={fieldErrors?.supervisorId} hint="Optional">
          <select
            name="supervisorId"
            defaultValue={defaults?.supervisorId ?? ''}
            className={selectCn(!!fieldErrors?.supervisorId)}
          >
            <option value="">— None —</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.designation}
              </option>
            ))}
          </select>
        </Field>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------

function Section({
  title,
  children,
  full,
}: {
  title: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <fieldset
      className={cn(
        'border border-line rounded-xl px-4 py-3.5',
        full ? 'md:col-span-2' : '',
      )}
    >
      <legend className="px-1.5 section-label">{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-ink-2">{label}</span>
      {children}
      {error ? (
        <span className="text-[11px] text-urgent">{error}</span>
      ) : hint ? (
        <span className="text-[11px] text-ink-3">{hint}</span>
      ) : null}
    </label>
  );
}

function inputCn(hasError: boolean) {
  return cn(
    'w-full px-3 py-2 rounded-lg border bg-panel text-[13px] text-ink outline-none transition-colors',
    hasError ? 'border-urgent focus:border-urgent' : 'border-line focus:border-ink',
  );
}

function selectCn(hasError: boolean) {
  return cn(
    'w-full px-3 py-2 rounded-lg border bg-panel text-[13px] text-ink outline-none transition-colors appearance-none',
    hasError ? 'border-urgent focus:border-urgent' : 'border-line focus:border-ink',
  );
}
