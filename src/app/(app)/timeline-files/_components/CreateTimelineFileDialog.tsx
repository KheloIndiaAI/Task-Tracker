'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { Sheet } from '@/components/ui';
import { createTimelineFileAction } from '@/app/actions/timeline-files';
import {
  addDriveLinkAttachmentAction,
  registerAttachmentAction,
} from '@/app/actions/attachments';
import { INITIAL_TF_STATE, type TimelineFileState } from '@/app/actions/states';
import { cn } from '@/lib/utils';
import { guessContentType } from '@/lib/mime';
import { fileBadgeFor, formatBytes, MAX_UPLOAD_BYTES } from '@/lib/s3';

export type DivisionOption = {
  id: string;
  name: string;
  avatarColour: string;
};

type QueuedDriveLink = { name: string; url: string };

type PriorityValue = 'low' | 'medium' | 'high' | 'urgent';

const PRIORITY_OPTIONS: { value: PriorityValue; label: string; dot: string; activeClass: string }[] = [
  { value: 'low', label: 'Low', dot: 'bg-low', activeClass: 'bg-low-soft text-low border-low/30' },
  { value: 'medium', label: 'Medium', dot: 'bg-medium', activeClass: 'bg-medium-soft text-medium border-medium/30' },
  { value: 'high', label: 'High', dot: 'bg-high', activeClass: 'bg-high-soft text-high border-high/30' },
  { value: 'urgent', label: 'Urgent', dot: 'bg-urgent', activeClass: 'bg-urgent-soft text-urgent border-urgent/30' },
];

type CreateTimelineFileDialogProps = {
  divisions: DivisionOption[];
  defaultReceivedDate: string;
  suggestedFileNumber: number;
  s3Configured: boolean;
};

