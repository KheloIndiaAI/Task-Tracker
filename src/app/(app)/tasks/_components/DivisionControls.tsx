'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { groupParamFor, resolveGroupByDivision } from '@/lib/task-grouping-shared';
import { cn } from '@/lib/utils';

type Division = {
  id: string;
  name: string;
};

type DivisionControlsProps = {
  divisions: Division[];
  /** Group-by-division is a cross-division (leadership) view; hidden otherwise. */
  canGroupByDivision: boolean;
  /**
   * What an absent `?group=` means for this caller — true for a Super Admin,
   * who opens the list grouped. Must match the server's `defaultGroupByDivision`
   * in tasks/page.tsx, or the button would light up out of step with the list.
   */
  defaultGroupByDivision: boolean;
};

/**
 * Sort options for the tasks list. "Recently modified" is the default and is
 * cleared from the URL (empty value); the smart order is the explicit
 * `?sort=default`. Kept in sync with TaskSort / VALID_SORTS on the server, where
 * an absent sort resolves to "Recently modified" (latest).
 */
const SORT_OPTIONS: { value: '' | 'default' | 'alpha'; label: string; hint: string }[] = [
  { value: '', label: 'Recently modified', hint: 'Most recent activity on top' },
  { value: 'default', label: 'Default order', hint: 'JS Priority, due date, priority' },
  { value: 'alpha', label: 'A–Z', hint: 'Alphabetical by task name' },
];

export function DivisionControls({
  divisions,
  canGroupByDivision,
  defaultGroupByDivision,
}: DivisionControlsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeDivision = searchParams.get('division') ?? '';
  // Same rule the server page uses, so the button never lights up out of step
  // with the list it controls.
  const groupBy = resolveGroupByDivision(searchParams.get('group'), defaultGroupByDivision);
  const activeSort = (searchParams.get('sort') ?? '') as '' | 'default' | 'alpha';
  const sortActive = activeSort !== '';
  const activeSortLabel = SORT_OPTIONS.find((o) => o.value === activeSort)?.label;

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const buildHref = useCallback(
    (overrides: { division?: string; group?: string; sort?: string }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (overrides.division !== undefined) {
        if (overrides.division) {
          params.set('division', overrides.division);
        } else {
          params.delete('division');
        }
      }
      if (overrides.group !== undefined) {
        if (overrides.group) {
          params.set('group', overrides.group);
        } else {
          params.delete('group');
        }
      }
      if (overrides.sort !== undefined) {
        if (overrides.sort) {
          params.set('sort', overrides.sort);
        } else {
          params.delete('sort');
        }
      }
      const qs = params.toString();
      return qs ? `/tasks?${qs}` : '/tasks';
    },
    [searchParams],
  );

  const onSelectDivision = (divId: string) => {
    setDropdownOpen(false);
    router.push(buildHref({ division: divId || '' }), { scroll: false });
  };

  const onToggleGroup = () => {
    router.push(
      buildHref({ group: groupParamFor(!groupBy, defaultGroupByDivision) }),
      { scroll: false },
    );
  };

  const onSelectSort = (sort: '' | 'default' | 'alpha') => {
    setSortOpen(false);
    router.push(buildHref({ sort }), { scroll: false });
  };

  const activeName = divisions.find((d) => d.id === activeDivision)?.name;

  return (
    <div className="flex flex-wrap items-center justify-start gap-2 mt-2">
      {/* Division filter dropdown */}
      <div ref={wrapperRef} className="relative">
        <button
          type="button"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-[5px] rounded-[14px] text-[12px] font-medium border transition-colors',
            activeDivision
              ? 'bg-ink text-onink border-ink'
              : 'bg-panel text-ink-2 border-line hover:border-ink-4',
          )}
        >
          <i className="ti ti-building text-[13px]" aria-hidden="true" />
          {activeName ?? 'Division'}
          <i
            className={cn(
              'ti text-[11px] transition-transform',
              dropdownOpen ? 'ti-chevron-up' : 'ti-chevron-down',
            )}
            aria-hidden="true"
          />
        </button>

        {dropdownOpen ? (
          <ul
            role="listbox"
            className="absolute left-0 top-full mt-1 z-30 min-w-[200px] max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-panel shadow-xl overflow-hidden max-h-[320px] overflow-y-auto"
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
                    d.id === activeDivision
                      ? 'bg-primary-soft font-medium text-ink'
                      : 'text-ink-2 hover:bg-bg',
                  )}
                >
                  {d.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Group by division toggle — leadership only */}
      {canGroupByDivision ? (
        <button
          type="button"
          onClick={onToggleGroup}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-[5px] rounded-[14px] text-[12px] font-medium border transition-colors',
            groupBy
              ? 'bg-ink text-onink border-ink'
              : 'bg-panel text-ink-2 border-line hover:border-ink-4',
          )}
        >
          <i className="ti ti-layout-rows text-[13px]" aria-hidden="true" />
          Group by division
        </button>
      ) : null}

      {/* Sort dropdown — available in flat and grouped views alike */}
      <div ref={sortRef} className="relative">
        <button
          type="button"
          onClick={() => setSortOpen(!sortOpen)}
          aria-haspopup="listbox"
          aria-expanded={sortOpen}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-[5px] rounded-[14px] text-[12px] font-medium border transition-colors',
            sortActive
              ? 'bg-ink text-onink border-ink'
              : 'bg-panel text-ink-2 border-line hover:border-ink-4',
          )}
        >
          <i className="ti ti-arrows-sort text-[13px]" aria-hidden="true" />
          {sortActive && activeSortLabel ? `Sort: ${activeSortLabel}` : 'Sort'}
          <i
            className={cn(
              'ti text-[11px] transition-transform',
              sortOpen ? 'ti-chevron-up' : 'ti-chevron-down',
            )}
            aria-hidden="true"
          />
        </button>

        {sortOpen ? (
          <ul
            role="listbox"
            className="absolute right-0 md:left-0 md:right-auto top-full mt-1 z-30 min-w-[200px] rounded-xl border border-line bg-panel shadow-xl overflow-hidden"
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
    </div>
  );
}
