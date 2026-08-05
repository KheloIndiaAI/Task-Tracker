'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { format, formatDistanceToNow } from 'date-fns';

import { Sheet } from '@/components/ui/Sheet';
import {
  addDriveLinkAttachmentAction,
  deleteAttachmentAction,
  registerAttachmentAction,
  renameAttachmentAction,
} from '@/app/actions/attachments';
import { fileBadgeFor, formatBytes, MAX_UPLOAD_BYTES } from '@/lib/s3';
import { guessContentType } from '@/lib/mime';
import { cn } from '@/lib/utils';

export type AttachmentRow = {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType: string | null;
  sizeBytes: number | bigint | null;
  source: 'uploaded' | 'drive_link';
  uploadedAt: Date;
  uploaderName: string;
  canDelete: boolean;
};

type AttachmentListProps = {
  scope: 'task' | 'tf_source' | 'tf_action' | 'document' | 'business_card';
  parentId: string;
  attachments: AttachmentRow[];
  canEdit: boolean;
  /**
   * Whether the viewer may add new documents. Defaults to `canEdit`; pass it
   * separately to let contributors (e.g. task collaborators) upload without
   * granting them rename/delete rights over others' files.
   */
  canAdd?: boolean;
  s3Configured: boolean;
  mode?: 'list-multi' | 'list-single';
  emptyHint?: string;
};