export function CreateTimelineFileDialog({
  divisions,
  defaultReceivedDate,
  suggestedFileNumber,
  s3Configured,
}: CreateTimelineFileDialogProps) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState<TimelineFileState, FormData>(
    createTimelineFileAction,
    INITIAL_TF_STATE,
  );
  const [markedTo, setMarkedTo] = useState<string[]>([]);
  const [priority, setPriority] = useState<PriorityValue>('medium');

  // Attachment queues (collected before TF creation)
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [queuedLinks, setQueuedLinks] = useState<QueuedDriveLink[]>([]);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  // Post-creation upload state
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!state.ok || !state.id) return;
    if (queuedFiles.length === 0 && queuedLinks.length === 0) {
      resetAndClose();
      return;
    }
    uploadAttachments(state.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.epoch]);

  async function uploadAttachments(tfId: string) {
    setUploading(true);
    setUploadError(null);
    const total = queuedLinks.length + queuedFiles.length;
    let done = 0;

    try {
      for (const link of queuedLinks) {
        setUploadStatus(`Adding link ${done + 1} of ${total}…`);
        const fd = new FormData();
        fd.set('scope', 'tf_source');
        fd.set('parentId', tfId);
        fd.set('fileName', link.name);
        fd.set('driveUrl', link.url);
        const res = await addDriveLinkAttachmentAction(undefined, fd);
        if (!res.ok) throw new Error(res.error ?? 'Failed to add Drive link.');
        done++;
      }

      for (const file of queuedFiles) {
        setUploadStatus(`Uploading ${file.name} (${done + 1} of ${total})…`);
        // One derived content-type for presign + PUT + register, so a file
        // whose browser MIME is empty/non-canonical still passes the allow-list
        // and the presigned signature matches the PUT.
        const contentType = guessContentType(file.name, file.type);
        const presignRes = await fetch('/api/attachments/upload-url', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            scope: 'tf_source',
            parentId: tfId,
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
        if (!putRes.ok) throw new Error(`Upload rejected (${putRes.status}).`);

        const regFd = new FormData();
        regFd.set('scope', 'tf_source');
        regFd.set('parentId', tfId);
        regFd.set('source', 'uploaded');
        regFd.set('key', key);
        regFd.set('fileName', file.name);
        regFd.set('mimeType', contentType);
        regFd.set('sizeBytes', String(file.size));
        const regRes = await registerAttachmentAction(undefined, regFd);
        if (!regRes.ok) throw new Error(regRes.error ?? 'Could not register file.');
        done++;
      }

      resetAndClose();
    } catch (err) {
      console.error('Attachment upload failed:', err);
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
      setUploading(false);
      setUploadStatus(null);
    }
  }

  function resetAndClose() {
    formRef.current?.reset();
    setMarkedTo([]);
    setPriority('medium');
    setQueuedFiles([]);
    setQueuedLinks([]);
    setShowLinkForm(false);
    setLinkName('');
    setLinkUrl('');
    setUploading(false);
    setUploadStatus(null);
    setUploadError(null);
    setOpen(false);
  }

  const toggleDivision = (id: string) => {
    setMarkedTo((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  };

  const onPickFile = () => fileInputRef.current?.click();

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Materialise the FileList into a real array BEFORE clearing the input.
    // e.target.files is a live FileList; setting value='' first empties it,
    // which would leave arr empty and silently queue nothing.
    const arr = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (arr.length === 0) return;
    const oversize = arr.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (oversize) {
      setUploadError(`${oversize.name} exceeds ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      return;
    }
    setUploadError(null);
    setQueuedFiles((prev) => [...prev, ...arr]);
  };

  const removeQueuedFile = (idx: number) =>
    setQueuedFiles((prev) => prev.filter((_, i) => i !== idx));

  const addDriveLink = () => {
    if (!linkName.trim() || !linkUrl.trim()) return;
    try {
      new URL(linkUrl.trim());
    } catch {
      return;
    }
    setQueuedLinks((prev) => [...prev, { name: linkName.trim(), url: linkUrl.trim() }]);
    setLinkName('');
    setLinkUrl('');
    setShowLinkForm(false);
  };

  const removeQueuedLink = (idx: number) =>
    setQueuedLinks((prev) => prev.filter((_, i) => i !== idx));

  const hasAttachments = queuedFiles.length > 0 || queuedLinks.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-ink text-onink text-[13px] font-medium hover:bg-ink-2 transition-colors"
      >
        <i className="ti ti-file-plus text-[14px]" aria-hidden="true" />
        New timeline file
      </button>

      <Sheet
        open={open}
        onClose={uploading ? () => {} : () => setOpen(false)}
        title="New timeline file"
        subtitle="Enter the file number from your register — it becomes the reference number."
      >
        {open ? (
          <form ref={formRef} action={formAction} className="flex flex-col gap-3.5">
            <Field
              label="TL file number"
              hint={`Becomes TF-${new Date().getFullYear()}/${suggestedFileNumber || 'N'} by default — change it to match your file register.`}
              error={state.fieldErrors?.fileNumber}
            >
              <input
                name="fileNumber"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{1,6}"
                maxLength={6}
                required
                autoFocus
                disabled={uploading}
                defaultValue={String(suggestedFileNumber)}
                placeholder="e.g. 45"
                className={inputCn(!!state.fieldErrors?.fileNumber)}
              />
            </Field>

            <Field label="Subject" error={state.fieldErrors?.subject}>
              <input
                name="subject"
                required
                maxLength={200}
                disabled={uploading}
                placeholder="e.g. Cabinet brief request — Khelo India Mission"
                className={inputCn(!!state.fieldErrors?.subject)}
              />
            </Field>

            <Field label="From" error={state.fieldErrors?.fromWhom}>
              <input
                name="fromWhom"
                required
                maxLength={120}
                disabled={uploading}
                placeholder="e.g. Prime Minister's Office"
                className={inputCn(!!state.fieldErrors?.fromWhom)}
              />
            </Field>

            <Field label="Priority" hint="Same scale as tasks. Can be changed later.">
              <input type="hidden" name="priority" value={priority} />
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Priority">
                {PRIORITY_OPTIONS.map((o) => {
                  const active = priority === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setPriority(o.value)}
                      disabled={uploading}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-pill text-[11px] font-medium border transition-colors',
                        active ? o.activeClass : 'bg-panel text-ink-2 border-line hover:border-ink-4',
                      )}
                    >
                      <span className={cn('w-1.5 h-1.5 rounded-full', o.dot)} aria-hidden="true" />
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Received" error={state.fieldErrors?.receivedDate}>
                <input
                  name="receivedDate"
                  type="date"
                  required
                  disabled={uploading}
                  defaultValue={defaultReceivedDate}
                  className={inputCn(!!state.fieldErrors?.receivedDate)}
                />
              </Field>

              <Field
                label="Deadline"
                hint="Optional. Countdown shows everywhere this file appears."
                error={state.fieldErrors?.deadlineDate}
              >
                <input
                  name="deadlineDate"
                  type="date"
                  disabled={uploading}
                  className={inputCn(!!state.fieldErrors?.deadlineDate)}
                />
              </Field>
            </div>

            <Field
              label="Mark to divisions"
              hint="Pick one or more. Only marked divisions can see this file."
              error={state.fieldErrors?.markedTo}
            >
              <input type="hidden" name="markedTo" value={markedTo.join(',')} />
              {divisions.length === 0 ? (
                <p className="text-[12px] text-ink-3 italic px-2 py-3 rounded-lg border border-dashed border-line text-center">
                  No divisions yet. Create some from Super Admin → Structure & hierarchy.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {divisions.map((d) => {
                    const active = markedTo.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => toggleDivision(d.id)}
                        disabled={uploading}
                        aria-pressed={active}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-pill text-[11px] font-medium border transition-colors',
                          active
                            ? 'bg-primary text-onink border-primary'
                            : 'bg-panel text-ink-2 border-line hover:border-ink-4',
                        )}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            backgroundColor: active ? 'rgba(255,255,255,0.8)' : d.avatarColour,
                          }}
                          aria-hidden="true"
                        />
                        {d.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>

            <Field
              label="Secretary's comments"
              hint="Optional. Renders as a formal quote on the file detail screen."
            >
              <textarea
                name="secretaryComments"
                rows={3}
                maxLength={4000}
                disabled={uploading}
                placeholder="Direction from the Secretary, Sports…"
                className={cn(inputCn(false), 'resize-none')}
              />
            </Field>

            {/* Source documents section */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-ink-2">
                Source documents
              </span>
              <span className="text-[11px] text-ink-3">
                Optional. Attach the original letter, memo, or reference. Uploaded after file is created.
              </span>

              {/* Queued items */}
              {hasAttachments ? (
                <ul className="flex flex-col gap-1.5 mt-1">
                  {queuedLinks.map((link, i) => (
                    <li
                      key={`link-${i}`}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-line bg-bg"
                    >
                      <span className="w-7 h-8 rounded grid place-items-center bg-info text-white text-[8px] font-medium shrink-0">
                        <i className="ti ti-link text-[12px]" aria-hidden="true" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-ink truncate">{link.name}</p>
                        <p className="text-[10px] text-ink-3 truncate">{link.url}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeQueuedLink(i)}
                        disabled={uploading}
                        className="p-1 text-ink-3 hover:text-urgent transition-colors shrink-0"
                        aria-label="Remove"
                      >
                        <i className="ti ti-x text-[13px]" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                  {queuedFiles.map((file, i) => {
                    const badge = fileBadgeFor(file.name, 'uploaded');
                    return (
                      <li
                        key={`file-${i}`}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-line bg-bg"
                      >
                        <span
                          className={cn(
                            'w-7 h-8 rounded grid place-items-end justify-center pb-0.5 text-white text-[8px] font-medium shrink-0',
                            badge.tone === 'pdf' ? 'bg-urgent' :
                            badge.tone === 'doc' ? 'bg-medium' :
                            badge.tone === 'xls' ? 'bg-success' :
                            badge.tone === 'img' ? 'bg-success' :
                            'bg-low',
                          )}
                        >
                          {badge.label}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium text-ink truncate">{file.name}</p>
                          <p className="text-[10px] text-ink-3">{formatBytes(file.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeQueuedFile(i)}
                          disabled={uploading}
                          className="p-1 text-ink-3 hover:text-urgent transition-colors shrink-0"
                          aria-label="Remove"
                        >
                          <i className="ti ti-x text-[13px]" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {/* Inline Drive link mini-form */}
              {showLinkForm ? (
                <div className="flex flex-col gap-2 mt-1 p-2.5 rounded-lg border border-line bg-bg">
                  <input
                    value={linkName}
                    onChange={(e) => setLinkName(e.target.value)}
                    placeholder="Display name"
                    maxLength={200}
                    autoFocus
                    className={inputCn(false)}
                  />
                  <input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://drive.google.com/…"
                    type="url"
                    maxLength={1000}
                    className={inputCn(false)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowLinkForm(false);
                        setLinkName('');
                        setLinkUrl('');
                      }}
                      className="flex-1 py-1.5 rounded-md border border-line text-[11px] font-medium text-ink-2 hover:bg-line-2"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={addDriveLink}
                      disabled={!linkName.trim() || !linkUrl.trim()}
                      className="flex-1 py-1.5 rounded-md bg-ink text-onink text-[11px] font-medium disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Action buttons */}
              {!showLinkForm ? (
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={onPickFile}
                    disabled={uploading || !s3Configured}
                    title={
                      s3Configured
                        ? undefined
                        : 'Storage is not configured. Use a Drive link instead.'
                    }
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium',
                      s3Configured && !uploading
                        ? 'upload-btn'
                        : 'border border-line bg-bg text-ink-3 cursor-not-allowed',
                    )}
                  >
                    <i className="upload-btn-icon ti ti-cloud-upload text-[14px]" aria-hidden="true" />
                    Upload files
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLinkForm(true)}
                    disabled={uploading}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-line bg-panel text-[11px] font-medium text-ink-2 hover:border-ink-4 transition-colors"
                  >
                    <i className="ti ti-link text-[13px]" aria-hidden="true" />
                    Add Drive link
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={onFileChosen}
                    className="sr-only"
                    aria-hidden="true"
                  />
                </div>
              ) : null}
            </div>

            {/* Upload progress */}
            {uploadStatus ? (
              <p className="text-[12px] text-ink-2 inline-flex items-center gap-1.5">
                <i
                  className="ti ti-loader-2 animate-spin text-[13px]"
                  aria-hidden="true"
                />
                {uploadStatus}
              </p>
            ) : null}

            {uploadError ? (
              <p
                role="alert"
                className="text-[12px] text-urgent bg-urgent-soft border border-urgent/20 rounded-lg px-3 py-2"
              >
                {uploadError}
              </p>
            ) : null}

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
                onClick={() => setOpen(false)}
                disabled={uploading}
                className="flex-1 py-2.5 rounded-lg border border-line text-[13px] font-medium text-ink-2 hover:bg-line-2 disabled:opacity-60"
              >
                Cancel
              </button>
              <SaveButton disabled={markedTo.length === 0} uploading={uploading} hasAttachments={hasAttachments} />
            </div>
          </form>
        ) : null}
      </Sheet>
    </>
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

function SaveButton({ disabled, uploading, hasAttachments }: { disabled: boolean; uploading: boolean; hasAttachments: boolean }) {
  const { pending } = useFormStatus();
  const busy = pending || uploading;
  const label = uploading
    ? 'Uploading…'
    : pending
      ? 'Creating…'
      : hasAttachments
        ? 'Create & upload'
        : 'Create file';
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="flex-1 py-2.5 rounded-lg bg-ink text-onink text-[13px] font-medium disabled:opacity-60"
    >
      {label}
    </button>
  );
}
