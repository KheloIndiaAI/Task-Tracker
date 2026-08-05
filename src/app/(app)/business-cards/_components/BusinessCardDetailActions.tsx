'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState, useFormStatus } from 'react-dom';

import { deleteBusinessCardAction } from '@/app/actions/business-cards';
import { INITIAL_BUSINESS_CARD_STATE } from '@/app/actions/states';

/** Two-step delete: click reveals a Yes/No confirm, then hard-deletes + returns to the list. */
export function DeleteBusinessCardButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useFormState(deleteBusinessCardAction, INITIAL_BUSINESS_CARD_STATE);

  useEffect(() => {
    if (state.ok) router.push('/business-cards');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.epoch]);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line bg-panel text-[13px] font-medium text-urgent hover:bg-urgent-soft hover:border-urgent/30 transition-colors"
      >
        <i className="ti ti-trash text-[14px]" aria-hidden="true" />
        Delete
      </button>
    );
  }

  return (
    <form action={formAction} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <span className="text-[11px] text-ink-2 hidden sm:inline">Delete {name}?</span>
      <ConfirmButton />
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="px-2.5 py-2 rounded-lg border border-line bg-panel text-[12px] font-medium text-ink-2 hover:bg-line-2"
      >
        No
      </button>
      {state.error ? <span className="text-[11px] text-urgent">{state.error}</span> : null}
    </form>
  );
}

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-2.5 py-2 rounded-lg bg-urgent text-white text-[12px] font-medium hover:bg-urgent/90 disabled:opacity-60"
    >
      {pending ? 'Deleting…' : 'Yes, delete'}
    </button>
  );
}