export function AttachmentList({
  scope,
  parentId,
  attachments,
  canEdit,
  canAdd = canEdit,
  s3Configured,
  mode = 'list-multi',
  emptyHint,
}: AttachmentListProps) {
  const [driveOpen, setDriveOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onPickFile = () => fileInputRef.current?.click();

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;

    const oversize = files.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (oversize) {
      setUploadError(`${oversize.name} is over ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      return;
    }
    setUploadError(null);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress(
          files.length > 1
            ? `Uploading ${file.name} (${i + 1} of ${files.length})…`
            : `Uploading ${file.name}…`,
        );
        // One derived content-type for presign + PUT + register, so a file whose
        // browser MIME is empty/non-canonical still passes the allow-list and the
        // presigned signature matches the PUT.
        const contentType = guessContentType(file.name, file.type);
        const presignRes = await fetch('/api/attachments/upload-url', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            scope,
            parentId,
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
          throw new Error(`S3 rejected the upload (${putRes.status}).`);
        }

        const fd = new FormData();
        fd.set('scope', scope);
        fd.set('parentId', parentId);
        fd.set('source', 'uploaded');
        fd.set('key', key);
        fd.set('fileName', file.name);
        fd.set('mimeType', contentType);
        fd.set('sizeBytes', String(file.size));
        const registered = await registerAttachmentAction(undefined, fd);
        if (!registered.ok) {
          throw new Error(registered.error ?? 'Could not save the attachment.');
        }
      }
      setUploadProgress(null);
    } catch (err) {
      console.error('Upload failed:', err);
      setUploadProgress(null);
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    }
  };

  const onDelete = (id: string) => {
    if (!confirm('Remove this attachment?')) return;
    const fd = new FormData();
    fd.set('id', id);
    startTransition(async () => {
      const result = await deleteAttachmentAction(undefined, fd);
      if (!result.ok && result.error) alert(result.error);
    });
  };

  const visible =
    mode === 'list-single' ? attachments.slice(0, 1) : attachments;

  const isEmpty = visible.length === 0;

  return (
    <div>
      {canAdd ? (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            type="button"
            onClick={onPickFile}
            disabled={!s3Configured}
            title={
              s3Configured
                ? undefined
                : 'Storage is not configured on this server. Use a Drive link instead.'
            }
            className={cn(
              'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] font-medium',
              s3Configured
                ? 'upload-btn'
                : 'border border-line bg-bg text-ink-3 cursor-not-allowed',
            )}
          >
            <i className="upload-btn-icon ti ti-cloud-upload text-[15px]" aria-hidden="true" />
            {mode === 'list-single' && !isEmpty
              ? 'Replace file'
              : mode === 'list-single'
                ? 'Upload file'
                : 'Upload files'}
          </button>
          <button
            type="button"
            onClick={() => setDriveOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line bg-panel text-[12px] font-medium text-ink-2 hover:border-ink-4 hover:text-ink transition-colors"
          >
            <i className="ti ti-link text-[14px]" aria-hidden="true" />
            Add Drive link
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple={mode !== 'list-single'}
            onChange={onFileChosen}
            className="sr-only"
            aria-hidden="true"
          />
        </div>
      ) : null}

      {uploadProgress ? (
        <p className="text-[12px] text-ink-2 inline-flex items-center gap-1.5 mb-2">
          <i
            className="ti ti-loader-2 animate-spin text-[13px]"
            aria-hidden="true"
          />
          {uploadProgress}
        </p>
      ) : null}
      {uploadError ? (
        <p
          role="alert"
          className="text-[12px] text-urgent bg-urgent-soft border border-urgent/20 rounded-lg px-3 py-2 mb-2"
        >
          {uploadError}
        </p>
      ) : null}

      {isEmpty ? (
        <EmptyState mode={mode} canEdit={canAdd} hint={emptyHint} />
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((a) => (
            <li key={a.id}>
              <AttachmentRowCard
                row={a}
                onDelete={() => onDelete(a.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <DriveLinkDialog
        open={driveOpen}
        onClose={() => setDriveOpen(false)}
        scope={scope}
        parentId={parentId}
      />
    </div>
  );
}

// ------------------------------------------------------------
// Row — clicking the filename opens the file in a new tab.
// Action buttons use text labels (not icon-only) so they
// stay visible regardless of icon-font loading.
// ------------------------------------------------------------

const TONE_BG: Record<string, string> = {
  pdf: 'bg-urgent',
  doc: 'bg-medium',
  xls: 'bg-success',
  img: 'bg-success',
  drive: 'bg-info',
  file: 'bg-low',
};

function AttachmentRowCard({
  row,
  onDelete,
}: {
  row: AttachmentRow;
  onDelete: () => void;
}) {
  const badge = fileBadgeFor(row.fileName, row.source);
  const isDriveLink = row.source === 'drive_link';
  const viewUrl = `/api/attachments/${row.id}/view`;
  const downloadUrl = `/api/attachments/${row.id}/download`;

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const ext = isDriveLink ? '' : (row.fileName.includes('.') ? '.' + row.fileName.split('.').pop() : '');
  const baseName = ext ? row.fileName.slice(0, -ext.length) : row.fileName;

  const startEditing = () => {
    if (!row.canDelete) return;
    setEditValue(baseName);
    setEditing(true);
    setTimeout(() => renameInputRef.current?.select(), 0);
  };

  const commitRename = async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === baseName) {
      setEditing(false);
      return;
    }
    const newName = trimmed + ext;
    setRenaming(true);
    const fd = new FormData();
    fd.set('id', row.id);
    fd.set('fileName', newName);
    const result = await renameAttachmentAction(undefined, fd);
    setRenaming(false);
    if (result.ok) {
      setEditing(false);
    } else {
      alert(result.error ?? 'Could not rename.');
    }
  };

  const onRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  };

  const shareOnWhatsApp = async () => {
    setSharing(true);
    try {
      const res = await fetch(`/api/attachments/${row.id}/share-url`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Could not generate share link.');
      }
      const { url, fileName } = (await res.json()) as { url: string; fileName: string };
      const sizeStr = row.sizeBytes != null ? ` (${formatBytes(row.sizeBytes)})` : '';
      const text = `*MYAS Task Tracker*\nFile: ${fileName}${sizeStr}\nDownload: ${url}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    } catch (err) {
      console.error('WhatsApp share failed:', err);
      alert(err instanceof Error ? err.message : 'Share failed.');
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="bg-bg border border-line rounded-xl hover:border-ink-4 transition-colors">
      <div className="flex items-center gap-3 p-3">
        {/* File type badge */}
        <span
          className={cn(
            'w-9 h-10 rounded-[5px] grid place-items-end justify-center pb-1 text-onink text-[9px] font-medium shrink-0',
            TONE_BG[badge.tone],
          )}
          aria-hidden="true"
        >
          {badge.tone === 'drive' ? (
            <i className="ti ti-link text-[14px]" aria-hidden="true" />
          ) : (
            <span>{badge.label}</span>
          )}
        </span>

        {/* File info */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                ref={renameInputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={onRenameKeyDown}
                onBlur={commitRename}
                disabled={renaming}
                maxLength={196}
                className="flex-1 min-w-0 px-2 py-0.5 rounded border border-ink-4 bg-panel text-[13px] font-medium text-ink outline-none focus:border-ink"
                autoFocus
              />
              {ext ? (
                <span className="text-[13px] text-ink-3 font-medium shrink-0">{ext}</span>
              ) : null}
            </div>
          ) : (
            <span className="flex items-center gap-1">
              <a
                href={isDriveLink ? row.fileUrl : viewUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] font-medium text-ink truncate hover:underline"
              >
                {row.fileName}
              </a>
              {row.canDelete ? (
                <button
                  type="button"
                  onClick={startEditing}
                  className="shrink-0 text-ink-3 hover:text-ink transition-colors"
                  title="Rename"
                >
                  <i className="ti ti-pencil text-[12px]" aria-hidden="true" />
                </button>
              ) : null}
            </span>
          )}
          <p className="text-[11px] text-ink-3 truncate" title={format(row.uploadedAt, 'd LLL yyyy, h:mm a')}>
            {row.uploaderName} ·{' '}
            {formatDistanceToNow(row.uploadedAt, { addSuffix: true })}
            {isDriveLink ? ' · Drive link' : row.sizeBytes != null ? ` · ${formatBytes(row.sizeBytes)}` : null}
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-3 pb-3 pt-0 flex-wrap">
        {isDriveLink ? (
          <a
            href={row.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line text-[11px] font-medium text-ink-2 hover:bg-line-2 transition-colors"
          >
            <i className="ti ti-external-link text-[13px]" aria-hidden="true" />
            Open link
          </a>
        ) : (
          <>
            <a
              href={viewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line text-[11px] font-medium text-ink-2 hover:bg-line-2 transition-colors"
            >
              <i className="ti ti-eye text-[13px]" aria-hidden="true" />
              View
            </a>
            <a
              href={downloadUrl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line text-[11px] font-medium text-ink-2 hover:bg-line-2 transition-colors"
            >
              <i className="ti ti-download text-[13px]" aria-hidden="true" />
              Download
            </a>
          </>
        )}
        <button
          type="button"
          onClick={shareOnWhatsApp}
          disabled={sharing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#25D366]/40 text-[11px] font-medium text-[#25D366] hover:bg-[#25D366]/10 transition-colors disabled:opacity-50"
        >
          <i className="ti ti-brand-whatsapp text-[13px]" aria-hidden="true" />
          {sharing ? 'Sharing...' : 'WhatsApp'}
        </button>
        {row.canDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-urgent/30 text-[11px] font-medium text-urgent hover:bg-urgent-soft transition-colors ml-auto"
          >
            <i className="ti ti-trash text-[13px]" aria-hidden="true" />
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Empty state
// ------------------------------------------------------------

function EmptyState({
  mode,
  canEdit,
  hint,
}: {
  mode: 'list-multi' | 'list-single';
  canEdit: boolean;
  hint?: string;
}) {
  if (mode === 'list-single') {
    return (
      <div className="rounded-xl border-[1.5px] border-dashed border-line p-6 text-center bg-bg">
        <i
          className="ti ti-cloud-upload text-[26px] text-ink-3 block mb-1.5"
          aria-hidden="true"
        />
        <p className="text-[13px] font-medium text-ink-2 mb-1">Not yet uploaded</p>
        <p className="text-[11px] text-ink-3 max-w-sm mx-auto leading-relaxed">
          {hint ??
            'The final response sent in reply to this file — uploaded by the concerned section when action is complete.'}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-dashed border-line p-6 text-center bg-bg">
      <i className="ti ti-paperclip text-[24px] text-ink-3 block mb-1.5" aria-hidden="true" />
      <p className="text-[12px] text-ink-2 max-w-sm mx-auto leading-relaxed">
        {canEdit
          ? 'No attachments yet. Upload a file or paste a Drive link.'
          : hint ?? 'No attachments yet.'}
      </p>
    </div>
  );
}

// ------------------------------------------------------------
// Drive-link dialog
// ------------------------------------------------------------

function DriveLinkDialog({
  open,
  onClose,
  scope,
  parentId,
}: {
  open: boolean;
  onClose: () => void;
  scope: 'task' | 'tf_source' | 'tf_action' | 'document' | 'business_card';
  parentId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState(addDriveLinkAttachmentAction, {
    ok: false,
    epoch: 0,
  });

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.epoch]);

  return (
    <Sheet open={open} onClose={onClose} title="Add a Drive link" subtitle="Anyone with link access on the source will be able to open it.">
      {open ? (
        <form ref={formRef} action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="scope" value={scope} />
          <input type="hidden" name="parentId" value={parentId} />

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-ink-2">Display name</span>
            <input
              name="fileName"
              required
              maxLength={200}
              autoFocus
              autoComplete="off"
              placeholder="e.g. Mission architecture diagram"
              className={inputCn(!!state.fieldErrors?.fileName)}
            />
            {state.fieldErrors?.fileName ? (
              <span className="text-[11px] text-urgent">{state.fieldErrors.fileName}</span>
            ) : null}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-ink-2">URL</span>
            <input
              name="driveUrl"
              type="url"
              required
              maxLength={1000}
              autoComplete="off"
              placeholder="https://drive.google.com/…"
              className={inputCn(!!state.fieldErrors?.driveUrl)}
            />
            {state.fieldErrors?.driveUrl ? (
              <span className="text-[11px] text-urgent">{state.fieldErrors.driveUrl}</span>
            ) : null}
          </label>

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
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-line text-[13px] font-medium text-ink-2 hover:bg-line-2"
            >
              Cancel
            </button>
            <SaveButton />
          </div>
        </form>
      ) : null}
    </Sheet>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex-1 py-2.5 rounded-lg bg-ink text-onink text-[13px] font-medium disabled:opacity-60"
    >
      {pending ? 'Adding…' : 'Add link'}
    </button>
  );
}

function inputCn(hasError: boolean) {
  return cn(
    'w-full px-3 py-2 rounded-lg border bg-panel text-[13px] text-ink outline-none transition-colors',
    hasError ? 'border-urgent focus:border-urgent' : 'border-line focus:border-ink',
  );
}
