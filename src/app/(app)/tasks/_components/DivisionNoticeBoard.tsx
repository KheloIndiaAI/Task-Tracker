'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { updateDivisionNoticeAction } from '@/app/actions/divisions';
import {
  INITIAL_DIVISION_NOTICE_STATE,
  type UpdateDivisionNoticeState,
} from '@/app/actions/states';
import { countWords, MAX_DIVISION_NOTICE_WORDS } from '@/lib/format';
import { cn } from '@/lib/utils';

type DivisionNoticeBoardProps = {
  divisionId: string;
  notice: string | null;
  canEdit: boolean;
};

/**
 * A division-wide announcement, shown between the division name and its task
 * list on the grouped tasks list — the same text-window UX as a task's
 * Latest status (SectionLatestStatus): a light background panel, capped at
 * 50 words, an Edit/Add trigger for whoever may write to it. Edit rights are
 * a head power (canEditDivisionNotice) rather than a contribute right, since
 * this speaks for the division, not for one task.
 */
export function DivisionNoticeBoard({ divisionId, notice, canEdit }: DivisionNoticeBoardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notice ?? '');
  const [state, formAction] = useFormState<UpdateDivisionNoticeState, FormData>(
    updateDivisionNoticeAction,
    INITIAL_DIVISION_NOTICE_STATE,
  );

  useEffect(() => {
    if (state.ok) setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.epoch]);

  // Re-seed the draft from the saved value each time editing opens, so a
  // cancelled edit never leaks into the next one.
  useEffect(() => {
    if (editing) setDraft(notice ?? '');
  }, [editing, notice]);

  const wordCount = countWords(draft);
  const overLimit = wordCount > MAX_DIVISION_NOTICE_WORDS;

  return (
    <section aria-labelledby={`notice-board-${divisionId}`} className="mb-3">
      <div className="rounded-xl border border-info/30 bg-info-soft p-3.5">
        <div className="flex items-center justify-between mb-2">
          <h3 id={`notice-board-${divisionId}`} className="section-label">
            Notice board
          </h3>
          {canEdit && !editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[11px] font-medium text-primary inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-panel/60"
            >
              <i className="ti ti-edit text-[13px]" aria-hidden="true" />
              {notice ? 'Edit' : 'Add'}
            </button>
          ) : null}
        </div>

        {editing ? (
          <form action={formAction} className="flex flex-col gap-2">
            <input type="hidden" name="divisionId" value={divisionId} />
            <textarea
              name="noticeBoard"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Add a notice for this division…"
              className="w-full px-3 py-2.5 rounded-lg border border-info/30 bg-panel text-[13.5px] text-ink-2 leading-relaxed outline-none focus:border-info resize-none"
              maxLength={1000}
            />
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  'text-[11px] tabular-nums',
                  overLimit ? 'text-urgent font-medium' : 'text-ink-3',
                )}
              >
                {wordCount}/{MAX_DIVISION_NOTICE_WORDS} words
              </span>
              {state.fieldErrors?.noticeBoard ? (
                <span role="alert" className="text-[11px] text-urgent">
                  {state.fieldErrors.noticeBoard}
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
        ) : notice ? (
          <p className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap">{notice}</p>
        ) : (
          <p className="text-[12.5px] text-ink-3 italic">No notice posted yet.</p>
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
