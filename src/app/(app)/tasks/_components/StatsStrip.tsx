'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { Sheet } from '@/components/ui';
import { formatDue } from '@/lib/format';
import type { DivisionOpenBreakdown, StatTaskRow } from '@/lib/visibility';
import { cn } from '@/lib/utils';

type StatsStripProps = {
  counts: { open: number; dueToday: number; overdue: number; completed: number };
};

type Kind = 'today' | 'overdue' | 'divisions' | 'completed';

const SHEET_META: Record<Kind, { title: string; subtitle: string; empty: string }> = {
  today: { title: 'Due today', subtitle: 'Open tasks due today', empty: 'Nothing due today.' },
  overdue: { title: 'Overdue', subtitle: 'Open tasks past their due date', empty: 'No overdue tasks.' },
  divisions: { title: 'Open tasks by division', subtitle: 'Where the open work sits — counts only', empty: 'No open tasks.' },
  completed: { title: 'Completed', subtitle: 'Tasks marked completed', empty: 'No completed tasks.' },
};

/**
 * KPI stats, tucked behind a small trigger pill rather than shown inline —
 * the numbers are useful on demand, not something that should push the task
 * list down on every visit. The pill itself carries the one number worth
 * seeing at a glance (open tasks); tapping it floats in the full panel.
 *
 * Each tile inside the panel still opens its own drill-down popup (lazily
 * fetched, visibility-scoped) exactly as before: Due today / Overdue /
 * Completed list the tasks (each opens its detail), Open tasks shows the
 * per-division / sub-division counts.
 */
