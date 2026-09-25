'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormState, useFormStatus } from 'react-dom';

import { Avatar, UserPicker, type UserPickerOption } from '@/components/ui';
import { addSubtaskAction, toggleSubtaskAction, updateSubtaskAction } from '@/app/actions/tasks';
import { registerAttachmentAction } from '@/app/actions/attachments';
import { initialsOf, formatDue } from '@/lib/format';
import { guessContentType } from '@/lib/mime';
import { formatBytes, MAX_UPLOAD_BYTES } from '@/lib/s3';
import { cn } from '@/lib/utils';

/** A document attached to a subtask, surfaced on the parent panel for quick view. */
export type SubtaskDocument = {
  id: string;
  fileName: string;
  source: 'uploaded' | 'drive_link';
  fileUrl: string;
};

type Subtask = {
  id: string;
  name: string;
  status: string;
  dueDate: Date | null;
  owner: { id: string; name: string; division: { avatarColour: string } };
  documents: SubtaskDocument[];
};

type AssigneeOption = {
  id: string;
  name: string;
  designation: string;
  divisionName?: string;
  divisionColour: string;
};

type SectionSubtasksProps = {
  taskId: string;
  subtasks: Subtask[];
  /** Manage existing subtasks — reassign, change deadline, toggle done. */
  canEdit: boolean;
  /**
   * Add new subtasks. Defaults to `canEdit`; passed separately so
   * collaborators can create subtasks without gaining edit rights over the
   * ones already there. Always false on a subtask's own page (one level deep).
   */
  canAdd?: boolean;
  assignees: AssigneeOption[];
  parentDueDate: Date | null;
  /** Whether object storage is configured — gates the document upload option. */
  s3Ready: boolean;
};

export function SectionSubtasks({
  taskId,
  subtasks,
  canEdit,
  canAdd = canEdit,
  assignees,
  parentDueDate,
  s3Ready,
}: SectionSubtasksProps) {
  const [showAdd, setShowAdd] = useState(false);
  const total = subtasks.length;
  const done = subtasks.filter((s) => s.status === 'completed').length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <section aria-labelledby="sec-subtasks" className="px-4 md:px-6 py-5 border-b border-line-2">
      <div className="flex items-center justify-between mb-3">
        <h2 id="sec-subtasks" className="section-label">
          Subtasks{' '}
          {total > 0 ? (
            <span className="ml-2 text-ink-3 text-[11px] tracking-normal normal-case font-normal">
              {done} of {total} done
            </span>
          ) : null}
        </h2>
        {canAdd && !showAdd ? (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="text-[11px] font-medium text-primary inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-primary-soft transition-colors"
          >
            <i className="ti ti-plus text-[13px]" aria-hidden="true" />
            Add
          </button>
        ) : null}
      </div>

      {total > 0 ? (
        <div
          className="h-1 bg-line-2 rounded-full overflow-hidden mb-3"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Subtask completion"
        >
          <div
            className="h-full bg-ink transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}

      <ul className="flex flex-col gap-0.5">
        {subtasks.map((s) => (
          <SubtaskRow
            key={s.id}
            subtask={s}
            canEdit={canEdit}
            assignees={assignees}
            parentDueDate={parentDueDate}
          />
        ))}
      </ul>

      {showAdd ? (
        <AddSubtaskForm
          taskId={taskId}
          assignees={assignees}
          parentDueDate={parentDueDate}
          s3Ready={s3Ready}
          onDone={() => setShowAdd(false)}
        />
      ) : total === 0 ? (
        <p className="text-[13px] text-ink-3 italic">No subtasks yet.</p>
      ) : null}
    </section>
  );
}

function SubtaskCheckbox({
  isDone,
  disabled,
  onToggle,
}: {
  isDone: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isDone}
      aria-label={isDone ? 'Mark subtask not done' : 'Mark subtask done'}
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        // Button-like, high-contrast box that reads clearly on any surface
        // (token colours adapt to a dark panel). Smooth fill + a press bounce.
        'group/box relative grid place-items-center w-[24px] h-[24px] rounded-[8px] border-2 shrink-0',
        'transition-all duration-200 ease-out active:scale-90',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-panel focus-visible:ring-success/60',
        isDone
          ? 'bg-success border-success shadow'
          : 'bg-panel border-ink-4 shadow-sm hover:border-success hover:bg-success-soft',
      )}
    >
      <i
        className={cn(
          'ti ti-check text-[15px] leading-none transition-all duration-200 ease-out',
          isDone
            ? 'text-white scale-100 opacity-100'
            : // Previews a soft-green tick on hover — a friendly hint that a tap completes it.
              'text-success scale-50 opacity-0 group-hover/box:scale-100 group-hover/box:opacity-60',
        )}
        aria-hidden="true"
      />
    </button>
  );
}

