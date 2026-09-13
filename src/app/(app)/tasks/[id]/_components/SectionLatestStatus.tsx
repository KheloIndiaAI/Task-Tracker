'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { updateTaskFieldsAction } from '@/app/actions/tasks';
import {
  INITIAL_FIELDS_STATE,
  type UpdateFieldsState,
} from '@/app/actions/states';
import { countWords, MAX_LATEST_STATUS_WORDS } from '@/lib/format';
import { cn } from '@/lib/utils';

type SectionLatestStatusProps = {
  taskId: string;
  latestStatus: string | null;
  canEdit: boolean;
};

/**
 * A short, always-visible status callout above Context — distinct from
 * Context (background/references, can run long) in that this is meant to be
 * read at a glance: a light green panel, capped at 50 words, for "where does
 * this stand right now". Same contribute-level edit right as Context and the
 * same generic updateTaskFieldsAction, so the two fields share one save path
 * and one activity trail.
 */
export function SectionLatestStatus({
  taskId,
  latestStatus,
  canEdit,
}: SectionLatestStatusProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latestStatus ?? '');
  const [state, formAction] = useFormState<UpdateFieldsState, FormData>(
    updateTaskFieldsAction,
    INITIAL_FIELDS_STATE,
  );

  useEffect(() => {
    if (state.ok) setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.epoch]);

  // Re-seed the draft from the saved value each time editing opens, so a
  // cancelled edit never leaks into the next one.
  useEffect(() => {
    if (editing) setDraft(latestStatus ?? '');
  }, [editing, latestStatus]);

  const wordCount = countWords(draft);
  const overLimit = wordCount > MAX_LATEST_STATUS_WORDS;

  return (
    <section
      aria-labelledby="sec-latest-status"
      className="px-4 md:px-6 py-5 border-b border-line-2"
    >
      <div className="rounded-xl border border-success/30 bg-success-soft p-4">
        <div className="flex items-center justify-between mb-2.5">
          <h2 id="sec-latest-status" className="section-label">
            Latest status
          </h2>
          {canEdit && !editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[11px] font-medium text-primary inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-panel/60"
            >
              <i className="ti ti-edit text-[13px]" aria-hidden="true" />
              {latestStatus ? 'Edit' : 'Add'}
            </button>
          ) : null}
        </div>

        {editing ? (
          <form action={formAction} className="flex flex-col gap-2">
            <input type="hidden" name="taskId" value={taskId} />
            <textarea
              name="latestStatus"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Add the latest status update…"
              className="w-full px-3 py-2.5 rounded-lg border border-success/30 bg-panel text-[14px] text-ink-2 leading-relaxed outline-none focus:border-success resize-none"
              maxLength={1000}
            />
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  'text-[11px] tabular-nums',
                  overLimit ? 'text-urgent font-medium' : 'text-ink-3',
                )}
              >
                {wordCount}/{MAX_LATEST_STATUS_WORDS} words
              </span>
              {state.fieldErrors?.latestStatus ? (
                <span role="alert" className="text-[11px] text-urgent">
                  {state.fieldErrors.latestStatus}
                </span>
              ) : null}
            </div>
            {state.error ? (
              <p role="alert" className="text-[12px] text-urgent">
                {state.error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 rounded-md border border-line text-[12px] font-medium text-ink-2 hover:bg-line-2"
              >
                Cancel
              </button>
              <SaveButton disabled={overLimit} />
            </div>
          </form>
        ) : latestStatus ? (
          <p className="text-[13.5px] text-ink leading-relaxed whitespace-pre-wrap">
            {latestStatus}
          </p>
        ) : (
          <p className="text-[13px] text-ink-3 italic">No status update yet.</p>
        )}
      </div>
    </section>
  );
}

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="px-3 py-1.5 rounded-md bg-ink text-onink text-[12px] font-medium disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}
