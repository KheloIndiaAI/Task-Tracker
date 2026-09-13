'use client';

import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { updateTaskJsCommentAction } from '@/app/actions/tasks';
import {
  INITIAL_JS_COMMENT_STATE,
  type UpdateJsCommentState,
} from '@/app/actions/states';

type SectionJsCommentProps = {
  taskId: string;
  jsComment: string | null;
  canEdit: boolean;
};

/**
 * JS-office commentary on the task — a light orange panel above Latest
 * status. Same field and action as the board's own "JS Comment :" line
 * (DivisionLaneBoard.tsx) so the two surfaces can never disagree; only the
 * edit right is unrelated to Latest status's contributor rule — Super Admin
 * or the can_add_js_comment grant only (see updateTaskJsCommentAction).
 * Visible to everyone who can view the task; the Add/Edit control is the
 * only thing `canEdit` gates.
 */
export function SectionJsComment({ taskId, jsComment, canEdit }: SectionJsCommentProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(jsComment ?? '');
  const [state, formAction] = useFormState<UpdateJsCommentState, FormData>(
    updateTaskJsCommentAction,
    INITIAL_JS_COMMENT_STATE,
  );

  useEffect(() => {
    if (state.ok) setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.epoch]);

  useEffect(() => {
    if (editing) setDraft(jsComment ?? '');
  }, [editing, jsComment]);

  return (
    <section
      aria-labelledby="sec-js-comment"
      className="px-4 md:px-6 py-5 border-b border-line-2"
    >
      <div className="rounded-xl border border-high/30 bg-high-soft p-4">
        <div className="flex items-center justify-between mb-2.5">
          <h2 id="sec-js-comment" className="section-label">
            JS Comment
          </h2>
          {canEdit && !editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[11px] font-medium text-primary inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-panel/60"
            >
              <i className="ti ti-edit text-[13px]" aria-hidden="true" />
              {jsComment ? 'Edit' : 'Add'}
            </button>
          ) : null}
        </div>

        {editing ? (
          <form action={formAction} className="flex flex-col gap-2">
            <input type="hidden" name="taskId" value={taskId} />
            <textarea
              name="jsComment"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Add a JS Comment…"
              className="w-full px-3 py-2.5 rounded-lg border border-high/30 bg-panel text-[14px] text-ink-2 leading-relaxed outline-none focus:border-high resize-none"
              maxLength={1000}
            />
            <div className="flex items-center justify-between gap-2">
              {state.fieldErrors?.jsComment ? (
                <span role="alert" className="text-[11px] text-urgent">
                  {state.fieldErrors.jsComment}
                </span>
              ) : (
                <span />
              )}
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
              <SaveButton />
            </div>
          </form>
        ) : jsComment ? (
          <p className="text-[13.5px] text-ink leading-relaxed whitespace-pre-wrap">
            {jsComment}
          </p>
        ) : (
          <p className="text-[13px] text-ink-3 italic">No JS Comment yet.</p>
        )}
      </div>
    </section>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-3 py-1.5 rounded-md bg-ink text-onink text-[12px] font-medium disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}