export function StatsStrip({ counts }: StatsStripProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const [kind, setKind] = useState<Kind | null>(null);
  const [tasks, setTasks] = useState<StatTaskRow[] | null>(null);
  const [divisions, setDivisions] = useState<DivisionOpenBreakdown[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setPanelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [panelOpen]);

  const openSheet = (next: Kind) => {
    setPanelOpen(false);
    setKind(next);
    setError(null);
    setLoading(true);
    if (next === 'divisions') setDivisions(null);
    else setTasks(null);
    fetch(`/api/tasks/stats?kind=${next}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('Could not load.');
        return r.json();
      })
      .then((data) => {
        if (next === 'divisions') setDivisions(data.divisions ?? []);
        else setTasks(data.tasks ?? []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Could not load.');
        setLoading(false);
      });
  };

  const close = () => setKind(null);
  const meta = kind ? SHEET_META[kind] : null;

  const items: { label: string; value: number; tone: 'ink' | 'accent' | 'urgent' | 'success'; kind: Kind }[] = [
    { label: 'Open tasks', value: counts.open, tone: 'ink', kind: 'divisions' },
    { label: 'Due today', value: counts.dueToday, tone: 'accent', kind: 'today' },
    { label: 'Overdue', value: counts.overdue, tone: counts.overdue > 0 ? 'urgent' : 'ink', kind: 'overdue' },
    { label: 'Completed', value: counts.completed, tone: 'success', kind: 'completed' },
  ];

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        aria-expanded={panelOpen}
        aria-haspopup="true"
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-[5px] rounded-[14px] text-[12px] font-medium border transition-colors',
          panelOpen
            ? 'bg-ink text-onink border-ink'
            : 'bg-panel text-ink-2 border-line hover:border-ink-4',
        )}
      >
        <i className="ti ti-chart-bar text-[13px]" aria-hidden="true" />
        KPIs
        <span className="tabular-nums">{counts.open}</span>
        <i
          className={cn('ti text-[11px] transition-transform', panelOpen ? 'ti-chevron-up' : 'ti-chevron-down')}
          aria-hidden="true"
        />
      </button>

      {panelOpen ? (
        <div className="absolute right-0 top-full mt-1 z-30 w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-line bg-panel shadow-xl p-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            {items.map((it) => (
              <StatButton
                key={it.label}
                label={it.label}
                value={it.value}
                tone={it.tone}
                onClick={() => openSheet(it.kind)}
              />
            ))}
          </div>
        </div>
      ) : null}

      <Sheet open={kind !== null} onClose={close} title={meta?.title} subtitle={meta?.subtitle}>
        {kind === 'divisions' ? (
          <DivisionsView
            divisions={divisions}
            loading={loading}
            error={error}
            empty={SHEET_META.divisions.empty}
            onNavigate={close}
          />
        ) : kind ? (
          <TaskListView
            tasks={tasks}
            loading={loading}
            error={error}
            empty={SHEET_META[kind].empty}
            onNavigate={close}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

// ------------------------------------------------------------
// Tile
// ------------------------------------------------------------

function StatButton({
  label,
  value,
  tone = 'ink',
  onClick,
}: {
  label: string;
  value: number;
  tone?: 'ink' | 'accent' | 'urgent' | 'success';
  onClick: () => void;
}) {
  const toneClass =
    tone === 'urgent'
      ? 'text-urgent'
      : tone === 'accent'
        ? 'text-accent'
        : tone === 'success'
          ? 'text-success'
          : 'text-ink';
  return (
    <button
      type="button"
      onClick={onClick}
      className="group text-left rounded-xl border border-line bg-panel p-3 transition-colors hover:border-ink-4 hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <div className={cn('font-serif leading-none font-medium text-[22px]', toneClass)}>{value}</div>
      <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.04em] text-ink-3">
        {label}
        <i
          className="ti ti-chevron-right text-[11px] text-ink-4 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </div>
    </button>
  );
}

// ------------------------------------------------------------
// Popup views
// ------------------------------------------------------------

function ViewSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-12 rounded-xl bg-line-2/60 animate-pulse" />
      ))}
    </div>
  );
}

function ViewError({ message }: { message: string }) {
  return (
    <p role="alert" className="py-2 text-center text-[13px] text-urgent">
      {message}
    </p>
  );
}

function TaskListView({
  tasks,
  loading,
  error,
  empty,
  onNavigate,
}: {
  tasks: StatTaskRow[] | null;
  loading: boolean;
  error: string | null;
  empty: string;
  onNavigate: () => void;
}) {
  if (error) return <ViewError message={error} />;
  if (loading && !tasks) return <ViewSkeleton />;
  if (!tasks || tasks.length === 0) {
    return <p className="py-3 text-center text-[13px] italic text-ink-3">{empty}</p>;
  }
  return (
    <ul className="-mx-1 flex max-h-[60dvh] flex-col gap-1.5 overflow-y-auto px-1">
      {tasks.map((t) => {
        const due = t.dueDate ? formatDue(new Date(t.dueDate)) : null;
        return (
          <li key={t.id}>
            <Link
              href={t.href}
              onClick={onNavigate}
              className="flex items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2.5 transition-colors hover:border-ink-4 hover:bg-bg"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: t.divisionColour }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{t.name}</span>
                <span className="block truncate text-[11px] text-ink-3">
                  {t.divisionName} · {t.ownerName}
                </span>
              </span>
              {t.status === 'completed' ? (
                <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-success">
                  <i className="ti ti-circle-check text-[12px]" aria-hidden="true" />
                  Done
                </span>
              ) : due && due.tone !== 'none' ? (
                <span
                  className={cn(
                    'shrink-0 text-[11px] font-medium',
                    due.tone === 'overdue' && 'text-urgent',
                    due.tone === 'today' && 'text-accent',
                    (due.tone === 'soon' || due.tone === 'future') && 'text-ink-3',
                  )}
                >
                  {due.label}
                </span>
              ) : null}
              <i className="ti ti-chevron-right shrink-0 text-[15px] text-ink-3" aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function DivisionsView({
  divisions,
  loading,
  error,
  empty,
  onNavigate,
}: {
  divisions: DivisionOpenBreakdown[] | null;
  loading: boolean;
  error: string | null;
  empty: string;
  onNavigate: () => void;
}) {
  if (error) return <ViewError message={error} />;
  if (loading && !divisions) return <ViewSkeleton />;
  if (!divisions || divisions.length === 0) {
    return <p className="py-3 text-center text-[13px] italic text-ink-3">{empty}</p>;
  }
  return (
    <ul className="-mx-1 flex max-h-[60dvh] flex-col gap-1.5 overflow-y-auto px-1">
      {divisions.map((d) => (
        <li key={d.divisionId}>
          <div className="rounded-xl border border-line bg-panel px-3 py-2.5">
            <Link
              href={`/tasks?division=${d.divisionId}`}
              onClick={onNavigate}
              className="group flex items-center gap-2.5"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: d.colour }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink group-hover:underline">
                {d.divisionName}
              </span>
              <span className="shrink-0 text-[13px] font-medium tabular-nums text-ink">{d.count}</span>
            </Link>
            {d.subDivisions.length > 0 ? (
              <ul className="ml-1 mt-1.5 flex flex-col gap-1 border-l border-line-2 pl-3">
                {d.subDivisions.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-[12px] text-ink-2">
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="shrink-0 tabular-nums text-ink-3">{s.count}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
