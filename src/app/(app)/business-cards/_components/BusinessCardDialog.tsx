'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState, useFormStatus } from 'react-dom';

import { Sheet } from '@/components/ui';
import {
  addDriveLinkAttachmentAction,
  registerAttachmentAction,
} from '@/app/actions/attachments';
import {
  createBusinessCardAction,
  updateBusinessCardAction,
} from '@/app/actions/business-cards';
import { INITIAL_BUSINESS_CARD_STATE, type BusinessCardState } from '@/app/actions/states';
import type { BusinessCardDto, BusinessCardEventDto } from '@/lib/business-cards-shared';
import { guessContentType } from '@/lib/mime';
import { fileBadgeFor, formatBytes, MAX_UPLOAD_BYTES } from '@/lib/s3';
import { cn } from '@/lib/utils';

/**
 * Add / Edit a business card. One component, two modes:
 *   - create: renders an "Add contact" button; the card is created, then queued
 *     files + Drive links upload against the new id (scope 'business_card').
 *   - edit: renders an "Edit" button, pre-fills the fields, and saves in place.
 *     Attachments are managed on the detail page (AttachmentList).
 */

type QueuedLink = { name: string; url: string };

type Props =
  | { mode: 'create'; events: BusinessCardEventDto[]; s3Configured: boolean; card?: undefined }
  | { mode: 'edit'; events: BusinessCardEventDto[]; card: BusinessCardDto; s3Configured?: boolean };

