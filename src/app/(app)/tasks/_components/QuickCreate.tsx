'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import {
  FloatingActionButton,
  PrimaryAction,
} from '@/components/layout';
import { Sheet, Switch, UserPicker, type UserPickerOption } from '@/components/ui';
import { createTaskAction } from '@/app/actions/tasks';
import { registerAttachmentAction } from '@/app/actions/attachments';
import {
  INITIAL_CREATE_STATE,
  type CreateTaskState,
} from '@/app/actions/states';
import { guessContentType } from '@/lib/mime';
import { formatBytes, MAX_UPLOAD_BYTES } from '@/lib/s3';
import { cn } from '@/lib/utils';

// ------------------------------------------------------------
// Context
// ------------------------------------------------------------

/** Optional values to prefill when opening the sheet (e.g. from the calendar). */
export type QuickCreatePrefill = { dueDate?: string };

type QuickCreateContextValue = {
  open: (prefill?: QuickCreatePrefill) => void;
};

const QuickCreateContext = createContext<QuickCreateContextValue | null>(null);

export function useQuickCreate(): QuickCreateContextValue {
  const ctx = useContext(QuickCreateContext);
  if (!ctx) throw new Error('useQuickCreate must be used inside QuickCreateProvider');
  return ctx;
}

// ------------------------------------------------------------
// Provider
// ------------------------------------------------------------

/** A division or PMU a division-task creator may target (Structure & Hierarchy). */
export type DivisionTarget = {
  id: string;
  name: string;
  kind: string;
  /** True for the seeded "Office of JS" division, which may be owned by anyone. */
  isOfficeOfJs: boolean;
  /** The division head, or a PMU's team leader — offered as a one-click pill. */
  autoOwnerId: string | null;
  autoOwnerName: string | null;
  /** Sub-divisions of this division; empty when it has none (or it's a PMU). */
  subDivisions: { id: string; name: string }[];
  /**
   * PMU teams hanging off this division. Empty for a PMU target and for a
   * division with no PMU — the "Show this task to PMU team" switch is offered
   * only when this is non-empty, so a division with no PMU never shows it.
   */
  pmuNames: string[];
};

/** An active member of a create target, offered as an optional initial owner. */
export type OwnerCandidate = {
  id: string;
  name: string;
  designation: string;
  divisionId: string;
  pmuId: string | null;
  /** Target divisions this user may own tasks in (home + admin-granted extras). */
  memberDivisionIds: string[];
  divisionName: string;
  divisionColour: string;
};

/** The OSD account — a quick-pick owner on Office-of-JS tasks. */
export type OsdAccount = { id: string; name: string };

/**
 * Where the create targets sit, for the Organization → Directorate → Division
 * pickers. Built on the server from the same targets (groupByPlacement), so it
 * only ever holds organizations and directorates the caller can create in.
 */
export type TargetOrganization = {
  /** The organization's id, or '__none__' for targets outside any organization. */
  key: string;
  name: string;
  groups: {
    key: string;
    /** The directorate these targets sit in; null when directly under the organization. */
    directorate: string | null;
    /** The targets here, in display order: divisions, then PMU teams. */
    targetIds: string[];
  }[];
};

type ProviderProps = {
  defaultDivisionId: string;
  s3Configured: boolean;
  /** Division-level creation is a head power — see canCreateDivisionTask. */
  /** Divisions + PMUs the caller may create a task in (auto-owns to head/leader). */
  createTargets: DivisionTarget[];
  /** Active members of those targets — the optional initial-owner pool. */
  ownerCandidates: OwnerCandidate[];
  /** OSD account, for the quick-pick pill on Office-of-JS tasks. */
  osdAccount: OsdAccount | null;
  /** The same targets by organization and directorate — see TargetOrganization. */
  targetGroups: TargetOrganization[];
  children: ReactNode;
};

