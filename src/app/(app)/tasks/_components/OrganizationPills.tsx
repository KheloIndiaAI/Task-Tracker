import Link from 'next/link';

import { ALL_ORGANIZATIONS, ALL_ORGANIZATIONS_LABEL } from '@/lib/organization-scope-shared';
import { cn } from '@/lib/utils';

/**
 * The same pill shape as TaskScopeControls' row just above, so the two rows
 * read as one control set. Repeated rather than imported: that file is a
 * client module, and a Server Component importing a plain value from one gets
 * a client reference, not the string.
 */
const PILL =
  'inline-flex items-center gap-1.5 whitespace-nowrap snap-start px-3 py-[5px] rounded-[14px] text-[12px] font-medium border transition-colors';
const PILL_ACTIVE = 'bg-ink text-onink border-ink';
const PILL_IDLE = 'bg-panel text-ink-2 border-line hover:border-ink-4';

type OrganizationPillsProps = {
  /** Organizations holding at least one division or PMU team, in tree order. */
  organizations: { id: string; name: string }[];
  /** The organization the board is showing; `null` for every organization. */
  selectedId: string | null;
  /**
   * The page's other params, carried over unchanged — `filter`, `sort`,
   * `group` — so switching organization keeps My tasks and the rest as they
   * were. `division` is deliberately not among them: a division narrowed in
   * one organization means nothing in another.
   */
  carry: Record<string, string>;
};

/**
 * The Super Admin's organization pills, under All tasks / My tasks on the
 * tasks board. Server-rendered links writing `?org=` — no client JS — like the
 * Document Centre's filter chips: one row that scrolls sideways on a phone and
 * wraps from tablet up.
 *
 * "All organizations" comes first, the way "All" leads every pill row here; it
 * is the board exactly as it was before this row existed. The default — no
 * `?org=` — is Ministry Headquarter (see organization-scope-shared.ts), so
 * that pill is lit on arrival.
 */
export function OrganizationPills({ organizations, selectedId, carry }: OrganizationPillsProps) {
  const options = [
    { value: ALL_ORGANIZATIONS, label: ALL_ORGANIZATIONS_LABEL, active: selectedId === null },
    ...organizations.map((o) => ({ value: o.id, label: o.name, active: o.id === selectedId })),
  ];

  return (
    <nav
      aria-label="Organization"
      className="flex justify-start gap-2 overflow-x-auto md:overflow-visible md:flex-wrap snap-x snap-proximity [&::-webkit-scrollbar]:hidden -mx-1 px-1 py-1"
    >
      {options.map((o) => {
        const query = new URLSearchParams(carry);
        query.set('org', o.value);
        return (
          <Link
            key={o.value}
            href={`/tasks?${query.toString()}`}
            scroll={false}
            aria-current={o.active ? 'page' : undefined}
            className={cn(PILL, o.active ? PILL_ACTIVE : PILL_IDLE)}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
