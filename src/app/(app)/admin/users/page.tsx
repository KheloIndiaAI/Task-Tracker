import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { orderUsersByDivision } from '@/lib/admin-users-order';
import { cn } from '@/lib/utils';

import { CreateUserDialog } from './_components/CreateUserDialog';
import { UsersList, type UserRow } from './_components/UsersList';

type Filter = 'all' | 'active' | 'disabled' | 'super_admin';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'disabled', label: 'Disabled' },
  { id: 'super_admin', label: 'Super Admin' },
];

/** List ordering: 'default' (active first, then name) or 'division'. */
type Sort = 'default' | 'division';

const SORTS: { id: Sort; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'division', label: 'By division' },
];

type PageProps = { searchParams?: { filter?: string; sort?: string } };

/** Build a users-list URL, omitting params left at their default. */
function buildHref(params: { filter: Filter; sort: Sort }): string {
  const sp = new URLSearchParams();
  if (params.filter !== 'all') sp.set('filter', params.filter);
  if (params.sort !== 'default') sp.set('sort', params.sort);
  const qs = sp.toString();
  return qs ? `/admin/users?${qs}` : '/admin/users';
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const filter: Filter = ((): Filter => {
    const v = searchParams?.filter;
    if (v === 'active' || v === 'disabled' || v === 'super_admin') return v;
    return 'all';
  })();

  const sort: Sort = searchParams?.sort === 'division' ? 'division' : 'default';

  const whereFilter =
    filter === 'active'
      ? { isActive: true }
      : filter === 'disabled'
        ? { isActive: false }
        : filter === 'super_admin'
          ? { isSuperAdmin: true }
          : {};

  const [users, divisionsRaw] = await Promise.all([
    prisma.user.findMany({
      where: whereFilter,
      include: {
        division: true,
        subDivision: true,
        divisionAccess: { select: { divisionId: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    }),
    prisma.division.findMany({
      orderBy: [{ kind: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
    }),
  ]);

  const totalCount = await prisma.user.count();
  const activeCount = await prisma.user.count({ where: { isActive: true } });
  const superAdminCount = await prisma.user.count({ where: { isSuperAdmin: true } });

  const divisions = divisionsRaw.map((d) => ({
    id: d.id,
    name: d.name,
    parentId: d.parentId,
    pmuParentDivisionId: d.pmuParentDivisionId,
    kind: d.kind as 'division' | 'sub_division' | 'section' | 'pmu',
  }));

  const supervisors = users
    .filter((u) => u.isActive)
    .map((u) => ({ id: u.id, name: u.name, designation: u.designation }));

  // "By division" reorders the rows only — the supervisor picker above keeps
  // its alphabetical order. divisionsRaw carries kind / parent / PMU-parent /
  // display order needed to resolve each user's top-level division and tier.
  const orderedUsers =
    sort === 'division'
      ? orderUsersByDivision(
          users,
          divisionsRaw.map((d) => ({
            id: d.id,
            name: d.name,
            kind: d.kind as 'division' | 'sub_division' | 'section' | 'pmu',
            parentId: d.parentId,
            pmuParentDivisionId: d.pmuParentDivisionId,
            displayOrder: d.displayOrder,
          })),
        )
      : users;

  const rows: UserRow[] = orderedUsers.map((u) => ({
    id: u.id,
    name: u.name,
    username: u.username,
    designation: u.designation,
    hierarchySlot: u.hierarchySlot,
    contractRole: u.contractRole,
    divisionId: u.divisionId,
    divisionName: u.division.name,
    divisionColour: u.division.avatarColour,
    subDivisionId: u.subDivisionId,
    subDivisionName: u.subDivision?.name ?? null,
    sectionId: u.sectionId,
    pmuId: u.pmuId,
    extraDivisionIds: u.divisionAccess.map((a) => a.divisionId),
    supervisorId: u.supervisorId,
    isActive: u.isActive,
    isSuperAdmin: u.isSuperAdmin,
    canAccessDocumentCentre: u.canAccessDocumentCentre,
    lastLogin: u.lastLogin,
  }));

  return (
    <div className="max-w-6xl mx-auto">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h2 className="font-serif text-[22px] md:text-[26px] leading-tight text-ink">
            Users
          </h2>
          <p className="text-[12px] text-ink-3 mt-1">
            {totalCount} total · {activeCount} active · {superAdminCount}{' '}
            Super Admin{superAdminCount === 1 ? '' : 's'}
          </p>
        </div>
        <CreateUserDialog divisions={divisions} supervisors={supervisors} />
      </div>

      {/* Filter chips */}
      <nav
        aria-label="Filter users"
        className="flex gap-1.5 flex-wrap mb-4"
      >
        {FILTERS.map((f) => {
          const active = f.id === filter;
          const href = buildHref({ filter: f.id, sort });
          return (
            <Link
              key={f.id}
              href={href}
              scroll={false}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'whitespace-nowrap px-3 py-1.5 rounded-[14px] text-[12px] font-medium border transition-colors',
                active
                  ? 'bg-ink text-onink border-ink'
                  : 'bg-panel text-ink-2 border-line hover:border-ink-4',
              )}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {/* Sort control */}
      <div
        className="flex items-center gap-1.5 flex-wrap mb-4"
        role="group"
        aria-label="Sort users"
      >
        <span className="text-[11px] font-medium text-ink-3">Sort</span>
        {SORTS.map((s) => {
          const active = s.id === sort;
          return (
            <Link
              key={s.id}
              href={buildHref({ filter, sort: s.id })}
              scroll={false}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'whitespace-nowrap px-3 py-1.5 rounded-[14px] text-[12px] font-medium border transition-colors',
                active
                  ? 'bg-ink text-onink border-ink'
                  : 'bg-panel text-ink-2 border-line hover:border-ink-4',
              )}
            >
              {s.label}
            </Link>
          );
        })}
      </div>

      <UsersList
        users={rows}
        divisions={divisions}
        supervisors={supervisors}
        selfId={session.user.id}
      />

      {/* Phase-1 footnote — sub-divisions & sections via Structure & hierarchy (Turn F) */}
      <p className="mt-4 text-[11px] text-ink-3 leading-relaxed">
        Sub-divisions, sections, and PMU teams come with the Structure &amp; hierarchy
        sub-section. Until then, every new user joins the existing divisions.
      </p>
    </div>
  );
}
