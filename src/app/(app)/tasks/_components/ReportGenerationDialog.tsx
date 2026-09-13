'use client';

import { useState } from 'react';

import { Sheet } from '@/components/ui';
import { REPORT_CADENCES, REPORT_CADENCE_LABEL, type ReportCadence } from '@/lib/reports-shared';
import { cn } from '@/lib/utils';

type ReportDivisionOption = { id: string; name: string };

type ReportGenerationDialogProps = {
  divisions: ReportDivisionOption[];
};

/**
 * Trigger + filter popup for the Priority Task Report PDF. Generating does
 * not fetch/download via JS — it navigates the browser to the report route
 * with the chosen filters as query params, exactly like clicking a link.
 * The route responds with `Content-Disposition: attachment`, so the browser
 * downloads the file and stays on this page; no blob/object-URL handling
 * needed, and the session cookie rides along automatically since this is a
 * same-origin top-level GET.
 *
 * Division and Priority are both multi-select — leaving every checkbox/pill
 * off means "no filter" (all divisions / all priorities), matching the
 * standard faceted-filter convention, not "select none of them".
 */
export function ReportGenerationDialog({ divisions }: ReportGenerationDialogProps) {
  const [open, setOpen] = useState(false);
  const [divisionIds, setDivisionIds] = useState<Set<string>>(new Set());
  const [priorities, setPriorities] = useState<Set<ReportCadence>>(new Set());
  const [scope, setScope] = useState<'scheduled' | 'all'>('scheduled');
  const [includeStatus, setIncludeStatus] = useState(false);
  const [includeJsComment, setIncludeJsComment] = useState(false);

  const layout = includeStatus || includeJsComment ? 'detailed' : 'compact';

  const toggleDivision = (id: string) => {
    setDivisionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePriority = (p: ReportCadence) => {
    setPriorities((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const onGenerate = () => {
    const params = new URLSearchParams();
    if (divisionIds.size > 0) params.set('division', [...divisionIds].join(','));
    if (priorities.size > 0) params.set('priority', [...priorities].join(','));
    if (scope !== 'scheduled') params.set('scope', scope);
    if (includeStatus) params.set('status', '1');
    if (includeJsComment) params.set('jsComment', '1');
    const qs = params.toString();
    window.location.href = qs ? `/api/reports/priority-task?${qs}` : '/api/reports/priority-task';
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-line text-[13px] font-medium text-ink-2 hover:border-ink-4 hover:text-ink transition-colors"
      >
        <i className="ti ti-report text-[14px]" aria-hidden="true" />
        <span className="hidden sm:inline">Report generation</span>
        <span className="sm:hidden">Report</span>
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Generate priority task report"
        subtitle="Choose the filters below, then download the PDF."
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <Field label="Division" hint="Leave every box unchecked for all divisions.">
            {divisions.length === 0 ? (
              <p className="text-[11px] text-ink-3">No divisions available.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 max-h-[180px] overflow-y-auto pr-1">
                {divisions.map((d) => (
                  <label
                    key={d.id}
                    className="flex items-center gap-2 text-[12.5px] text-ink cursor-pointer py-0.5"
                  >
                    <input
                      type="checkbox"
                      checked={divisionIds.has(d.id)}
                      onChange={() => toggleDivision(d.id)}
                      className="h-3.5 w-3.5 rounded border-line accent-ink shrink-0"
                    />
                    <span className="truncate">{d.name}</span>
                  </label>
                ))}
              </div>
            )}
          </Field>

          <Field label="Priority" hint="Leave every pill off for all priorities.">
            <div className="flex flex-wrap gap-1.5">
              {REPORT_CADENCES.map((c) => {
                const active = priorities.has(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => togglePriority(c)}
                    aria-pressed={active}
                    className={cn(
                      'px-3 py-1.5 rounded-full border text-[12px] font-medium transition-colors',
                      active
                        ? 'bg-ink text-onink border-ink'
                        : 'bg-panel text-ink-2 border-line hover:border-ink-4',
                    )}
                  >
                    {REPORT_CADENCE_LABEL[c]}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Scope">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { value: 'scheduled', label: 'Scheduled tasks only' },
                  { value: 'all', label: 'All tasks' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setScope(opt.value)}
                  aria-pressed={scope === opt.value}
                  className={cn(
                    'px-3 py-2 rounded-lg border text-[12.5px] font-medium transition-colors text-left',
                    scope === opt.value
                      ? 'bg-ink text-onink border-ink'
                      : 'bg-panel text-ink-2 border-line hover:border-ink-4',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>

          <div className="flex flex-col gap-2">
            <Checkbox
              label="Status include"
              checked={includeStatus}
              onChange={setIncludeStatus}
            />
            <Checkbox
              label="JS Comment include"
              checked={includeJsComment}
              onChange={setIncludeJsComment}
            />
            <p className="text-[11px] text-ink-3 leading-relaxed">
              {layout === 'detailed'
                ? 'One row per task, with the columns checked above.'
                : 'Neither checked — a compact grid of task names by division and priority.'}
            </p>
          </div>

          <button
            type="button"
            onClick={onGenerate}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-ink text-onink text-[13px] font-medium hover:bg-ink-2 transition-colors"
          >
            <i className="ti ti-file-download text-[15px]" aria-hidden="true" />
            Generate PDF
          </button>
        </div>
      </Sheet>
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-[10.5px] text-ink-3">{hint}</span> : null}
    </div>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-ink cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-line accent-ink"
      />
      {label}
    </label>
  );
}