function SubtaskRow({
  subtask,
  canEdit,
  assignees,
  parentDueDate,
}: {
  subtask: Subtask;
  canEdit: boolean;
  assignees: AssigneeOption[];
  parentDueDate: Date | null;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const isDone = subtask.status === 'completed';
  const due = formatDue(subtask.dueDate);

  const toggle = () => {
    const fd = new FormData();
    fd.set('subtaskId', subtask.id);
    startTransition(async () => {
      await toggleSubtaskAction(undefined, fd);
    });
  };

  return (
    <li>
      <div
        className={cn(
          'flex items-center gap-3 py-2 px-2 -mx-2 rounded-xl transition-colors',
          isDone ? 'hover:bg-line-2/50' : 'hover:bg-bg',
        )}
      >
        <SubtaskCheckbox isDone={isDone} disabled={pending} onToggle={toggle} />

        <div className="flex-1 min-w-0">
          <Link
            href={`/tasks/${subtask.id}`}
            className={cn(
              'block text-[13.5px] leading-snug truncate transition-colors',
              isDone ? 'text-ink-3 line-through' : 'text-ink hover:text-primary',
            )}
          >
            {subtask.name}
          </Link>
          {subtask.documents.length > 0 ? (
            <SubtaskDocuments documents={subtask.documents} />
          ) : null}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {due.tone !== 'none' ? (
            <span
              className={cn(
                'text-[11px] tabular-nums',
                isDone && 'text-ink-4 line-through',
                !isDone && due.tone === 'overdue' && 'text-urgent font-medium',
                !isDone && due.tone === 'today' && 'text-accent font-medium',
                !isDone && (due.tone === 'soon' || due.tone === 'future') && 'text-ink-3',
              )}
            >
              {due.label}
            </span>
          ) : null}
          <Avatar
            initials={initialsOf(subtask.owner.name)}
            colour={subtask.owner.division.avatarColour}
            size="xs"
            ariaLabel={`Assigned to ${subtask.owner.name}`}
          />
          {canEdit ? (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="w-6 h-6 grid place-items-center rounded-md text-ink-3 hover:text-ink hover:bg-line-2 transition-colors"
              aria-label="Edit subtask"
            >
              <i className="ti ti-pencil text-[13px]" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <EditSubtaskForm
          subtask={subtask}
          assignees={assignees}
          parentDueDate={parentDueDate}
          onDone={() => setEditing(false)}
        />
      ) : null}
    </li>
  );
}

/**
 * Documents attached to a subtask, shown inline on the parent panel for a quick
 * view. Each name links straight to the file (view route for uploads, the raw
 * URL for a Drive link); full management stays on the subtask's own page.
 */
function SubtaskDocuments({ documents }: { documents: SubtaskDocument[] }) {
  return (
    <ul className="mt-0.5 flex flex-col gap-0.5">
      {documents.map((doc) => (
        <li key={doc.id}>
          <a
            href={doc.source === 'drive_link' ? doc.fileUrl : `/api/attachments/${doc.id}/view`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 max-w-full text-[11px] text-ink-3 hover:text-primary transition-colors"
            title={`Open ${doc.fileName}`}
          >
            <i
              className={cn(
                'text-[12px] shrink-0',
                doc.source === 'drive_link' ? 'ti ti-link' : 'ti ti-paperclip',
              )}
              aria-hidden="true"
            />
            <span className="truncate">{doc.fileName}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------
// Deadline: a date calendar + an optional time dropdown, combined into the
// single `dueDate` field the server action already understands. Leaving the
// time blank is allowed (it defaults to end of day); leaving the date blank
// means no deadline.
// ------------------------------------------------------------

function toDateValue(d: Date | null): string {
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function toTimeValue(d: Date | null): string {
  if (!d) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Combine the date + optional time into a `datetime-local` string (or '' for none). */
function combineDueDate(date: string, time: string): string {
  if (!date) return '';
  return `${date}T${time || '23:59'}`;
}

/** Date-only max ('YYYY-MM-DD') — a subtask cannot be due after its parent. */
function parentDueMaxDate(parentDueDate: Date | null): string | undefined {
  return parentDueDate ? toDateValue(parentDueDate) : undefined;
}

function toPickerOptions(assignees: AssigneeOption[]): UserPickerOption[] {
  return assignees.map((u) => ({
    id: u.id,
    name: u.name,
    designation: u.designation,
    divisionName: u.divisionName,
    divisionColour: u.divisionColour,
  }));
}

const fieldCn =
  'w-full px-3 py-2 rounded-lg border border-line bg-panel text-[13px] text-ink outline-none focus:border-ink transition-colors';

function DeadlineFields({
  date,
  time,
  onDate,
  onTime,
  maxDate,
}: {
  date: string;
  time: string;
  onDate: (v: string) => void;
  onTime: (v: string) => void;
  maxDate?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-ink-3">Deadline date</span>
        <input
          type="date"
          value={date}
          max={maxDate}
          onChange={(e) => onDate(e.target.value)}
          className={fieldCn}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-ink-3">
          Time <span className="font-normal text-ink-4">· optional</span>
        </span>
        <input
          type="time"
          value={time}
          disabled={!date}
          onChange={(e) => onTime(e.target.value)}
          className={cn(fieldCn, 'disabled:opacity-50 disabled:cursor-not-allowed')}
        />
      </label>
    </div>
  );
}

/**
 * Combine an optional display name with the file's own extension — so a name
 * like "Cabinet note" still opens as "Cabinet note.pdf". Falls back to the raw
 * file name when no display name is given.
 */
function subtaskDocumentName(displayName: string, originalName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return originalName;
  const dot = originalName.lastIndexOf('.');
  const ext = dot > 0 ? originalName.slice(dot) : '';
  if (!ext || trimmed.toLowerCase().endsWith(ext.toLowerCase())) return trimmed;
  return trimmed + ext;
}

/**
 * Upload each queued document to a freshly created subtask, one after another.
 * Returns the ones that failed — the subtask itself is already saved, so a
 * single bad file must not cost the others their upload.
 */
async function uploadSubtaskDocuments(
  subtaskId: string,
  files: File[],
  displayName: string,
): Promise<{ name: string; reason: string }[]> {
  const failed: { name: string; reason: string }[] = [];
  for (const file of files) {
    try {
      await uploadSubtaskDocument(subtaskId, file, displayName);
    } catch (err) {
      failed.push({
        name: file.name,
        reason: err instanceof Error ? err.message : 'upload failed',
      });
    }
  }
  return failed;
}

/**
 * Upload one document to a freshly created subtask, reusing the standard
 * presign → PUT → register flow (scope 'task', parentId = the subtask id).
 * Throws with a user-facing message on any step failing.
 */
async function uploadSubtaskDocument(
  subtaskId: string,
  file: File,
  displayName: string,
): Promise<void> {
  const contentType = guessContentType(file.name, file.type);
  const presignRes = await fetch('/api/attachments/upload-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      scope: 'task',
      parentId: subtaskId,
      filename: file.name,
      contentType,
      sizeBytes: file.size,
    }),
  });
  if (!presignRes.ok) {
    const body = await presignRes.json().catch(() => ({}));
    throw new Error(body.error ?? 'Could not start the upload.');
  }
  const { key, url } = (await presignRes.json()) as { key: string; url: string };

  const putRes = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: file,
  });
  if (!putRes.ok) throw new Error(`Storage rejected the upload (${putRes.status}).`);

  const fd = new FormData();
  fd.set('scope', 'task');
  fd.set('parentId', subtaskId);
  fd.set('source', 'uploaded');
  fd.set('key', key);
  fd.set('fileName', subtaskDocumentName(displayName, file.name));
  fd.set('mimeType', contentType);
  fd.set('sizeBytes', String(file.size));
  const registered = await registerAttachmentAction(undefined, fd);
  if (!registered.ok) throw new Error(registered.error ?? 'Could not save the document.');
}

function AddSubtaskForm({
  taskId,
  assignees,
  parentDueDate,
  s3Ready,
  onDone,
}: {
  taskId: string;
  assignees: AssigneeOption[];
  parentDueDate: Date | null;
  s3Ready: boolean;
  onDone: () => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [state, formAction] = useFormState(addSubtaskAction, { ok: false, epoch: 0 });
  const [assigneeId, setAssigneeId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  // Documents queued for the subtask being added — uploaded one after another
  // once it exists, in the order they were picked.
  const [files, setFiles] = useState<File[]>([]);
  const [docName, setDocName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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
    setFiles((prev) => [...prev, ...chosen]);
  };
  const removeFile = (index: number) => setFiles((prev) => prev.filter((_, i) => i !== index));

  useEffect(() => {
    if (!state.ok) return;
    let cancelled = false;
    const reset = () => {
      ref.current?.reset();
      setAssigneeId('');
      setDate('');
      setTime('');
      setFiles([]);
      setDocName('');
      setUploadError(null);
    };
    // Documents were queued — attach them to the new subtask, then refresh so
    // they show on the panel. The subtask itself was already created and the
    // parent revalidated server-side, so even when an upload fails we still
    // close (re-submitting would duplicate the subtask) and name what failed.
    if (files.length > 0 && state.subtaskId) {
      setUploading(true);
      // Every document is attempted, so one failure does not strand the rest;
      // whatever did not land is named once at the end. The display name is
      // only meaningful for a single document — several keep their own names.
      uploadSubtaskDocuments(state.subtaskId, files, files.length === 1 ? docName : '')
        .then((failed) => {
          if (cancelled) return;
          setUploading(false);
          reset();
          router.refresh();
          onDone();
          if (failed.length > 0) {
            alert(
              `Subtask added, but ${failed.length === 1 ? 'this document' : 'these documents'} did not upload: ` +
                failed.map((f) => `${f.name} (${f.reason})`).join(', '),
            );
          }
        });
    } else {
      reset();
      onDone();
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.epoch]);

  return (
    <form ref={ref} action={formAction} className="mt-3 flex flex-col gap-2.5">
      <input type="hidden" name="parentTaskId" value={taskId} />
      <input type="hidden" name="dueDate" value={combineDueDate(date, time)} />

      <input
        name="name"
        autoFocus
        required
        maxLength={200}
        placeholder="Subtask name…"
        className={fieldCn}
      />

      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-ink-3">Assign to</span>
        <UserPicker
          options={toPickerOptions(assignees)}
          value={assigneeId}
          onChange={setAssigneeId}
          placeholder="Search or leave blank for myself…"
          name="assigneeId"
        />
      </div>

      <DeadlineFields
        date={date}
        time={time}
        onDate={setDate}
        onTime={setTime}
        maxDate={parentDueMaxDate(parentDueDate)}
      />

      {/* Optional documents — uploaded to the subtask and shown on this panel. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-medium text-ink-3">
          Documents <span className="font-normal text-ink-4">· optional</span>
        </span>
        {files.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {files.map((file, index) => (
              <div
                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-line bg-bg"
              >
                <i className="ti ti-paperclip text-[13px] text-ink-3 shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0 truncate text-[12px] text-ink">{file.name}</span>
                <span className="text-[10px] text-ink-4 shrink-0">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  className="shrink-0 text-ink-3 hover:text-urgent transition-colors"
                  aria-label={`Remove ${file.name}`}
                >
                  <i className="ti ti-x text-[13px]" aria-hidden="true" />
                </button>
              </div>
            ))}
            {/* A display name renames the one document; several keep their own. */}
            {files.length === 1 ? (
              <input
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                maxLength={196}
                placeholder="Display name · optional"
                className={fieldCn}
              />
            ) : null}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!s3Ready}
              className="inline-flex items-center gap-1.5 self-start px-3 py-1.5 rounded-lg border border-line bg-panel text-[12px] font-medium text-ink-2 transition-colors hover:border-ink-4 hover:text-ink"
            >
              <i className="ti ti-plus text-[13px]" aria-hidden="true" />
              Add another
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!s3Ready}
            title={
              s3Ready
                ? undefined
                : 'Storage is not configured on this server. Add the document from the subtask page instead.'
            }
            className={cn(
              'inline-flex items-center gap-1.5 self-start px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors',
              s3Ready
                ? 'border-line bg-panel text-ink-2 hover:border-ink-4 hover:text-ink'
                : 'border-line bg-bg text-ink-4 cursor-not-allowed',
            )}
          >
            <i className="ti ti-cloud-upload text-[14px]" aria-hidden="true" />
            Attach documents
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={onFilesChosen}
          className="sr-only"
          aria-hidden="true"
        />
      </div>

      {state.fieldErrors?.name ? (
        <p className="text-[11px] text-urgent">{state.fieldErrors.name}</p>
      ) : null}
      {state.fieldErrors?.dueDate ? (
        <p className="text-[11px] text-urgent">{state.fieldErrors.dueDate}</p>
      ) : null}
      {uploadError ? <p className="text-[11px] text-urgent">{uploadError}</p> : null}

      <div className="flex gap-2 justify-end pt-0.5">
        <button
          type="button"
          onClick={onDone}
          disabled={uploading}
          className="px-3 py-1.5 rounded-md border border-line text-[12px] font-medium text-ink-2 hover:bg-line-2 disabled:opacity-60 transition-colors"
        >
          Cancel
        </button>
        <AddButton uploading={uploading} />
      </div>
    </form>
  );
}

function AddButton({ uploading }: { uploading: boolean }) {
  const { pending } = useFormStatus();
  const busy = pending || uploading;
  return (
    <button
      type="submit"
      disabled={busy}
      className="px-3 py-1.5 rounded-md bg-ink text-onink text-[12px] font-medium hover:bg-ink-2 disabled:opacity-60 transition-colors"
    >
      {uploading ? 'Uploading…' : pending ? 'Adding…' : 'Add'}
    </button>
  );
}

function EditSubtaskForm({
  subtask,
  assignees,
  parentDueDate,
  onDone,
}: {
  subtask: Subtask;
  assignees: AssigneeOption[];
  parentDueDate: Date | null;
  onDone: () => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState(updateSubtaskAction, { ok: false, epoch: 0 });
  const [assigneeId, setAssigneeId] = useState(subtask.owner.id);
  const [date, setDate] = useState(toDateValue(subtask.dueDate));
  const [time, setTime] = useState(toTimeValue(subtask.dueDate));

  useEffect(() => {
    if (state.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.epoch]);

  return (
    <form ref={ref} action={formAction} className="pb-3 flex flex-col gap-2.5 pl-[36px]">
      <input type="hidden" name="subtaskId" value={subtask.id} />
      <input type="hidden" name="dueDate" value={combineDueDate(date, time)} />

      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-ink-3">Assigned to</span>
        <UserPicker
          options={toPickerOptions(assignees)}
          value={assigneeId}
          onChange={setAssigneeId}
          placeholder="Search by name…"
          name="assigneeId"
        />
      </div>

      <DeadlineFields
        date={date}
        time={time}
        onDate={setDate}
        onTime={setTime}
        maxDate={parentDueMaxDate(parentDueDate)}
      />

      {state.fieldErrors?.dueDate ? (
        <p className="text-[11px] text-urgent">{state.fieldErrors.dueDate}</p>
      ) : null}
      {state.error ? <p className="text-[11px] text-urgent">{state.error}</p> : null}

      <div className="flex gap-2 justify-end pt-0.5">
        <button
          type="button"
          onClick={onDone}
          className="px-3 py-1.5 rounded-md border border-line text-[12px] font-medium text-ink-2 hover:bg-line-2 transition-colors"
        >
          Cancel
        </button>
        <SaveButton />
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-3 py-1.5 rounded-md bg-ink text-onink text-[12px] font-medium hover:bg-ink-2 disabled:opacity-60 transition-colors"
    >
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}
