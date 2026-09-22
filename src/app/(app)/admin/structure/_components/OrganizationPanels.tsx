import Link from 'next/link';

import { STRUCTURE_KIND_LABEL, type StructureKind } from '@/lib/structure-shared';

type Person = { id: string; name: string; designation: string };

/** Someone holding a live delegation of the organization. */
type ActingHead = Person & {
  /** Human date the delegation window closes, e.g. "5 Aug 2026". */
  until: string;
};

/**
 * Who heads an organization — read-only, because organization heads are not a
 * single `head_user_id` like a division's. They are:
 *
 *   - every Super Admin, by role, over every organization; and
 *   - anyone carrying the "Organization head" toggle (Super Admin -> Users)
 *     whose home division sits in this organization.
 *
 * Both get full head powers cascading to every directorate and division
 * beneath (see expandHeadedToDescendants). Changing the second list is done
 * where the toggle lives, so this card points there rather than duplicating
 * the control.
 */
export function OrganizationHeadsCard({
  superAdmins,
  heads,
  activeDelegates = [],
}: {
  superAdmins: Person[];
  heads: Person[];
  /** Live delegations of this organization — acting heads for the window. */
  activeDelegates?: ActingHead[];
}) {
  return (
    <div className="mb-4 bg-panel border border-line rounded-xl px-4 py-3">
      <div className="flex items-start gap-3">
        <i className="ti ti-crown text-[16px] text-primary shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-ink-3">Organization heads</p>
          <ul className="mt-1 flex flex-col gap-1">
            {heads.map((p) => (
              <li key={p.id} className="text-[13px] font-medium text-ink truncate">
                {p.name}
                <span className="ml-1.5 font-normal text-ink-3">{p.designation}</span>
              </li>
            ))}
            {activeDelegates.map((p) => (
              <li key={`acting-${p.id}`} className="text-[13px] font-medium text-ink truncate">
                <i
                  className="ti ti-user-check mr-1.5 align-[-2px] text-[14px] text-primary"
                  aria-hidden="true"
                />
                {p.name}
                <span className="ml-1.5 font-normal text-ink-3">acting head until {p.until}</span>
              </li>
            ))}
            <li className="text-[12px] text-ink-2">
              {superAdmins.length === 0
                ? 'Super Admins head every organization.'
                : `Super Admins (${superAdmins.map((s) => s.name).join(', ')}) head every organization.`}
            </li>
          </ul>
          <p className="mt-2 text-[11px] text-ink-3 leading-relaxed">
            To add or remove a head, open the person in{' '}
            <Link href="/admin/users" className="text-primary hover:underline">
              Users
            </Link>{' '}
            and switch Organization head. It applies to the organization their home division
            sits in.
          </p>
        </div>
      </div>
    </div>
  );
}

export type StructureUnit = {
  id: string;
  name: string;
  kind: StructureKind;
  /** People in this unit, rolled up through everything beneath it. */
  userCount: number;
};

/**
 * What an organization or a directorate contains — shown in place of the
 * reporting-hierarchy chart, which is a per-division tool: people are homed in
 * divisions, never directly in an organization or directorate, so the chart
 * would always be empty here.
 */
export function StructureUnitsPanel({
  name,
  kind,
  parentBreadcrumb,
  units,
  divisionCount,
  peopleCount,
}: {
  name: string;
  kind: StructureKind;
  parentBreadcrumb: string | null;
  units: StructureUnit[];
  divisionCount: number;
  peopleCount: number;
}) {
  return (
    <div className="bg-panel border border-line rounded-xl p-4 md:p-5">
      <div className="mb-4">
        {parentBreadcrumb ? (
          <p className="text-[10px] uppercase tracking-[0.06em] font-medium text-ink-3 mb-1">
            {parentBreadcrumb}
          </p>
        ) : null}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="font-serif text-[20px] md:text-[22px] text-ink leading-tight">
            {name} · {STRUCTURE_KIND_LABEL[kind].toLowerCase()}
          </h3>
          <span className="text-[11px] text-ink-3">
            {divisionCount} {divisionCount === 1 ? 'division' : 'divisions'} · {peopleCount}{' '}
            {peopleCount === 1 ? 'person' : 'people'}
          </span>
        </div>
      </div>

      {units.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12px] text-ink-3 italic">
          Nothing here yet. Use the row menu in the tree to add{' '}
          {kind === 'organization' ? 'a directorate or a division' : 'a division'}.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {units.map((u) => (
            <li key={u.id}>
              <Link
                href={`/admin/structure?division=${u.id}`}
                scroll={false}
                className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5 transition-colors hover:border-ink-4 hover:bg-bg"
              >
                <i
                  className={`ti ${u.kind === 'directorate' ? 'ti-sitemap' : 'ti-building'} text-[15px] text-ink-3 shrink-0`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{u.name}</span>
                <span className="shrink-0 text-[11px] text-ink-3">{STRUCTURE_KIND_LABEL[u.kind]}</span>
                <span className="shrink-0 rounded-md bg-line-2 px-1.5 py-0.5 text-[10px] tabular-nums text-ink-3">
                  {u.userCount}
                </span>
                <i className="ti ti-chevron-right text-[13px] text-ink-4 shrink-0" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
