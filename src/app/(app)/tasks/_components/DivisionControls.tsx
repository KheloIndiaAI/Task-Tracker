'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils';

type Division = {
  id: string;
  name: string;
};

type DivisionControlsProps = {
  divisions: Division[];
};

/**
 * One shape for every control in this row, so the Division dropdown and the
 * My-tasks pill cannot drift apart. Active is the filled ink treatment the
 * dropdown has always used for a chosen division.
 */
const PILL = 'inline-flex items-center gap-1.5 px-3 py-[5px] rounded-[14px] text-[12px] font-medium border transition-colors';
const PILL_ACTIVE = 'bg-ink text-onink border-ink';
const PILL_IDLE = 'bg-panel text-ink-2 border-line hover:border-ink-4';

/**
 * The tasks list's header controls: a Division filter dropdown and a My-tasks
 * toggle, both writing to the URL so the server re-scopes the same division
 * board rather than a second layout appearing.
 *
 * My tasks maps to `?filter=mine` — the filter the JS Dashboard's "My tasks"
 * stat already links to, so arriving from there shows the pill lit. It is a
 * toggle, not a mode: turning it off drops the param entirely rather than
 * writing `filter=all`, keeping the URL clean and any other filter a link
 * might carry intact.
 *
 * These used to sit alongside a "Group by division" toggle and a Sort
 * dropdown — both removed by request, since they only ever showed the state
 * that was already the default and never gave anyone a reason to change it.
 */
export function DivisionControls({ divisions }: DivisionControlsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeDivision = searchParams.get('division') ?? '';
  const mineActive = searchParams.get('filter') === 'mine';

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const buildHref = useCallback(
    (divisionId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (divisionId) params.set('division', divisionId);
      else params.delete('division');
      const qs = params.toString();
      return qs ? `/tasks?${qs}` : '/tasks';
    },
    [searchParams],
  );

  const onSelectDivision = (divId: string) => {
    setDropdownOpen(false);
    router.push(buildHref(divId), { scroll: false });
  };

  const onToggleMine = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (mineActive) params.delete('filter');
    else params.set('filter', 'mine');
    const qs = params.toString();
    router.push(qs ? `/tasks?${qs}` : '/tasks', { scroll: false });
  };

  const activeName = divisions.find((d) => d.id === activeDivision)?.name;

  return (
    <div className="flex items-center gap-2">
      <div ref={wrapperRef} className="relative">
        <button
          type="button"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className={cn(PILL, activeDivision ? PILL_ACTIVE : PILL_IDLE)}
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

      {/* My tasks — the same board, narrowed to what this user owns. */}
      <button
        type="button"
        onClick={onToggleMine}
        aria-pressed={mineActive}
        title={mineActive ? 'Show the whole board' : 'Show only tasks assigned to me'}
        className={cn(PILL, mineActive ? PILL_ACTIVE : PILL_IDLE)}
      >
        <i className="ti ti-user-check text-[13px]" aria-hidden="true" />
        My tasks
      </button>
    </div>
  );
}