export function BusinessCardDialog(props: Props) {
  const { mode, events } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const action = mode === 'create' ? createBusinessCardAction : updateBusinessCardAction;
  const [state, formAction] = useFormState<BusinessCardState, FormData>(
    action,
    INITIAL_BUSINESS_CARD_STATE,
  );

  const s3Configured = mode === 'create' ? props.s3Configured : false;
  const card = mode === 'edit' ? props.card : undefined;

  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [queuedLinks, setQueuedLinks] = useState<QueuedLink[]>([]);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!state.ok) return;
    if (mode === 'edit') {
      setOpen(false);
      router.refresh();
      return;
    }
    if (!state.businessCardId) return;
    if (queuedFiles.length === 0 && queuedLinks.length === 0) {
      const id = state.businessCardId;
      resetAndClose();
      router.push(`/business-cards/${id}`);
      return;
    }
    void uploadAttachments(state.businessCardId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.epoch]);

  async function uploadAttachments(businessCardId: string) {
    setUploading(true);
    setUploadError(null);
    const total = queuedLinks.length + queuedFiles.length;
    let done = 0;
    try {
      for (const link of queuedLinks) {
        setUploadStatus(`Adding link ${done + 1} of ${total}…`);
        const fd = new FormData();
        fd.set('scope', 'business_card');
        fd.set('parentId', businessCardId);
        fd.set('fileName', link.name);
        fd.set('driveUrl', link.url);
        const res = await addDriveLinkAttachmentAction(undefined, fd);
        if (!res.ok) throw new Error(res.error ?? 'Failed to add Drive link.');
        done++;
      }
      for (const file of queuedFiles) {
        setUploadStatus(`Uploading ${file.name} (${done + 1} of ${total})…`);
        const contentType = guessContentType(file.name, file.type);
        const presignRes = await fetch('/api/attachments/upload-url', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            scope: 'business_card',
            parentId: businessCardId,
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
        regFd.set('scope', 'business_card');
        regFd.set('parentId', businessCardId);
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
      router.push(`/business-cards/${businessCardId}`);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
      setUploading(false);
      setUploadStatus(null);
    }
  }

  function resetAndClose() {
    formRef.current?.reset();
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

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = '';
    if (!files) return;
    const arr = Array.from(files);
    const oversize = arr.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (oversize) {
      setUploadError(`${oversize.name} exceeds ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      return;
    }
    setUploadError(null);
    setQueuedFiles((prev) => [...prev, ...arr]);
  };

  const addLink = () => {
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

  const hasAttachments = queuedFiles.length > 0 || queuedLinks.length > 0;

  return (
    <>
      {mode === 'create' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-ink text-onink text-[13px] font-medium hover:bg-ink-2 transition-colors"
        >
          <i className="ti ti-plus text-[14px]" aria-hidden="true" />
          Add contact
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line bg-panel text-[13px] font-medium text-ink-2 hover:border-ink-4 transition-colors"
        >
          <i className="ti ti-edit text-[14px]" aria-hidden="true" />
          Edit
        </button>
      )}

      <Sheet
        open={open}
        onClose={uploading ? () => {} : () => setOpen(false)}
        title={mode === 'create' ? 'Add business card' : 'Edit business card'}
        subtitle={
          mode === 'create'
            ? 'A contact collected at an event or meeting.'
            : undefined
        }
      >
        {open ? (
          <form ref={formRef} action={formAction} className="flex flex-col gap-3.5">
            {mode === 'edit' ? <input type="hidden" name="id" value={card!.id} /> : null}

            <Field label="Event name" hint="Optional. New names are saved for reuse.">
              <input
                name="eventName"
                list="business-card-events"
                defaultValue={card?.eventName ?? ''}
                maxLength={160}
                disabled={uploading}
                placeholder="Type or pick an event…"
                className={inputCn(false)}
              />
              <datalist id="business-card-events">
                {events.map((e) => (
                  <option key={e.id} value={e.name} />
                ))}
              </datalist>
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Full name" required error={state.fieldErrors?.fullName}>
                <input
                  name="fullName"
                  required
                  autoFocus
                  maxLength={160}
                  defaultValue={card?.fullName ?? ''}
                  disabled={uploading}
                  className={inputCn(!!state.fieldErrors?.fullName)}
                />
              </Field>
              <Field label="Job title">
                <input
                  name="jobTitle"
                  maxLength={160}
                  defaultValue={card?.jobTitle ?? ''}
                  disabled={uploading}
                  className={inputCn(false)}
                />
              </Field>
              <Field label="Company" required error={state.fieldErrors?.company}>
                <input
                  name="company"
                  required
                  maxLength={200}
                  defaultValue={card?.company ?? ''}
                  disabled={uploading}
                  className={inputCn(!!state.fieldErrors?.company)}
                />
              </Field>
              <Field label="Industry">
                <input
                  name="industry"
                  maxLength={120}
                  defaultValue={card?.industry ?? ''}
                  disabled={uploading}
                  className={inputCn(false)}
                />
              </Field>
              <Field label="Email">
                <input
                  name="email"
                  type="email"
                  maxLength={200}
                  defaultValue={card?.email ?? ''}
                  disabled={uploading}
                  className={inputCn(false)}
                />
              </Field>
              <Field label="Mobile">
                <input
                  name="mobile"
                  type="tel"
                  maxLength={60}
                  defaultValue={card?.mobile ?? ''}
                  disabled={uploading}
                  className={inputCn(false)}
                />
              </Field>
            </div>

            {mode === 'create' ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-ink-2">Business card file</span>
                <span className="text-[11px] text-ink-3">
                  Optional. Upload the card image (PNG, JPEG…) or a PDF; files upload after the
                  contact is saved. Drive links attach immediately.
                </span>

                {hasAttachments ? (
                  <ul className="flex flex-col gap-1.5 mt-1">
                    {queuedLinks.map((link, i) => (
                      <li key={`link-${i}`} className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-line bg-bg">
                        <span className="w-7 h-8 rounded grid place-items-center bg-info text-white shrink-0">
                          <i className="ti ti-link text-[12px]" aria-hidden="true" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium text-ink truncate">{link.name}</p>
                          <p className="text-[10px] text-ink-3 truncate">{link.url}</p>
                        </div>
                        <button type="button" onClick={() => setQueuedLinks((p) => p.filter((_, j) => j !== i))} disabled={uploading} className="p-1 text-ink-3 hover:text-urgent shrink-0" aria-label="Remove">
                          <i className="ti ti-x text-[13px]" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                    {queuedFiles.map((file, i) => {
                      const badge = fileBadgeFor(file.name, 'uploaded');
                      return (
                        <li key={`file-${i}`} className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-line bg-bg">
                          <span className={cn('w-7 h-8 rounded grid place-items-end justify-center pb-0.5 text-white text-[8px] font-medium shrink-0', badge.tone === 'pdf' ? 'bg-urgent' : badge.tone === 'img' ? 'bg-success' : 'bg-low')}>
                            {badge.label}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-medium text-ink truncate">{file.name}</p>
                            <p className="text-[10px] text-ink-3">{formatBytes(file.size)}</p>
                          </div>
                          <button type="button" onClick={() => setQueuedFiles((p) => p.filter((_, j) => j !== i))} disabled={uploading} className="p-1 text-ink-3 hover:text-urgent shrink-0" aria-label="Remove">
                            <i className="ti ti-x text-[13px]" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                {showLinkForm ? (
                  <div className="flex flex-col gap-2 mt-1 p-2.5 rounded-lg border border-line bg-bg">
                    <input value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder="Display name" maxLength={200} autoFocus className={inputCn(false)} />
                    <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://drive.google.com/…" type="url" maxLength={1000} className={inputCn(false)} />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setShowLinkForm(false); setLinkName(''); setLinkUrl(''); }} className="flex-1 py-1.5 rounded-md border border-line text-[11px] font-medium text-ink-2 hover:bg-line-2">Cancel</button>
                      <button type="button" onClick={addLink} disabled={!linkName.trim() || !linkUrl.trim()} className="flex-1 py-1.5 rounded-md bg-ink text-onink text-[11px] font-medium disabled:opacity-40">Add</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading || !s3Configured}
                      title={s3Configured ? undefined : 'Storage is not configured. Use a Drive link instead.'}
                      className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium', s3Configured && !uploading ? 'upload-btn' : 'border border-line bg-bg text-ink-3 cursor-not-allowed')}
                    >
                      <i className="upload-btn-icon ti ti-cloud-upload text-[14px]" aria-hidden="true" />
                      Upload file
                    </button>
                    <button type="button" onClick={() => setShowLinkForm(true)} disabled={uploading} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-line bg-panel text-[11px] font-medium text-ink-2 hover:border-ink-4">
                      <i className="ti ti-link text-[13px]" aria-hidden="true" />
                      Add Drive link
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*,application/pdf" multiple onChange={onFileChosen} className="sr-only" aria-hidden="true" />
                  </div>
                )}
              </div>
            ) : null}

            <Field label="Remarks">
              <textarea
                name="remarks"
                rows={3}
                maxLength={4000}
                defaultValue={card?.remarks ?? ''}
                disabled={uploading}
                placeholder="Notes about this contact…"
                className={cn(inputCn(false), 'resize-none')}
              />
            </Field>

            {uploadStatus ? (
              <p className="text-[12px] text-ink-2 inline-flex items-center gap-1.5">
                <i className="ti ti-loader-2 animate-spin text-[13px]" aria-hidden="true" />
                {uploadStatus}
              </p>
            ) : null}
            {(uploadError || state.error) ? (
              <p role="alert" className="text-[12px] text-urgent bg-urgent-soft border border-urgent/20 rounded-lg px-3 py-2">
                {uploadError ?? state.error}
              </p>
            ) : null}

            <div className="flex gap-2 mt-1">
              <button type="button" onClick={() => setOpen(false)} disabled={uploading} className="flex-1 py-2.5 rounded-lg border border-line text-[13px] font-medium text-ink-2 hover:bg-line-2 disabled:opacity-60">
                Cancel
              </button>
              <SaveButton mode={mode} uploading={uploading} hasAttachments={hasAttachments} />
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
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-ink-2">
        {label}
        {required ? <span className="text-urgent ml-0.5" aria-hidden="true">*</span> : null}
      </span>
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

function SaveButton({ mode, uploading, hasAttachments }: { mode: 'create' | 'edit'; uploading: boolean; hasAttachments: boolean }) {
  const { pending } = useFormStatus();
  const busy = pending || uploading;
  const label = uploading
    ? 'Uploading…'
    : pending
      ? 'Saving…'
      : mode === 'edit'
        ? 'Save changes'
        : hasAttachments
          ? 'Add & upload'
          : 'Add contact';
  return (
    <button type="submit" disabled={busy} className="flex-1 py-2.5 rounded-lg bg-ink text-onink text-[13px] font-medium disabled:opacity-60">
      {label}
    </button>
  );
}
