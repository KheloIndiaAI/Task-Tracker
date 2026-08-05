import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import {
  canAccessBusinessCardsById,
  fetchBusinessCardEvents,
  fetchBusinessCards,
} from '@/lib/business-cards';
import { isS3Configured } from '@/lib/s3';

import { BusinessCardsBrowser } from './_components/BusinessCardsBrowser';

export default async function BusinessCardsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  // Access-gated. Unauthorized users never reach the module UI (the nav item is
  // also hidden); the actions + upload API re-check this server-side.
  if (!(await canAccessBusinessCardsById(session.user.id))) redirect('/tasks');

  const [cards, events] = await Promise.all([
    fetchBusinessCards(),
    fetchBusinessCardEvents(),
  ]);

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 lg:px-8 pt-4 md:pt-6 pb-24 md:pb-10">
      <header className="mb-5">
        <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-1 inline-flex items-center gap-1">
          <i className="ti ti-address-book text-[11px] text-primary" aria-hidden="true" />
          Contacts
        </p>
        <h1 className="font-serif text-[22px] md:text-[28px] leading-tight text-ink">
          Business Cards
        </h1>
        <p className="mt-1.5 text-[12px] text-ink-2 max-w-2xl leading-relaxed">
          Contacts collected at events and meetings — searchable across every field and
          groupable by event.
        </p>
      </header>

      <BusinessCardsBrowser cards={cards} events={events} s3Configured={isS3Configured()} />
    </div>
  );
}
