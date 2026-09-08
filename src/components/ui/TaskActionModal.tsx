'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

import { setJsPriorityLaneAction, updateTaskStatusAction } from '@/app/actions/tasks';
import { cn } from '@/lib/utils';
import { useOverlayLifecycle } from '@/components/ui/useOverlayLifecycle';

import type { PillJsLane, PillStatusTone } from '@/components/ui/Pill';

/**
 * Centered quick-action modal for a task card (mobile only), opened by a ~2 s
 * long press. Shows only the actions the caller is permitted to run — options
 * they lack permission for are hidden entirely (the server re-authorizes every
 * action regardless):
 *   - Add to / remove from the Priority Board Fortnight lane (OSD / Super Admin)
 *   - On hold / In progress / Completed                  (task managers)
 *
 * Colour tokens are kept consistent with the rest of the app: the Fortnight row
 * carries the amber JS-Priority accent (its only sanctioned use here); the three
 * status rows use their own hold / info / success status tokens.
 */

type ActionKey = 'fortnight' | 'on_hold' | 'in_progress' | 'completed';

export type TaskActionModalProps = {
  open: boolean;
  onClose: () => void;
  taskId: string;
  name: string;
  currentStatus: PillStatusTone;
  currentLane: PillJsLane | null;
  canChangeStatus: boolean;
  canSetFortnight: boolean;
};

const EXIT_MS = 200;

type Row = {
  key: ActionKey;
  label: string;
  icon: string;
  chip: string; // color token classes for the icon chip
  current: boolean; // the current status — shown as a checkmark, inert
  run: () => Promise<{ ok: boolean; error?: string }>;
};

export function TaskActionModal({
  open,
  onClose,
  taskId,
  name,
  currentStatus,
  currentLane,
  canChangeStatus,
  canSetFortnight,
}: TaskActionModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const { render, shown, portalTarget } = useOverlayLifecycle(open, onClose, EXIT_MS, dialogRef);
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<ActionKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Bumped on every close so a still-in-flight action can't mutate a reopened
  // instance (the modal is never unmounted, so its state would otherwise leak
  // across open/close cycles).
  const genRef = useRef(0);

  // Clear transient state whenever the modal closes, so a reopen starts fresh
  // (no stale error, no stuck "pending" disabled rows).
  useEffect(() => {
    if (!open) {
      genRef.current += 1;
      setError(null);
      setPendingKey(null);
    }
  }, [open]);

  if (!render || !portalTarget) return null;

  const onFortnight = currentLane === 'fortnight';

  const statusRow = (
    key: Extract<ActionKey, 'on_hold' | 'in_progress' | 'completed'>,
    label: string,
    icon: string,
    chip: string,
  ): Row => ({
    key,
    label,
    icon,
    chip,
    current: currentStatus === key,
    run: () => {
      const fd = new FormData();
      fd.set('taskId', taskId);
      fd.set('status', key);
      return updateTaskStatusAction(undefined, fd);
    },
  });

  const rows: Row[] = [
    ...(canSetFortnight
      ? [
          {
            key: 'fortnight' as const,
            label: onFortnight ? 'Remove from Fortnight' : 'Add to Fortnight lane',
            icon: onFortnight ? 'ti-bookmark-filled' : 'ti-bookmark',
            chip: 'bg-accent-soft text-accent',
            current: false,
            run: () => {
              const fd = new FormData();
              fd.set('taskId', taskId);
              fd.set('lane', onFortnight ? '' : 'fortnight');
              return setJsPriorityLaneAction(undefined, fd);
            },
          },
        ]
      : []),
    ...(canChangeStatus
      ? [
          statusRow('on_hold', 'On hold', 'ti-player-pause', 'bg-hold-soft text-hold'),
          statusRow('in_progress', 'In progress', 'ti-progress', 'bg-info-soft text-info'),
          statusRow('completed', 'Completed', 'ti-circle-check', 'bg-success-soft text-success'),
        ]
      : []),
  ];

  const fire = (row: Row) => {
    if (pendingKey || row.current) return;
    setError(null);
    setPendingKey(row.key);
    const myGen = genRef.current;
    startTransition(async () => {
      const result = await row.run();
      // The change is committed + revalidated server-side, so sync the list
      // even if the modal was dismissed while the action was in flight.
      if (result.ok) router.refresh();
      // Drop UI updates if the modal was closed (or reopened) since this fired.
      if (myGen !== genRef.current) return;
      if (result.ok) {
        onClose();
      } else {
        setError(result.error ?? 'Could not apply that. Try again.');
      }
      setPendingKey(null);
    });
  };

  const node = (
    <div className="md:hidden">
      {/* Dim overlay */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-[60] bg-black/40 transition-opacity duration-200',
          shown ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      />

      {/* Centered modal */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-actions-title"
        className={cn(
          'outline-none',
          'fixed z-[70] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
          'w-[calc(100vw-40px)] max-w-[320px] bg-panel rounded-2xl p-2',
          'shadow-[0_24px_60px_-12px_rgba(0,0,0,0.35)]',
          'transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none',
          shown
            ? 'opacity-100 scale-100 translate-x-[-50%] translate-y-[-50%]'
            : 'opacity-0 scale-95 translate-x-[-50%] translate-y-[-50%] pointer-events-none',
        )}
      >
        <h2 id="task-actions-title" className="sr-only">
          Task actions
        </h2>
        <p className="px-3 pt-2 pb-1 text-[12px] text-ink-3 truncate">{name}</p>

        <div className="flex flex-col">
          {rows.map((row) => {
            const busy = pendingKey === row.key;
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => (row.current ? onClose() : fire(row))}
                disabled={pendingKey !== null && !busy}
                aria-current={row.current ? 'true' : undefined}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors',
                  'active:scale-[0.99] motion-reduce:active:scale-100',
                  row.current ? 'cursor-default' : 'hover:bg-bg',
                  pendingKey !== null && !busy && 'opacity-50',
                )}
              >
                <span className={cn('w-8 h-8 grid place-items-center rounded-lg shrink-0', row.chip)}>
                  <i
                    className={cn('ti text-[16px]', busy ? 'ti-loader-2 animate-spin' : row.icon)}
                    aria-hidden="true"
                  />
                </span>
                <span className="flex-1 text-[13px] font-medium text-ink">{row.label}</span>
                {row.current ? (
                  <i className="ti ti-check text-[15px] text-ink-3" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>

        {error ? (
          <p role="alert" className="px-3 pt-1 pb-2 text-[12px] text-urgent">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="w-full mt-1 py-2.5 rounded-xl text-[13px] font-medium text-ink-2 hover:bg-line-2 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return createPortal(node, portalTarget);
}
