'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Pill, Sheet } from '@/components/ui';
import { setJsPriorityLaneAction } from '@/app/actions/tasks';
import { cn } from '@/lib/utils';

import type { PillJsLane } from '@/components/ui/Pill';

const OPTIONS: { value: PillJsLane | 'none'; label: string; sub: string }[] = [
  { value: 'today', label: 'Today', sub: 'JS scans now' },
  { value: 'week', label: 'This week', sub: 'Lands inside the week' },
  { value: 'month', label: 'This month', sub: 'On the monthly horizon' },
  { value: 'fortnight', label: 'Fortnight', sub: 'Lands inside two weeks' },
  { value: 'none', label: 'Remove from board', sub: 'Not on JS Priority' },
];

const LANE_LABEL: Record<PillJsLane, string> = {
  today: 'today',
  week: 'this week',
  month: 'this month',
  fortnight: 'fortnight',
};

type JsLanePickerProps = {
  taskId: string;
  current: PillJsLane | null;
  /** OSD or Super Admin */
  canCurate: boolean;
};

/**
 * JS Priority lane picker for the task detail title block.
 *   - canCurate + lane set → clickable pill, opens sheet
 *   - canCurate + no lane → small "+ JS Priority" button to add
 *   - !canCurate + lane → read-only pill
 *   - !canCurate + no lane → render nothing
 */
export function JsLanePicker({ taskId, current, canCurate }: JsLanePickerProps) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<PillJsLane | 'none'>(current ?? 'today');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (open) setChosen(current ?? 'today');
  }, [open, current]);

  const apply = () => {
    const fd = new FormData();
    fd.set('taskId', taskId);
    fd.set('lane', chosen === 'none' ? '' : chosen);
    startTransition(async () => {
      const result = await setJsPriorityLaneAction(undefined, fd);
      if (!result.ok && result.error) {
        setErrorBanner(result.error);
        return;
      }
      setOpen(false);
      setErrorBanner(null);
      router.refresh();
    });
  };

  if (!canCurate) {
    if (!current) return null;
    return <Pill variant="js" lane={current} />;
  }

  return (
    <>
      {current ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Change JS Priority — currently ${LANE_LABEL[current]}`}
          className="inline-flex"
        >
          <Pill variant="js" lane={current} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 px-2 py-[3px] text-[10px] font-medium rounded-pill border border-dashed border-accent-line text-accent hover:bg-accent-soft/40 transition-colors"
        >
          <i className="ti ti-plus text-[11px]" aria-hidden="true" />
          JS Priority
        </button>
      )}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Set JS Priority lane"
        subtitle="Owner, Director, and Section Officer get notified."
      >
        <div className="flex flex-col gap-3">
          <div role="radiogroup" aria-label="JS Priority lane" className="flex flex-col gap-1">
            {OPTIONS.map((o) => {
              const active = chosen === o.value;
              const isRemove = o.value === 'none';
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setChosen(o.value)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left',
                    active && !isRemove ? 'bg-accent-soft/40' : '',
                    active && isRemove ? 'bg-urgent-soft/40' : '',
                    !active ? 'hover:bg-bg' : '',
                  )}
                >
                  <span
                    className={cn(
                      'w-8 h-8 grid place-items-center rounded-lg',
                      active ? 'bg-panel' : 'bg-line-2',
                    )}
                  >
                    <i
                      className={cn(
                        'ti text-[14px]',
                        isRemove ? 'ti-x text-urgent' : 'ti-bookmark-filled text-accent',
                      )}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span
                      className={cn(
                        'block text-[13px] font-medium',
                        isRemove ? 'text-urgent' : 'text-ink',
                      )}
                    >
                      {o.label}
                    </span>
                    <span className="block text-[10px] text-ink-3 mt-0.5">{o.sub}</span>
                  </span>
                  {active ? (
                    <span className="w-5 h-5 grid place-items-center rounded-full bg-ink text-onink">
                      <i className="ti ti-check text-[12px]" aria-hidden="true" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {errorBanner ? (
            <p
              role="alert"
              className="text-[12px] text-urgent bg-urgent-soft border border-urgent/20 rounded-lg px-3 py-2"
            >
              {errorBanner}
            </p>
          ) : null}

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 py-2.5 rounded-lg border border-line text-[13px] font-medium text-ink-2 hover:bg-line-2"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={apply}
              className="flex-1 py-2.5 rounded-lg bg-ink text-onink text-[13px] font-medium disabled:opacity-60"
            >
              {pending ? 'Saving…' : 'Apply'}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
