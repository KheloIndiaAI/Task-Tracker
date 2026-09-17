'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils';

/**
 * One shape for both controls in this row, so they cannot drift apart. Active
 * is the filled ink treatment.
 */
const PILL = 'inline-flex items-center gap-1.5 px-3 py-[5px] rounded-[14px] text-[12px] font-medium border transition-colors';
const PILL_ACTIVE = 'bg-ink text-onink border-ink';
const PILL_IDLE = 'bg-panel text-ink-2 border-line hover:border-ink-4';

/**
 * The tasks list's scope pair. Two plain pills, both writing to the URL so the
 * server re-scopes the same division board — never a second layout.
 *
 * **All tasks** is the page's default and its reset: clicking it drops every
 * scope param and lands on the bare task panel. It is lit only when the board
 * really is showing everything, which matters because the board can be
 * narrowed from elsewhere — the KPI panel deep-links to
 * `/tasks?division=<id>`. Arriving that way leaves this pill unlit, saying
 * plainly "you are not seeing all tasks", and clicking it is the way back.
 *
 * **My tasks** maps to `?filter=mine` — the filter the JS Dashboard's "My
 * tasks" stat already links to, so arriving from there shows it lit. A toggle,
 * not a mode: turning it off drops the param rather than writing `filter=all`.
 *
 * There is deliberately no division dropdown here any more. It existed to
 * escape `?division=`, and the pill above now does that better: one tap, no
 * menu, and the narrowed board already names the division on its own card, so
 * repeating it in the control was duplication. `?division=` itself is still
 * honoured by the page, so the KPI links and any bookmark keep working.
 *
 * The row also once carried status filter chips, a Sort dropdown and a
 * Group-by-division toggle — all removed, each because it only ever showed
 * the state that was already the default.
 */
export function TaskScopeControls() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const mineActive = searchParams.get('filter') === 'mine';
  const divisionActive = (searchParams.get('division') ?? '') !== '';
  // Lit only in the true default state — anything narrowing the board, from
  // any source, has to turn this off or the pill would be claiming something
  // the list is not showing.
  const allActive = !mineActive && !divisionActive;

  const push = (params: URLSearchParams) => {
    const qs = params.toString();
    router.push(qs ? `/tasks?${qs}` : '/tasks', { scroll: false });
  };

  const onShowAll = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('division');
    params.delete('filter');
    push(params);
  };

  const onToggleMine = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (mineActive) params.delete('filter');
    else params.set('filter', 'mine');
    push(params);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onShowAll}
        aria-pressed={allActive}
        title={
          allActive
            ? 'Showing every division'
            : 'Back to every division, unfiltered'
        }
        className={cn(PILL, allActive ? PILL_ACTIVE : PILL_IDLE)}
      >
        <i className="ti ti-users text-[13px]" aria-hidden="true" />
        All tasks
      </button>

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
