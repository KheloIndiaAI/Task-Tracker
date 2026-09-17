'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils';
import type { TfFilter } from '@/lib/timeline-files';

type Division = {
  id: string;
  name: string;
};

type TfListControlsProps = {
  divisions: Division[];
  /** Group-by-division is a cross-division (leadership) view; hidden otherwise. */
  canGroupByDivision: boolean;
};

/** Status options for the Status dropdown, each coloured with its own token
 *  so the dropdown reads with the same theme as the status badges. */
const STATUS_OPTIONS: { value: TfFilter; label: string; dot: string }[] = [
  { value: 'all', label: 'All statuses', dot: 'bg-ink-4' },
  { value: 'pending_action', label: 'Pending action', dot: 'bg-pending' },
  { value: 'in_progress', label: 'In progress', dot: 'bg-info' },
  { value: 'awaiting_reply', label: 'Awaiting reply', dot: 'bg-hold' },
  { value: 'on_hold', label: 'On hold', dot: 'bg-hold' },
  { value: 'closed', label: 'Closed', dot: 'bg-success' },
];

/**
 * Sort options for the files list. "Recently modified" is the default and is
 * cleared from the URL (empty value); the default order is the explicit
 * `?sort=default`. Kept in sync with TfSort / VALID_SORTS on the server, where
 * an absent sort resolves to "Recently modified" (latest), and mirrors the
 * tasks-page sort menu so the two lists feel identical.
 */
const SORT_OPTIONS: { value: '' | 'default' | 'alpha'; label: string; hint: string }[] = [
  { value: '', label: 'Recently modified', hint: 'Most recent activity on top' },
  { value: 'default', label: 'Default order', hint: 'Open first, soonest deadline' },
  { value: 'alpha', label: 'A–Z', hint: 'Alphabetical by subject' },
];

/**
 * Client controls for the timeline-files list: a Status dropdown (replaces the
 * old status filter chips), a Division dropdown (all divisions), a Sort
 * dropdown (default / latest), and a Group-by-division toggle. Each writes to
 * the URL search params the server page reads.
 */
