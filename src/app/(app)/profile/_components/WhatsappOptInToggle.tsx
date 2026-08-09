'use client';

import { useState, useTransition } from 'react';

import { setWhatsappOptInAction } from '@/app/actions/profile';

type Props = {
  enabled: boolean;
  hasPhone: boolean;
};

/**
 * Opt-out toggle for WhatsApp notifications, rendered as the value of the
 * "WhatsApp alerts" row on /profile. Opt-in is ON by default; this lets a user
 * turn it off. Disabled (with a hint) until a phone number is on file.
 */
export function WhatsappOptInToggle({ enabled, hasPhone }: Props) {
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!hasPhone) {
    return <span className="text-ink-3 italic font-normal">Add a phone number first</span>;
  }

  function toggle() {
    const next = !on;
    setOn(next); // optimistic
    setError(null);
    startTransition(async () => {
      const res = await setWhatsappOptInAction(next);
      if (!res.ok) {
        setOn(!next); // revert
        setError(res.error ?? 'Could not save');
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="WhatsApp notifications"
        disabled={pending}
        onClick={toggle}
        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
        style={{ backgroundColor: on ? 'var(--ink)' : 'var(--line)' }}
      >
        <span
          className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
          style={{ transform: on ? 'translateX(18px)' : 'translateX(2px)' }}
        />
      </button>
      {error ? (
        <span role="alert" className="text-[11px] text-urgent font-normal">
          {error}
        </span>
      ) : null}
    </span>
  );
}
