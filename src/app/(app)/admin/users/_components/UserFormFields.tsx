'use client';

import { useMemo, useState } from 'react';

import { Switch } from '@/components/ui';
import {
  CONTRACT_ROLE_LABEL,
  HIERARCHY_SLOT_LABEL,
} from '@/lib/labels';
import { cn } from '@/lib/utils';
import {
  groupDivisionsByOrganization,
  organizationOf,
  type DivisionGroup,
  type OrganizationDivisions,
  type StructureKind,
} from '@/lib/structure-shared';

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
  kind: StructureKind;
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
  canAccessBusinessCards?: boolean;
  canAddJsComment?: boolean;
  canGenerateReports?: boolean;
  isOrganizationHead?: boolean;
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
  { value: 'regional_director', label: HIERARCHY_SLOT_LABEL.regional_director },
  { value: 'deputy_secretary', label: HIERARCHY_SLOT_LABEL.deputy_secretary },
  { value: 'under_secretary', label: HIERARCHY_SLOT_LABEL.under_secretary },
  { value: 'assistant_director', label: HIERARCHY_SLOT_LABEL.assistant_director },
  { value: 'section_officer', label: HIERARCHY_SLOT_LABEL.section_officer },
  { value: 'aso', label: HIERARCHY_SLOT_LABEL.aso },
  { value: 'consultant', label: HIERARCHY_SLOT_LABEL.consultant },
];

/** Picker value for divisions outside any organization (a legacy root). */
const NO_ORGANIZATION = '__none__';

function orgKeyOf(o: OrganizationDivisions): string {
  return o.organization?.id ?? NO_ORGANIZATION;
}

function orgNameOf(o: OrganizationDivisions): string {
  return o.organization?.name ?? 'Not in an organization';
}