export function TfListControls({ divisions, canGroupByDivision }: TfListControlsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeStatus = (searchParams.get('filter') as TfFilter | null) ?? 'all';
  const activeDivision = searchParams.get('division') ?? '';
  const activeSort = (searchParams.get('sort') ?? '') as '' | 'default' | 'alpha';
  const sortActive = activeSort !== '';
  const activeSortLabel = SORT_OPTIONS.find((o) => o.value === activeSort)?.label;
  const groupBy = searchParams.get('group') === 'division';
  const archived = searchParams.get('archived') === '1';

  const [statusOpen, setStatusOpen] = useState(false);
  const [divisionOpen, setDivisionOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const divisionRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) setStatusOpen(false);
      if (divisionRef.current && !divisionRef.current.contains(e.target as Node)) setDivisionOpen(false);
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const buildHref = useCallback(
    (overrides: { filter?: TfFilter; division?: string; sort?: string; group?: string; archived?: string }) => {
      const params = new URLSearchParams(searchParams.toString());
      const setOrDelete = (key: string, value: string | undefined, clearWhen: string) => {
        if (value === undefined) return;
        if (value && value !== clearWhen) params.set(key, value);
        else params.delete(key);
      };
      setOrDelete('filter', overrides.filter, 'all');
      setOrDelete('division', overrides.division, '');
      setOrDelete('sort', overrides.sort, '');
      setOrDelete('group', overrides.group, '');
      setOrDelete('archived', overrides.archived, '');
      const qs = params.toString();
      return qs ? `/timeline-files?${qs}` : '/timeline-files';
    },
    [searchParams],
  );

  const onSelectStatus = (value: TfFilter) => {
    setStatusOpen(false);
    router.push(buildHref({ filter: value }), { scroll: false });
  };
  const onSelectDivision = (divId: string) => {
    setDivisionOpen(false);
    router.push(buildHref({ division: divId || '' }), { scroll: false });
  };
  const onSelectSort = (sort: '' | 'default' | 'alpha') => {
    setSortOpen(false);
    router.push(buildHref({ sort }), { scroll: false });
  };
  const onToggleGroup = () => {
    router.push(buildHref({ group: groupBy ? '' : 'division' }), { scroll: false });
  };
  const onToggleArchived = () => {
    router.push(buildHref({ archived: archived ? '' : '1' }), { scroll: false });
  };

  const activeStatusMeta = STATUS_OPTIONS.find((o) => o.value === activeStatus);
  const statusActive = activeStatus !== 'all';
  const activeDivisionName = divisions.find((d) => d.id === activeDivision)?.name;

  const triggerClass = (active: boolean) =>
    cn(
      'inline-flex items-center gap-1.5 px-3 py-[5px] rounded-[14px] text-[12px] font-medium border transition-colors',
      active ? 'bg-ink text-onink border-ink' : 'bg-panel text-ink-2 border-line hover:border-ink-4',
    );

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      {/* Status filter dropdown */}
      <div ref={statusRef} className="relative">
        <button
          type="button"
          onClick={() => setStatusOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={statusOpen}
          className={triggerClass(statusActive)}
        >
          {statusActive && activeStatusMeta ? (
            <span
              className={cn('w-2 h-2 rounded-full', activeStatusMeta.dot)}
              aria-hidden="true"
            />
          ) : (
            <i className="ti ti-filter text-[13px]" aria-hidden="true" />
          )}
          {statusActive && activeStatusMeta ? activeStatusMeta.label : 'Status'}
          <i
            className={cn('ti text-[11px] transition-transform', statusOpen ? 'ti-chevron-up' : 'ti-chevron-down')}
            aria-hidden="true"
          />
        </button>

        {statusOpen ? (
          <ul
            role="listbox"
            className="absolute left-0 top-full mt-1 z-30 min-w-[200px] rounded-xl border border-line bg-panel shadow-xl overflow-hidden"
          >
            {STATUS_OPTIONS.map((o) => {
              const active = o.value === activeStatus;
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => onSelectStatus(o.value)}
                    className={cn(
                      'w-full flex items-center gap-2.5 text-left px-3 py-2.5 text-[12.5px] transition-colors',
                      active ? 'bg-primary-soft font-medium text-ink' : 'text-ink-2 hover:bg-bg',
                    )}
                  >
                    <span className={cn('w-2 h-2 rounded-full shrink-0', o.dot)} aria-hidden="true" />
                    {o.label}
                    {active ? (
                      <i className="ti ti-check text-[13px] text-ink ml-auto" aria-hidden="true" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {/* Division filter dropdown */}
      <div ref={divisionRef} className="relative">
        <button
          type="button"
          onClick={() => setDivisionOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={divisionOpen}
          className={triggerClass(!!activeDivision)}
        >
          <i className="ti ti-building text-[13px]" aria-hidden="true" />
          {activeDivisionName ?? 'Division'}
          <i
            className={cn('ti text-[11px] transition-transform', divisionOpen ? 'ti-chevron-up' : 'ti-chevron-down')}
            aria-hidden="true"
          />
        </button>

        {divisionOpen ? (
          <ul
            role="listbox"
            className="absolute left-0 top-full mt-1 z-30 min-w-[200px] rounded-xl border border-line bg-panel shadow-xl overflow-hidden max-h-[320px] overflow-y-auto"
          >
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!activeDivision}
                onClick={() => onSelectDivision('')}
                className={cn(
                  'w-full text-left px-3 py-2.5 text-[12.5px] font-medium transition-colors',
                  !activeDivision ? 'bg-primary-soft text-ink' : 'text-ink-2 hover:bg-bg',
                )}
              >
                All divisions
              </button>
            </li>
            {divisions.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={d.id === activeDivision}
                  onClick={() => onSelectDivision(d.id)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 text-[12.5px] transition-colors',
                    d.id === activeDivision ? 'bg-primary-soft font-medium text-ink' : 'text-ink-2 hover:bg-bg',
                  )}
                >
                  {d.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Sort dropdown */}
      <div ref={sortRef} className="relative">
        <button
          type="button"
          onClick={() => setSortOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={sortOpen}
          className={triggerClass(sortActive)}
        >
          <i className="ti ti-arrows-sort text-[13px]" aria-hidden="true" />
          {sortActive && activeSortLabel ? `Sort: ${activeSortLabel}` : 'Sort'}
          <i
            className={cn('ti text-[11px] transition-transform', sortOpen ? 'ti-chevron-up' : 'ti-chevron-down')}
            aria-hidden="true"
          />
        </button>

        {sortOpen ? (
          <ul
            role="listbox"
            className="absolute left-0 top-full mt-1 z-30 min-w-[200px] rounded-xl border border-line bg-panel shadow-xl overflow-hidden"
          >
            {SORT_OPTIONS.map((o) => {
              const active = o.value === activeSort;
              return (
                <li key={o.value || 'default'}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => onSelectSort(o.value)}
                    className={cn(
                      'w-full text-left px-3 py-2.5 text-[12.5px] transition-colors',
                      active ? 'bg-primary-soft font-medium text-ink' : 'text-ink-2 hover:bg-bg',
                    )}
                  >
                    {o.label}
                    <span className="block text-[10.5px] text-ink-3 mt-0.5">{o.hint}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {/* Group by division toggle — leadership only */}
      {canGroupByDivision ? (
        <button type="button" onClick={onToggleGroup} className={triggerClass(groupBy)}>
          <i className="ti ti-layout-rows text-[13px]" aria-hidden="true" />
          Group by division
        </button>
      ) : null}

      {/* Archived TL files toggle — shows archived files (still visibility-scoped) */}
      <button
        type="button"
        onClick={onToggleArchived}
        aria-pressed={archived}
        className={triggerClass(archived)}
      >
        <i className="ti ti-archive text-[13px]" aria-hidden="true" />
        Archived TL files
      </button>
    </div>
  );
}