export function QuickCreateProvider({
  defaultDivisionId,
  s3Configured,
  createTargets,
  ownerCandidates,
  osdAccount,
  targetGroups,
  children,
}: ProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [prefill, setPrefill] = useState<QuickCreatePrefill | null>(null);
  const close = () => setIsOpen(false);
  const open = (p?: QuickCreatePrefill) => {
    setPrefill(p ?? null);
    setIsOpen(true);
  };

  return (
    <QuickCreateContext.Provider value={{ open }}>
      {children}

      <Sheet open={isOpen} onClose={close} title="Quick create">
        {isOpen ? (
          <QuickCreateForm
            onSuccess={close}
            defaultDivisionId={defaultDivisionId}
            s3Configured={s3Configured}
            createTargets={createTargets}
            ownerCandidates={ownerCandidates}
            osdAccount={osdAccount}
            targetGroups={targetGroups}
            prefillDueDate={prefill?.dueDate}
          />
        ) : null}
      </Sheet>
    </QuickCreateContext.Provider>
  );
}

// ------------------------------------------------------------
// Triggers
// ------------------------------------------------------------

export function QuickCreateFab() {
  const { open } = useQuickCreate();
  return (
    <div className="md:hidden">
      <FloatingActionButton onClick={open} />
    </div>
  );
}

export function QuickCreatePrimary() {
  const { open } = useQuickCreate();
  return <PrimaryAction onClick={open} />;
}

// ------------------------------------------------------------
// Form
// ------------------------------------------------------------

type FormProps = {
  onSuccess: () => void;
  defaultDivisionId: string;
  s3Configured: boolean;
  createTargets: DivisionTarget[];
  ownerCandidates: OwnerCandidate[];
  osdAccount: OsdAccount | null;
  targetGroups: TargetOrganization[];
  /** Prefilled due date (YYYY-MM-DD), e.g. when created from the calendar. */
  prefillDueDate?: string;
};

/** The target pickers. A picker with one choice is locked, not hidden. */
const TARGET_SELECT =
  'w-full px-3 py-2.5 rounded-lg border border-line bg-panel text-[14px] text-ink outline-none focus:border-ink appearance-none disabled:bg-bg disabled:text-ink-2 disabled:opacity-100';

const PRIORITIES = [
  { value: 'low', label: 'Low', tone: 'text-low' },
  { value: 'medium', label: 'Medium', tone: 'text-medium' },
  { value: 'high', label: 'High', tone: 'text-high' },
  { value: 'urgent', label: 'Urgent', tone: 'text-urgent' },
] as const;

