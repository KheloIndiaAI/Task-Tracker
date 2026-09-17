'use client';

import { useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import {
  commitImportAction,
  parseImportAction,
  type CommitState,
  type ImportPreviewRow,
  type ParsePreviewState,
} from '@/app/actions/bulk-import';
import { cn } from '@/lib/utils';

const CSV_TEMPLATE = `name,description,due_date,priority,division_name,owner_username,tags
Cabinet brief draft v1,Initial outline for review,2026-06-20,high,Office of JS,osd.myas,"Cabinet,Q1"
Section 3 cost figures,Pull MoF data and tabulate,2026-06-18,medium,Office of JS,osd.myas,
`;

const INITIAL_PARSE: ParsePreviewState = { ok: false, epoch: 0 };
const INITIAL_COMMIT: CommitState = { ok: false, epoch: 0 };

export function BulkImportWorkflow() {
  const [parseState, parseAction] = useFormState(parseImportAction, INITIAL_PARSE);
  const [commitState, commitAction] = useFormState(commitImportAction, INITIAL_COMMIT);

  const previewRows = parseState.preview ?? [];
  const validRows = previewRows.filter((r) => r.ok && r.resolved);
  const invalidRows = previewRows.filter((r) => !r.ok);

  return (
    <div className="flex flex-col gap-5">
      {/* Step 1 — template download */}
      <Step n={1} title="Download the template">
        <p className="text-[12px] text-ink-2 leading-relaxed mb-3">
          A CSV with the right columns. The example rows are illustrative — replace
          them with your own data.
        </p>
        <TemplateDownloadButton />
        <Hints />
      </Step>

      {/* Step 2 — upload + preview */}
      <Step n={2} title="Upload your filled CSV">
        <form action={parseAction} className="flex flex-col gap-3">
          <FileField error={parseState.error} hasPreview={!!parseState.preview} />
          <div className="flex gap-2">
            <ParseButton />
          </div>
        </form>
      </Step>

      {/* Step 3 — preview */}
      {parseState.ok && previewRows.length > 0 ? (
        <Step n={3} title="Preview" sub={`${validRows.length} valid · ${invalidRows.length} rejected`}>
          <PreviewTable rows={previewRows} />

          {validRows.length > 0 && !commitState.ok ? (
            <form action={commitAction} className="mt-4 flex flex-col gap-2">
              <input
                type="hidden"
                name="payload"
                value={JSON.stringify({
                  rows: validRows.map((r) => r.resolved!),
                })}
              />
              {commitState.error ? (
                <p
                  role="alert"
                  className="text-[12px] text-urgent bg-urgent-soft border border-urgent/20 rounded-lg px-3 py-2"
                >
                  {commitState.error}
                </p>
              ) : null}
              <div className="flex justify-end">
                <CommitButton count={validRows.length} />
              </div>
            </form>
          ) : null}

          {commitState.ok ? (
            <div className="mt-4 rounded-lg border border-success/30 bg-success-soft p-4 text-[13px] text-success">
              <p className="font-medium inline-flex items-center gap-1.5">
                <i className="ti ti-circle-check text-[15px]" aria-hidden="true" />
                Created {commitState.createdCount}{' '}
                {commitState.createdCount === 1 ? 'task' : 'tasks'}
                {commitState.skippedCount && commitState.skippedCount > 0
                  ? ` · skipped ${commitState.skippedCount}`
                  : ''}
                .
              </p>
              <p className="text-[12px] text-ink-2 mt-1 leading-relaxed">
                Audit log holds a single &lsquo;bulk_import&rsquo; summary entry. New
                tasks are visible on <strong>/tasks</strong> now.
              </p>
            </div>
          ) : null}
        </Step>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------
// Step shell
// ------------------------------------------------------------

function Step({
  n,
  title,
  sub,
  children,
}: {
  n: number;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-panel border border-line rounded-2xl">
      <header className="px-4 md:px-5 pt-4 pb-2.5 border-b border-line-2">
        <p className="text-[10px] uppercase tracking-[0.08em] font-medium text-ink-3 mb-1">
          Step {n}
        </p>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-[16px] md:text-[18px] leading-tight text-ink">
            {title}
          </h2>
          {sub ? <span className="text-[11px] text-ink-3">{sub}</span> : null}
        </div>
      </header>
      <div className="p-4 md:p-5">{children}</div>
    </section>
  );
}

// ------------------------------------------------------------
// Template download
// ------------------------------------------------------------

function TemplateDownloadButton() {
  const [downloaded, setDownloaded] = useState(false);

  const onClick = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'myas-bulk-import-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-line bg-panel text-[13px] font-medium text-ink hover:bg-line-2 transition-colors"
    >
      <i className="ti ti-file-spreadsheet text-[14px]" aria-hidden="true" />
      {downloaded ? 'Downloaded' : 'Download CSV template'}
    </button>
  );
}

function Hints() {
  return (
    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-ink-2">
      <Hint icon="ti-quote">
        Quote fields containing commas, then double quotes inside that.
      </Hint>
      <Hint icon="ti-calendar">
        <code className="font-mono">due_date</code> is{' '}
        <code className="font-mono">YYYY-MM-DD</code> (or blank).
      </Hint>
      <Hint icon="ti-flame">
        <code className="font-mono">priority</code> ∈{' '}
        <code className="font-mono">low / medium / high / urgent</code>.
      </Hint>
      <Hint icon="ti-tag">
        <code className="font-mono">tags</code>: comma- or semicolon-separated. Missing tags get auto-created.
      </Hint>
      <Hint icon="ti-building">
        <code className="font-mono">division_name</code> must match an existing top-level division exactly.
      </Hint>
      <Hint icon="ti-user">
        <code className="font-mono">owner_username</code> must be an active user&rsquo;s sign-in name.
      </Hint>
    </div>
  );
}

function Hint({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 leading-relaxed">
      <i
        className={cn('ti', icon, 'text-[12px] text-ink-3 mt-[3px] shrink-0')}
        aria-hidden="true"
      />
      <span>{children}</span>
    </p>
  );
}

// ------------------------------------------------------------
// File field
// ------------------------------------------------------------

function FileField({
  error,
  hasPreview,
}: {
  error?: string;
  hasPreview: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <div>
      <label
        htmlFor="bulk-csv"
        className={cn(
          'flex items-center justify-center gap-2 px-4 py-6 rounded-xl border-2 border-dashed text-[13px] font-medium cursor-pointer transition-colors',
          error
            ? 'border-urgent text-urgent bg-urgent-soft/40'
            : hasPreview
              ? 'border-primary-line/60 text-primary bg-primary-soft/40'
              : 'border-line text-ink-2 bg-bg hover:border-ink-4 hover:text-ink',
        )}
      >
        <i className="ti ti-cloud-upload text-[18px]" aria-hidden="true" />
        {fileName ? `Selected: ${fileName}` : 'Click to choose a CSV file…'}
      </label>
      <input
        ref={inputRef}
        id="bulk-csv"
        name="file"
        type="file"
        accept=".csv,text/csv"
        required
        className="sr-only"
        onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
      />
      {error ? (
        <p
          role="alert"
          className="text-[12px] text-urgent bg-urgent-soft border border-urgent/20 rounded-lg px-3 py-2 mt-2"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ParseButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-ink text-onink text-[13px] font-medium disabled:opacity-60"
    >
      {pending ? 'Parsing…' : 'Parse & preview'}
    </button>
  );
}

function CommitButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || count === 0}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-ink text-onink text-[13px] font-medium disabled:opacity-60"
    >
      {pending
        ? 'Creating tasks…'
        : `Create ${count} ${count === 1 ? 'task' : 'tasks'}`}
    </button>
  );
}

// ------------------------------------------------------------
// Preview table
// ------------------------------------------------------------

function PreviewTable({ rows }: { rows: ImportPreviewRow[] }) {
  return (
    <div className="rounded-xl border border-line overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-bg border-b border-line text-left">
            <Th className="w-[60px]">#</Th>
            <Th className="w-[80px]">Status</Th>
            <Th>Name</Th>
            <Th>Owner</Th>
            <Th>Division</Th>
            <Th>Due</Th>
            <Th>Priority</Th>
            <Th>Tags</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.index}
              className={cn(
                'border-b border-line-2 last:border-b-0',
                !row.ok && 'bg-urgent-soft/20',
              )}
            >
              <Td muted>{row.index}</Td>
              <Td>
                {row.ok ? (
                  <span className="inline-flex items-center gap-1 text-success font-medium">
                    <i className="ti ti-circle-check text-[13px]" aria-hidden="true" />
                    Valid
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-urgent font-medium">
                    <i className="ti ti-circle-x text-[13px]" aria-hidden="true" />
                    Rejected
                  </span>
                )}
              </Td>
              <Td>
                <span className={cn(!row.ok && 'text-ink-3')}>
                  {row.resolved?.name ?? row.raw.name ?? ''}
                </span>
                {!row.ok && row.error ? (
                  <p className="text-[10px] text-urgent mt-0.5">{row.error}</p>
                ) : null}
              </Td>
              <Td muted>{row.resolved?.ownerName ?? row.raw.owner_username ?? ''}</Td>
              <Td muted>{row.resolved?.divisionName ?? row.raw.division_name ?? ''}</Td>
              <Td muted>{row.resolved?.dueDate ?? row.raw.due_date ?? ''}</Td>
              <Td muted>{row.resolved?.priority ?? row.raw.priority ?? ''}</Td>
              <Td muted>{(row.resolved?.tagNames ?? []).join(', ')}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'text-[10px] uppercase tracking-[0.06em] font-medium text-ink-3 px-3 py-2',
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <td className={cn('px-3 py-2 align-top', muted ? 'text-ink-2' : 'text-ink')}>
      {children}
    </td>
  );
}
