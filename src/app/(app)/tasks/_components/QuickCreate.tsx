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
import { Sheet, UserPicker, type UserPickerOption } from '@/components/ui';
import { createTaskAction } from '@/app/actions/tasks';
import { registerAttachmentAction } from '@/app/actions/attachments';
import {
  INITIAL_CREATE_STATE,
  type CreateTaskState,
} from '@/app/actions/states';
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

type ProviderProps = {
  defaultDivisionId: string;
  s3Configured: boolean;
  /** Division-level creation is a head power — see canCreateDivisionTask. */
  canCreateDivisionTasks: boolean;
  /** Divisions + PMUs the caller may create a task in (auto-owns to head/leader). */
  createTargets: DivisionTarget[];
  /** Active members of those targets — the optional initial-owner pool. */
  ownerCandidates: OwnerCandidate[];
  /** OSD account, for the quick-pick pill on Office-of-JS tasks. */
  osdAccount: OsdAccount | null;
  children: ReactNode;
};

export function QuickCreateProvider({
  defaultDivisionId,
  s3Configured,
  canCreateDivisionTasks,
  createTargets,
  ownerCandidates,
  osdAccount,
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
            canCreateDivisionTasks={canCreateDivisionTasks}
            createTargets={createTargets}
            ownerCandidates={ownerCandidates}
            osdAccount={osdAccount}
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
  canCreateDivisionTasks: boolean;
  createTargets: DivisionTarget[];
  ownerCandidates: OwnerCandidate[];
  osdAccount: OsdAccount | null;
  /** Prefilled due date (YYYY-MM-DD), e.g. when created from the calendar. */
  prefillDueDate?: string;
};

const PRIORITIES = [
  { value: 'low', label: 'Low', tone: 'text-low' },
  { value: 'medium', label: 'Medium', tone: 'text-medium' },
  { value: 'high', label: 'High', tone: 'text-high' },
  { value: 'urgent', label: 'Urgent', tone: 'text-urgent' },
] as const;

const VISIBILITIES = [
  { value: 'division', label: 'Division', icon: 'ti-users' },
  { value: 'personal', label: 'Personal', icon: 'ti-lock' },
] as const;

function QuickCreateForm({
  onSuccess,
  defaultDivisionId,
  s3Configured,
  canCreateDivisionTasks,
  createTargets,
  ownerCandidates,
  osdAccount,
  prefillDueDate,
}: FormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, formAction] = useFormState<CreateTaskState, FormData>(
    createTaskAction,
    INITIAL_CREATE_STATE,
  );

  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]['value']>('low');
  const [visibility, setVisibility] = useState<(typeof VISIBILITIES)[number]['value']>(
    canCreateDivisionTasks ? 'division' : 'personal',
  );
  // Which division/PMU a division task lands in — ownership auto-resolves
  // to that division's head or the PMU's team leader on the server. Default
  // to the caller's own division when it's a valid target, else the first.
  const [divisionId, setDivisionId] = useState(
    createTargets.some((t) => t.id === defaultDivisionId)
      ? defaultDivisionId
      : createTargets[0]?.id ?? defaultDivisionId,
  );
  // Optional initial owner. Empty = today's default (a division task starts
  // unassigned; a PMU task goes to its team leader — resolved on the server).
  // Cleared whenever the target/visibility changes so a stale cross-division
  // pick can't be submitted.
  const [ownerId, setOwnerId] = useState('');
  // Optional sub-division within the chosen division. Empty = whole division.
  // Reset alongside ownerId so a sub-division from a previously-chosen
  // division can't be submitted against a different one.
  const [subDivisionId, setSubDivisionId] = useState('');

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // After task creation succeeds, upload the pending file if any, then close.
  useEffect(() => {
    if (!state.ok) return;
    const taskId = state.taskId;

    if (pendingFile && taskId) {
      uploadFileToTask(pendingFile, taskId).then(() => {
        formRef.current?.reset();
        setPendingFile(null);
        setUploadStatus(null);
        onSuccess();
      });
    } else {
      formRef.current?.reset();
      setPendingFile(null);
      onSuccess();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.epoch]);

  async function uploadFileToTask(file: File, taskId: string) {
    setUploadStatus(`Uploading ${file.name}…`);
    setUploadError(null);
    try {
      const presignRes = await fetch('/api/attachments/upload-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'task',
          parentId: taskId,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
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
        headers: { 'content-type': file.type || 'application/octet-stream' },
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
      fd.set('mimeType', file.type || '');
      fd.set('sizeBytes', String(file.size));
      const registered = await registerAttachmentAction(undefined, fd);
      if (!registered.ok) {
        throw new Error(registered.error ?? 'Could not save the attachment.');
      }
    } catch (err) {
      console.error('Post-create upload failed:', err);
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    }
    setUploadStatus(null);
  }

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(`File is over ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      return;
    }
    setUploadError(null);
    setPendingFile(file);
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
    canCreateDivisionTasks && visibility === 'division' && ownerOptions.length > 0;

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
        value={visibility === 'division' ? divisionId : defaultDivisionId}
      />
      <input
        type="hidden"
        name="subDivisionId"
        value={visibility === 'division' ? subDivisionId : ''}
      />
      <input type="hidden" name="priority" value={priority} />
      <input type="hidden" name="visibility" value={visibility} />

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

          {/* Visibility segmented — division-level creation is a head power */}
          <Field label="Visibility">
            {canCreateDivisionTasks ? (
              <div
                role="radiogroup"
                aria-label="Visibility"
                className="grid grid-cols-2 gap-1 p-[3px] bg-line-2 rounded-[10px]"
              >
                {VISIBILITIES.map((v) => {
                  const isActive = visibility === v.value;
                  return (
                    <button
                      key={v.value}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      onClick={() => {
                        setVisibility(v.value);
                        setOwnerId('');
                        setSubDivisionId('');
                      }}
                      className={cn(
                        'py-2 text-[12px] font-medium rounded-md transition-colors inline-flex items-center justify-center gap-1.5',
                        isActive ? 'bg-panel text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
                      )}
                    >
                      <i className={cn('ti', v.icon, 'text-[13px]')} aria-hidden="true" />
                      {v.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-line bg-bg text-[12px] text-ink-2">
                <i className="ti ti-lock text-[14px] mt-px shrink-0" aria-hidden="true" />
                <span>
                  Personal — visible to you and added collaborators only.
                  Division tasks are given by the division head.
                </span>
              </p>
            )}
          </Field>

          {/* Division / PMU target. A division task starts unassigned for any
              member to pull; a PMU task is owned by its team leader. Only shown
              to authorized creators of division tasks. */}
          {canCreateDivisionTasks && visibility === 'division' && createTargets.length > 0 ? (
            <Field label="Division or PMU">
              <select
                value={divisionId}
                onChange={(e) => {
                  setDivisionId(e.target.value);
                  setOwnerId('');
                  setSubDivisionId('');
                }}
                className="w-full px-3 py-2.5 rounded-lg border border-line bg-panel text-[14px] text-ink outline-none focus:border-ink appearance-none"
              >
                {createTargets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.kind === 'pmu' ? ' · PMU' : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-ink-3">
                Leave the owner below blank and a division task starts unassigned — any member can pull it to take ownership; a PMU task goes to its team leader.
              </p>
            </Field>
          ) : null}

          {/* Sub-division (optional) — shown only when the chosen division has
              sub-divisions. Categorisation only: it does not change who can own
              or see the task. Blank means the whole division. */}
          {canCreateDivisionTasks &&
          visibility === 'division' &&
          selectedTarget &&
          selectedTarget.subDivisions.length > 0 ? (
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
                Upload file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                onChange={onFileChosen}
                className="sr-only"
                aria-hidden="true"
              />
            </div>

            {pendingFile ? (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-bg border border-line rounded-lg">
                <i className="ti ti-file text-[14px] text-ink-2" aria-hidden="true" />
                <span className="flex-1 min-w-0 text-[12px] text-ink truncate">
                  {pendingFile.name}
                </span>
                <span className="text-[10px] text-ink-3 shrink-0">
                  {formatBytes(pendingFile.size)}
                </span>
                <button
                  type="button"
                  onClick={() => setPendingFile(null)}
                  aria-label="Remove file"
                  className="w-6 h-6 grid place-items-center rounded text-ink-3 hover:text-urgent shrink-0"
                >
                  <i className="ti ti-x text-[12px]" aria-hidden="true" />
                </button>
              </div>
            ) : null}

            {uploadError ? (
              <p className="text-[11px] text-urgent mt-1">{uploadError}</p>
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

      {/* Actions */}
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={onSuccess}
          className="flex-1 py-3 rounded-lg border border-line text-[14px] font-medium text-ink-2 hover:bg-line-2 transition-colors"
        >
          Cancel
        </button>
        <SaveButton uploading={!!uploadStatus} />
      </div>
    </form>
  );
}

// ------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------

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