function QuickCreateForm({
  onSuccess,
  defaultDivisionId,
  s3Configured,
  createTargets,
  ownerCandidates,
  osdAccount,
  targetGroups,
  prefillDueDate,
}: FormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, formAction] = useFormState<CreateTaskState, FormData>(
    createTaskAction,
    INITIAL_CREATE_STATE,
  );

  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]['value']>('low');
  // Which division/PMU the task lands on — ownership auto-resolves to that
  // division's head or the PMU's team leader on the server. Prefilled from
  // where the caller sits (their home division, or a PMU member's PMU) when
  // that is a valid target, else the first.
  const initialTargetId = createTargets.some((t) => t.id === defaultDivisionId)
    ? defaultDivisionId
    : createTargets[0]?.id ?? defaultDivisionId;
  const [divisionId, setDivisionId] = useState(initialTargetId);
  // Organization, then directorate — the pickers in front of the target. Both
  // open on wherever the prefilled target sits.
  const placeOf = (targetId: string) => {
    for (const o of targetGroups) {
      for (const g of o.groups) {
        if (g.targetIds.includes(targetId)) return { orgKey: o.key, groupKey: g.key };
      }
    }
    return null;
  };
  const [orgKey, setOrgKey] = useState(
    () => placeOf(initialTargetId)?.orgKey ?? targetGroups[0]?.key ?? '',
  );
  const [groupKey, setGroupKey] = useState(
    () => placeOf(initialTargetId)?.groupKey ?? targetGroups[0]?.groups[0]?.key ?? '',
  );
  const currentOrg = targetGroups.find((o) => o.key === orgKey) ?? null;
  const currentGroup = currentOrg?.groups.find((g) => g.key === groupKey) ?? null;
  // Offered only where the organization is split into directorates — the
  // ministry is not, so its people see Organization and Division alone.
  const showDirectorate = !!currentOrg && currentOrg.groups.some((g) => g.directorate !== null);
  const groupTargets = (currentGroup?.targetIds ?? [])
    .map((id) => createTargets.find((t) => t.id === id))
    .filter((t): t is DivisionTarget => t !== undefined);
  // Optional initial owner. Empty = today's default (a division task starts
  // unassigned; a PMU task goes to its team leader — resolved on the server).
  // Cleared whenever the target/visibility changes so a stale cross-division
  // pick can't be submitted.
  const [ownerId, setOwnerId] = useState('');
  // Optional sub-division within the chosen division. Empty = whole division.
  // Reset alongside ownerId so a sub-division from a previously-chosen
  // division can't be submitted against a different one.
  const [subDivisionId, setSubDivisionId] = useState('');
  // "Show this task to PMU team" — only ever submitted while its switch is on
  // screen (the Switch renders the hidden input), and re-derived whenever the
  // target changes so a choice made for one board can't ride along to another.
  //
  // A PMU's own task starts ON: work on a PMU board is the team's work, and
  // every member should see it in their assigned list from the start. A
  // division task starts OFF — showing it down to a PMU punches a hole in PMU
  // isolation, so it is opted into, never assumed.
  const [shareWithPmu, setShareWithPmu] = useState(
    () => createTargets.find((t) => t.id === divisionId)?.kind === 'pmu',
  );

  // Files queued for the task being created — uploaded one after another once
  // it exists, in the order they were picked.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Set only when the task was created but a file did not upload. The sheet
  // stays open on what is left, so the failure is visible and Save cannot
  // create the task a second time.
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);

  // After task creation succeeds, upload whatever was queued, then close.
  useEffect(() => {
    if (!state.ok) return;
    const taskId = state.taskId;

    if (pendingFiles.length > 0 && taskId) {
      void uploadFilesToTask(pendingFiles, taskId);
    } else {
      formRef.current?.reset();
      setPendingFiles([]);
      onSuccess();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.epoch]);

  /**
   * Upload the queue to the task, one file at a time (presign → PUT →
   * register, the same flow every other uploader uses). Each file leaves the
   * queue the moment it lands, so a retry after a failure never uploads the
   * same file twice. The first failure stops the run and keeps the sheet open
   * on the files that are left.
   */
  async function uploadFilesToTask(files: File[], taskId: string) {
    setUploadError(null);
    const total = files.length;
    try {
      for (let i = 0; i < total; i += 1) {
        const file = files[i];
        setUploadStatus(
          total > 1
            ? `Uploading ${file.name} (${i + 1} of ${total})…`
            : `Uploading ${file.name}…`,
        );
        const contentType = guessContentType(file.name, file.type);
        const presignRes = await fetch('/api/attachments/upload-url', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            scope: 'task',
            parentId: taskId,
            filename: file.name,
            contentType,
            sizeBytes: file.size,
          }),
        });
        if (!presignRes.ok) {
          const body = await presignRes.json().catch(() => ({}));
          throw new Error(body.error ?? 'Could not start upload.');
        }
        const { key, url } = (await presignRes.json()) as { key: string; url: string };

        const putRes = await fetch(url, {
          method: 'PUT',
          headers: { 'content-type': contentType },
          body: file,
        });
        if (!putRes.ok) {
          throw new Error(`Upload failed (${putRes.status}).`);
        }

        const fd = new FormData();
        fd.set('scope', 'task');
        fd.set('parentId', taskId);
        fd.set('source', 'uploaded');
        fd.set('key', key);
        fd.set('fileName', file.name);
        fd.set('mimeType', contentType);
        fd.set('sizeBytes', String(file.size));
        const registered = await registerAttachmentAction(undefined, fd);
        if (!registered.ok) {
          throw new Error(registered.error ?? 'Could not save the attachment.');
        }
        setPendingFiles((prev) => prev.filter((f) => f !== file));
      }
      formRef.current?.reset();
      setPendingFiles([]);
      setUploadStatus(null);
      onSuccess();
    } catch (err) {
      console.error('Post-create upload failed:', err);
      setCreatedTaskId(taskId);
      setUploadStatus(null);
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    }
  }

  const onFilesChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Materialise the FileList before clearing the input: it is live, so
    // setting value='' first would leave an empty array and queue nothing.
    const chosen = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (chosen.length === 0) return;
    const oversize = chosen.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (oversize) {
      setUploadError(`${oversize.name} is over ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      return;
    }
    setUploadError(null);
    setPendingFiles((prev) => [...prev, ...chosen]);
  };
  const removePendingFile = (index: number) =>
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));

  // Every change of target goes through here, so an owner, sub-division or
  // PMU-share choice made for one board never rides along to another.
  const selectTarget = (next: string) => {
    setDivisionId(next);
    setOwnerId('');
    setSubDivisionId('');
    setShareWithPmu(createTargets.find((t) => t.id === next)?.kind === 'pmu');
  };
  // A new organization or directorate lands on the caller's own board when it
  // is there, else on the first one — so a target is always chosen.
  const preferredIn = (ids: string[]) => (ids.includes(initialTargetId) ? initialTargetId : ids[0]);
  const chooseOrganization = (key: string) => {
    const org = targetGroups.find((o) => o.key === key);
    if (!org) return;
    const group = org.groups.find((g) => g.targetIds.includes(initialTargetId)) ?? org.groups[0];
    setOrgKey(key);
    setGroupKey(group?.key ?? '');
    const next = group ? preferredIn(group.targetIds) : undefined;
    if (next) selectTarget(next);
  };
  const chooseDirectorate = (key: string) => {
    const group = currentOrg?.groups.find((g) => g.key === key);
    if (!group) return;
    setGroupKey(key);
    const next = preferredIn(group.targetIds);
    if (next) selectTarget(next);
  };

  // Owner candidates for the selected target: its division/PMU members —
  // or every active user for an Office-of-JS task, which anyone may own. The
  // picker only appears for division-task creators (a head power).
  const selectedTarget = createTargets.find((t) => t.id === divisionId);
  const ownerOptions: UserPickerOption[] = selectedTarget
    ? ownerCandidates
        .filter((c) =>
          selectedTarget.isOfficeOfJs
            ? true
            : selectedTarget.kind === 'pmu'
              ? c.pmuId === selectedTarget.id
              : c.memberDivisionIds.includes(selectedTarget.id),
        )
        .map((c) => ({
          id: c.id,
          name: c.name,
          designation: c.designation,
          divisionName: c.divisionName,
          divisionColour: c.divisionColour,
        }))
    : [];
  const showOwnerPicker =
    ownerOptions.length > 0;

  // One-click owner shortcuts beside the picker: the target's default owner
  // (division head / PMU team leader), plus the OSD account on Office-of-JS
  // tasks. Deduped so the same person isn't offered twice.
  const ownerQuickPicks: { id: string; name: string; role: string }[] = [];
  if (selectedTarget?.autoOwnerId && selectedTarget.autoOwnerName) {
    ownerQuickPicks.push({
      id: selectedTarget.autoOwnerId,
      name: selectedTarget.autoOwnerName,
      role: selectedTarget.kind === 'pmu' ? 'Team lead' : 'Head',
    });
  }
  if (
    selectedTarget?.isOfficeOfJs &&
    osdAccount &&
    !ownerQuickPicks.some((p) => p.id === osdAccount.id)
  ) {
    ownerQuickPicks.push({ id: osdAccount.id, name: osdAccount.name, role: 'OSD' });
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3" noValidate>
      <input
        type="hidden"
        name="divisionId"
        value={divisionId}
      />
      <input
        type="hidden"
        name="subDivisionId"
        value={subDivisionId}
      />
      <input type="hidden" name="priority" value={priority} />

      {/* Name — the only required field */}
      <div>
        <label htmlFor="qc-name" className="sr-only">
          Task name
        </label>
        <input
          id="qc-name"
          name="name"
          type="text"
          autoComplete="off"
          autoFocus
          placeholder="Task name…"
          className={cn(
            'w-full px-3.5 py-3.5 rounded-lg border bg-panel',
            'text-[16px] font-medium text-ink outline-none',
            'placeholder:text-ink-3 placeholder:font-normal',
            state.fieldErrors?.name
              ? 'border-urgent focus:border-urgent'
              : 'border-line focus:border-ink',
          )}
          aria-invalid={!!state.fieldErrors?.name}
          aria-describedby={state.fieldErrors?.name ? 'qc-name-error' : undefined}
          maxLength={200}
        />
        {state.fieldErrors?.name ? (
          <p id="qc-name-error" className="text-[11px] text-urgent mt-1">
            {state.fieldErrors.name}
          </p>
        ) : null}
      </div>

      {/* All details are shown directly — no "add more details" collapse. */}
      <div>
        <div className="flex flex-col gap-3.5 pb-1">
          {/* Description */}
          <Field label="Description">
            <textarea
              name="description"
              rows={3}
              placeholder="Add context, links, background notes…"
              className="w-full px-3 py-2.5 rounded-lg border border-line bg-panel text-[14px] text-ink outline-none focus:border-ink resize-none"
              maxLength={2000}
            />
          </Field>

          {/* Due date */}
          <Field label="Due date" error={state.fieldErrors?.dueDate}>
            <input
              name="dueDate"
              type="date"
              defaultValue={prefillDueDate}
              className={cn(
                'w-full px-3 py-2.5 rounded-lg border bg-panel text-[14px] text-ink outline-none focus:border-ink',
                state.fieldErrors?.dueDate ? 'border-urgent' : 'border-line',
              )}
            />
          </Field>

          {/* Priority segmented */}
          <Field label="Priority">
            <div
              role="radiogroup"
              aria-label="Priority"
              className="grid grid-cols-4 gap-1 p-[3px] bg-line-2 rounded-[10px]"
            >
              {PRIORITIES.map((p) => {
                const isActive = priority === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    onClick={() => setPriority(p.value)}
                    className={cn(
                      'py-2 text-[11px] font-medium rounded-md transition-colors',
                      isActive
                        ? cn('bg-panel shadow-sm', p.tone)
                        : 'text-ink-2 hover:text-ink',
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Where the task goes: organization, then directorate, then the
              division or PMU. Only places the caller can create in are
              offered, and a picker with a single choice stays on screen,
              locked, so the caller always sees where the task will land. A
              task starts unassigned for any member to pull; a PMU task is
              owned by its team leader. */}
          {createTargets.length > 0 ? (
            <>
              <div className={cn('grid grid-cols-1 gap-3.5', showDirectorate && 'sm:grid-cols-2')}>
                <Field label="Organization">
                  <select
                    value={orgKey}
                    onChange={(e) => chooseOrganization(e.target.value)}
                    disabled={targetGroups.length < 2}
                    aria-label="Organization"
                    className={TARGET_SELECT}
                  >
                    {targetGroups.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {showDirectorate && currentOrg ? (
                  <Field label="Directorate">
                    <select
                      value={groupKey}
                      onChange={(e) => chooseDirectorate(e.target.value)}
                      disabled={currentOrg.groups.length < 2}
                      aria-label="Directorate"
                      className={TARGET_SELECT}
                    >
                      {currentOrg.groups.map((g) => (
                        <option key={g.key} value={g.key}>
                          {g.directorate ?? `Directly under ${currentOrg.name}`}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
              </div>
              <Field label="Division or PMU">
                <select
                  value={divisionId}
                  onChange={(e) => selectTarget(e.target.value)}
                  disabled={groupTargets.length < 2}
                  aria-label="Division or PMU"
                  className={TARGET_SELECT}
                >
                  {groupTargets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.kind === 'pmu' ? ' · PMU' : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-ink-3">
                  Everyone on this board sees the task. Leave the owner below blank and it starts unassigned — any member can pull it to take ownership; a PMU task goes to its team leader.
                </p>
              </Field>
            </>
          ) : null}

          {/* Sub-division (optional) — shown only when the chosen division has
              sub-divisions. Categorisation only: it does not change who can own
              or see the task. Blank means the whole division. */}
          {selectedTarget && selectedTarget.subDivisions.length > 0 ? (
            <Field label="Sub-division" error={state.fieldErrors?.subDivisionId}>
              <select
                value={subDivisionId}
                onChange={(e) => setSubDivisionId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-line bg-panel text-[14px] text-ink outline-none focus:border-ink appearance-none"
              >
                <option value="">Whole division</option>
                {selectedTarget.subDivisions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {/* Show this task to PMU team — the same switch as the task detail
              page. Offered on a PMU target (where it starts on: the team's own
              board) and on a division that actually has a PMU under it (where
              it starts off: showing a division task down to a PMU punches a
              hole in PMU isolation, so it is opted into). A division with no
              PMU has no audience and never sees it. */}
          {selectedTarget &&
          (selectedTarget.kind === 'pmu' || selectedTarget.pmuNames.length > 0) ? (
            <div
              className={cn(
                'flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors duration-[var(--dur-base)]',
                shareWithPmu ? 'border-info/30 bg-info-soft' : 'border-line bg-panel',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors duration-[var(--dur-base)]',
                  shareWithPmu ? 'bg-info/15 text-info' : 'bg-line-2 text-ink-3',
                )}
              >
                <i className="ti ti-users-group text-[15px]" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">Show this task to PMU team</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-3">
                  {selectedTarget.kind === 'pmu'
                    ? shareWithPmu
                      ? `Every member of ${selectedTarget.name} sees it in their assigned list.`
                      : `Only its owner will have ${selectedTarget.name}'s task in their assigned list.`
                    : shareWithPmu
                      ? `${formatPmuNames(selectedTarget.pmuNames)} can open this task and collaborate on it.`
                      : `${formatPmuNames(selectedTarget.pmuNames)} cannot see this division's tasks. Turn it on for this one.`}
                </p>
              </div>
              <Switch
                name="sharedWithPmuTeam"
                checked={shareWithPmu}
                onChange={setShareWithPmu}
                ariaLabel="Show this task to PMU team"
              />
            </div>
          ) : null}

          {/* Owner (optional) — a head may name an initial owner from the
              chosen division/PMU. The pills beside it one-click the default
              owner (division head / PMU team leader), plus the OSD account on
              Office-of-JS tasks. Blank keeps the default above. */}
          {showOwnerPicker ? (
            <Field label="Owner" error={state.fieldErrors?.ownerId}>
              <div className="flex flex-wrap items-start gap-2">
                <UserPicker
                  name="ownerId"
                  value={ownerId}
                  onChange={setOwnerId}
                  options={ownerOptions}
                  placeholder={
                    selectedTarget?.isOfficeOfJs
                      ? 'Optional — any user'
                      : selectedTarget?.kind === 'pmu'
                        ? 'Optional — defaults to the team leader'
                        : 'Optional — leave blank so anyone can pull it'
                  }
                  error={!!state.fieldErrors?.ownerId}
                  className="flex-1 min-w-[180px]"
                />
                {ownerQuickPicks.map((p) => {
                  const active = ownerId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setOwnerId(active ? '' : p.id)}
                      aria-pressed={active}
                      title={`${p.name} · ${p.role}`}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-[12px] font-medium transition-colors',
                        active
                          ? 'border-ink bg-ink text-onink'
                          : 'border-line bg-panel text-ink-2 hover:border-ink-4 hover:text-ink',
                      )}
                    >
                      <i className="ti ti-user text-[13px]" aria-hidden="true" />
                      <span className="max-w-[120px] truncate">{p.name}</span>
                      <span
                        className={cn('text-[10px]', active ? 'text-onink/70' : 'text-ink-3')}
                      >
                        {p.role}
                      </span>
                    </button>
                  );
                })}
              </div>
              {selectedTarget?.isOfficeOfJs ? (
                <p className="mt-1 text-[11px] text-ink-3">
                  An Office of JS task can be owned by any user.
                </p>
              ) : null}
            </Field>
          ) : null}

          {/* Attachments */}
          <Field label="Attach">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!s3Configured}
                title={s3Configured ? undefined : 'Storage is not configured. Use a link instead.'}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[13px] font-medium transition-colors',
                  s3Configured
                    ? 'border-line bg-panel text-ink hover:border-ink-4'
                    : 'border-line bg-bg text-ink-3 cursor-not-allowed',
                )}
              >
                <i className="ti ti-cloud-upload text-[15px]" aria-hidden="true" />
                Upload files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={onFilesChosen}
                className="sr-only"
                aria-hidden="true"
              />
            </div>

            {pendingFiles.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {pendingFiles.map((file, index) => (
                  <li
                    key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                    className="flex items-center gap-2 px-3 py-2 bg-bg border border-line rounded-lg"
                  >
                    <i className="ti ti-file text-[14px] text-ink-2 shrink-0" aria-hidden="true" />
                    <span className="flex-1 min-w-0 text-[12px] text-ink truncate">{file.name}</span>
                    <span className="text-[10px] text-ink-3 shrink-0">{formatBytes(file.size)}</span>
                    <button
                      type="button"
                      onClick={() => removePendingFile(index)}
                      aria-label={`Remove ${file.name}`}
                      className="w-6 h-6 grid place-items-center rounded text-ink-3 hover:text-urgent shrink-0"
                    >
                      <i className="ti ti-x text-[12px]" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {uploadError ? (
              <p className="text-[11px] text-urgent mt-1">
                {createdTaskId ? 'Task saved. ' : ''}
                {uploadError}
                {createdTaskId && pendingFiles.length > 0
                  ? ` ${pendingFiles.length} ${pendingFiles.length === 1 ? 'file' : 'files'} still to upload — retry below, or add them from the task.`
                  : ''}
              </p>
            ) : null}
          </Field>

          {/* Drive link */}
          <Field label="Or paste a link" error={state.fieldErrors?.driveUrl}>
            <input
              name="driveUrl"
              type="url"
              placeholder="Google Drive, Dropbox, or any URL…"
              className={cn(
                'w-full px-3 py-2.5 rounded-lg border bg-panel text-[14px] text-ink outline-none focus:border-ink',
                state.fieldErrors?.driveUrl ? 'border-urgent' : 'border-line',
              )}
              maxLength={1000}
            />
          </Field>
        </div>
      </div>

      {/* Upload progress */}
      {uploadStatus ? (
        <p className="text-[12px] text-ink-2 inline-flex items-center gap-1.5">
          <i className="ti ti-loader-2 animate-spin text-[13px]" aria-hidden="true" />
          {uploadStatus}
        </p>
      ) : null}

      {/* Global error */}
      {state.error ? (
        <p
          role="alert"
          className="text-[12px] text-urgent bg-urgent-soft border border-urgent/20 rounded-lg px-3 py-2"
        >
          {state.error}
        </p>
      ) : null}

      {/* Actions. Once the task exists but a file did not upload, Save would
          create a second task — so it becomes Retry upload over what is left,
          and Cancel becomes Close. */}
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={onSuccess}
          className="flex-1 py-3 rounded-lg border border-line text-[14px] font-medium text-ink-2 hover:bg-line-2 transition-colors"
        >
          {createdTaskId ? 'Close' : 'Cancel'}
        </button>
        {createdTaskId ? (
          <button
            type="button"
            onClick={() => void uploadFilesToTask(pendingFiles, createdTaskId)}
            disabled={!!uploadStatus || pendingFiles.length === 0}
            className="flex-1 py-3 rounded-lg bg-ink text-onink text-[14px] font-medium transition-opacity disabled:opacity-60"
          >
            {uploadStatus ? 'Uploading…' : 'Retry upload'}
          </button>
        ) : (
          <SaveButton uploading={!!uploadStatus} />
        )}
      </div>
    </form>
  );
}

// ------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------

/** "NSDF_PMU", or "A, B and C" — the PMU teams a share would reach. */
function formatPmuNames(names: string[]): string {
  if (names.length === 0) return 'The PMU team';
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

function Field({
  label,
  children,
  error,
}: {
  label: string;
  children: ReactNode;
  error?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-ink-2 mb-1.5">{label}</label>
      {children}
      {error ? <p className="text-[11px] text-urgent mt-1">{error}</p> : null}
    </div>
  );
}


function SaveButton({ uploading }: { uploading: boolean }) {
  const { pending } = useFormStatus();
  const disabled = pending || uploading;
  return (
    <button
      type="submit"
      disabled={disabled}
      className="flex-1 py-3 rounded-lg bg-ink text-onink text-[14px] font-medium transition-opacity disabled:opacity-60"
    >
      {uploading ? 'Uploading…' : pending ? 'Saving…' : 'Save task'}
    </button>
  );
}