/** Where a group of divisions sits inside its organization. */
function groupLabel(g: DivisionGroup, orgName: string): string {
  return g.path.length > 0 ? g.path.map((p) => p.name).join(' › ') : `Directly under ${orgName}`;
}

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
  // Every division, grouped by organization and then by the directorate it
  // sits in. The Organization and Division pickers and the Additional
  // divisions list all read this one grouping, so they cannot disagree — and
  // two divisions both called "NCOE" are told apart by where they sit.
  const orgGroups = useMemo(() => groupDivisionsByOrganization(divisions), [divisions]);
  const orgKeyByDivision = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of orgGroups) {
      for (const g of o.groups) for (const d of g.divisions) map.set(d.id, orgKeyOf(o));
    }
    return map;
  }, [orgGroups]);
  const subDivisionsByParent = (parentId: string) =>
    divisions.filter((d) => d.parentId === parentId && d.kind === 'sub_division');

  // The Organization picker only narrows the Division list; it is not saved.
  // A person's organization is always the one their home division sits in, so
  // editing opens on that one. A new person starts with nothing chosen (unless
  // there is only one organization), so nobody lands in the wrong one by
  // default.
  const initialOrgKey = defaults?.divisionId
    ? orgKeyByDivision.get(defaults.divisionId) ?? ''
    : orgGroups.length === 1
      ? orgKeyOf(orgGroups[0])
      : '';
  const [orgKey, setOrgKey] = useState(initialOrgKey);
  const currentOrg = orgGroups.find((o) => orgKeyOf(o) === orgKey) ?? null;
  const [divisionId, setDivisionId] = useState(defaults?.divisionId ?? '');
  const [subDivisionId, setSubDivisionId] = useState(defaults?.subDivisionId ?? '');
  const [sectionId, setSectionId] = useState(defaults?.sectionId ?? '');
  const [pmuId, setPmuId] = useState(defaults?.pmuId ?? '');
  // The organization the Organization-head toggle would make this person head
  // of — the one their home division sits in. Recomputed as the home division
  // changes, so the switch always names what it grants.
  const homeOrgId = divisionId ? organizationOf(divisionId, divisions) : null;
  const homeOrgName = homeOrgId
    ? divisions.find((d) => d.id === homeOrgId)?.name ?? null
    : null;
  // Extra divisions the user is a full member of, beyond their home division.
  const [extraDivisionIds, setExtraDivisionIds] = useState<Set<string>>(
    () => new Set(defaults?.extraDivisionIds ?? []),
  );
  // Organizations expanded in Additional divisions: the home one, and any that
  // already hold a membership, so nothing already selected starts out hidden.
  const [openOrgs, setOpenOrgs] = useState<Set<string>>(() => {
    const open = new Set<string>();
    if (initialOrgKey) open.add(initialOrgKey);
    for (const id of defaults?.extraDivisionIds ?? []) {
      const key = orgKeyByDivision.get(id);
      if (key) open.add(key);
    }
    return open;
  });
  // A division can't be both home and an extra membership, so the home one is
  // shown as such rather than offered.
  const hasExtraOptions = orgGroups.some((o) =>
    o.groups.some((g) => g.divisions.some((d) => d.id !== divisionId)),
  );

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
        <label className="mt-2 flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-line">
          <span className="inline-flex items-center gap-2 text-[12px] text-ink">
            <i className="ti ti-address-book text-[14px] text-primary" aria-hidden="true" />
            Business Cards access
          </span>
          <Switch
            name="canAccessBusinessCards"
            defaultChecked={defaults?.canAccessBusinessCards}
            ariaLabel="Grant Business Cards access"
          />
        </label>
        <label className="mt-2 flex items-start justify-between gap-3 px-3 py-2.5 rounded-lg border border-line">
          <span className="min-w-0">
            <span className="inline-flex items-center gap-2 text-[12px] text-ink">
              <i className="ti ti-message-2 text-[14px] text-primary" aria-hidden="true" />
              JS Comment access
            </span>
            <span className="mt-0.5 block text-[11px] text-ink-3">
              Lets this user add the JS Comment on tasks in the Daily/Weekly/
              Fortnight/Monthly board. Off by default even for leadership;
              Super Admin always can.
            </span>
          </span>
          <Switch
            name="canAddJsComment"
            defaultChecked={defaults?.canAddJsComment}
            ariaLabel="Grant JS Comment access"
          />
        </label>
        <label className="mt-2 flex items-start justify-between gap-3 px-3 py-2.5 rounded-lg border border-line">
          <span className="min-w-0">
            <span className="inline-flex items-center gap-2 text-[12px] text-ink">
              <i className="ti ti-report text-[14px] text-primary" aria-hidden="true" />
              Report generation access
            </span>
            <span className="mt-0.5 block text-[11px] text-ink-3">
              Lets this user generate the Priority Task Report PDF from the
              tasks homepage. Super Admin, OSD, and division heads always can.
            </span>
          </span>
          <Switch
            name="canGenerateReports"
            defaultChecked={defaults?.canGenerateReports}
            ariaLabel="Grant report generation access"
          />
        </label>
        <label className="mt-2 flex items-start justify-between gap-3 px-3 py-2.5 rounded-lg border border-line">
          <span className="min-w-0">
            <span className="inline-flex items-center gap-2 text-[12px] text-ink">
              <i className="ti ti-building-community text-[14px] text-primary" aria-hidden="true" />
              Organization head
            </span>
            <span className="mt-0.5 block text-[11px] text-ink-3">
              {homeOrgName
                ? `Head of ${homeOrgName}, with full head powers over every directorate and division in it. Super Admins head every organization already.`
                : 'Makes this person head of the organization their home division sits in. Pick a home division first.'}
            </span>
          </span>
          <Switch
            name="isOrganizationHead"
            defaultChecked={defaults?.isOrganizationHead}
            ariaLabel="Make organization head"
          />
        </label>
      </Section>

      {/* Placement */}
      <Section title="Placement" full>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field
            label="Organization"
            hint={currentOrg ? undefined : 'Choose one to see its divisions'}
          >
            <select
              value={orgKey}
              onChange={(e) => {
                const value = e.target.value;
                setOrgKey(value);
                // A division of the previous organization no longer applies.
                setDivisionId('');
                setSubDivisionId('');
                setSectionId('');
                setPmuId('');
                setOpenOrgs((prev) => new Set(prev).add(value));
              }}
              required
              className={selectCn(false)}
            >
              <option value="" disabled>
                Choose an organization…
              </option>
              {orgGroups.map((o) => (
                <option key={orgKeyOf(o)} value={orgKeyOf(o)}>
                  {orgNameOf(o)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Division"
            error={fieldErrors?.divisionId}
            hint={
              currentOrg && currentOrg.divisionCount === 0
                ? 'No divisions in this organization yet — add one in Structure & hierarchy'
                : undefined
            }
          >
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
              disabled={!currentOrg}
              className={selectCn(!!fieldErrors?.divisionId)}
            >
              <option value="" disabled>
                {currentOrg ? 'Choose a division…' : 'Choose an organization first'}
              </option>
              {currentOrg ? divisionOptions(currentOrg) : null}
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
        {!hasExtraOptions ? (
          <p className="text-[11px] text-ink-3">No other divisions available.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {orgGroups
              .filter((o) => o.divisionCount > 0)
              .map((o) => {
                const key = orgKeyOf(o);
                const orgName = orgNameOf(o);
                const isOpen = openOrgs.has(key);
                const isHomeOrg = o.organization !== null && o.organization.id === homeOrgId;
                const selectedCount = o.groups.reduce(
                  (n, g) => n + g.divisions.filter((d) => extraDivisionIds.has(d.id)).length,
                  0,
                );
                // Sub-headings only when there is more than one place to tell
                // apart — an organization with no directorates stays one list.
                const hasDirectorates = o.groups.some((g) => g.path.length > 0);
                return (
                  <details
                    key={key}
                    open={isOpen}
                    onToggle={(e) => {
                      const open = e.currentTarget.open;
                      setOpenOrgs((prev) => {
                        if (prev.has(key) === open) return prev;
                        const next = new Set(prev);
                        if (open) next.add(key);
                        else next.delete(key);
                        return next;
                      });
                    }}
                    className="rounded-lg border border-line"
                  >
                    <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
                      <i
                        className={cn(
                          'ti ti-chevron-right text-[13px] text-ink-3 transition-transform',
                          isOpen && 'rotate-90',
                        )}
                        aria-hidden="true"
                      />
                      <i className="ti ti-building-community text-[14px] text-primary" aria-hidden="true" />
                      <span className="min-w-0 truncate text-[12.5px] font-medium text-ink">{orgName}</span>
                      {isHomeOrg ? (
                        <span className="shrink-0 rounded-md bg-line-2 px-1.5 py-0.5 text-[10px] text-ink-3">
                          Home organization
                        </span>
                      ) : null}
                      <span className="ml-auto shrink-0 text-[11px] text-ink-3">
                        {selectedCount > 0 ? `${selectedCount} selected · ` : ''}
                        {o.divisionCount} {o.divisionCount === 1 ? 'division' : 'divisions'}
                      </span>
                    </summary>
                    <div className="flex flex-col gap-3 border-t border-line-2 px-3 py-3">
                      {o.groups.map((g) => (
                        <div key={g.key}>
                          {hasDirectorates ? (
                            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-ink-2">
                              <i
                                className={cn(
                                  'ti text-[13px] text-ink-3',
                                  g.path.length > 0 ? 'ti-sitemap' : 'ti-building-community',
                                )}
                                aria-hidden="true"
                              />
                              {groupLabel(g, orgName)}
                            </p>
                          ) : null}
                          <div
                            className={cn(
                              'grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2',
                              hasDirectorates && 'pl-5',
                            )}
                          >
                            {g.divisions.map((d) =>
                              d.id === divisionId ? (
                                <span
                                  key={d.id}
                                  className="flex min-w-0 items-center gap-2 text-[12.5px] text-ink-3"
                                >
                                  <i className="ti ti-home text-[14px] shrink-0" aria-hidden="true" />
                                  <span className="truncate">{d.name}</span>
                                  <span className="shrink-0 rounded-md bg-line-2 px-1.5 py-0.5 text-[10px]">
                                    Home division
                                  </span>
                                </span>
                              ) : (
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
                              ),
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })}
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

/**
 * The Division picker's options for one organization: a plain list when it has
 * no directorates (the ministry today), otherwise one group per place —
 * "Directly under SAI", "RC Bengaluru" — so same-named divisions are told
 * apart by where they sit.
 */
function divisionOptions(org: OrganizationDivisions) {
  const orgName = orgNameOf(org);
  if (org.groups.every((g) => g.path.length === 0)) {
    return org.groups
      .flatMap((g) => g.divisions)
      .map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ));
  }
  return org.groups.map((g) => (
    <optgroup key={g.key} label={groupLabel(g, orgName)}>
      {g.divisions.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </optgroup>
  ));
}

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
