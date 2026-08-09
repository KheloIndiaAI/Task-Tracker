import Link from 'next/link';
import { redirect } from 'next/navigation';
import { format, formatDistanceToNow } from 'date-fns';

import { Avatar } from '@/components/ui';
import { auth, signOut } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { initialsOf } from '@/lib/format';
import {
  CONTRACT_ROLE_LABEL,
  HIERARCHY_SLOT_LABEL,
  HIERARCHY_SLOT_LEVEL,
  PMU_ROLE_LABEL,
} from '@/lib/labels';
import { isEligibleDelegate } from '@/lib/rbac';
import { cn } from '@/lib/utils';

import {
  DelegationManager,
  type DelegationRow,
  type HeadedDivisionOption,
} from './_components/DelegationManager';
import { PhoneEditor } from './_components/PhoneEditor';
import { WhatsappOptInToggle } from './_components/WhatsappOptInToggle';
import { WorkActivitiesEditor } from './_components/WorkActivitiesEditor';

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      division: true,
      subDivision: true,
      section: true,
      supervisor: { include: { division: true } },
    },
  });
  if (!me) redirect('/login');

  // ── Division access (RBAC): headships + live/upcoming delegations ──
  const now = new Date();
  const [headedDirect, delegationsGiven, delegationsReceived] = await Promise.all([
    prisma.division.findMany({
      where: { headUserId: me.id, kind: 'division' },
      select: { id: true, name: true },
      orderBy: { displayOrder: 'asc' },
    }),
    prisma.divisionAccessDelegation.findMany({
      where: { delegatedById: me.id, revokedAt: null, endsAt: { gte: now } },
      include: {
        division: { select: { name: true } },
        delegatedTo: { select: { name: true } },
      },
      orderBy: { startsAt: 'asc' },
    }),
    prisma.divisionAccessDelegation.findMany({
      where: { delegatedToId: me.id, revokedAt: null, endsAt: { gte: now } },
      include: {
        division: { select: { name: true } },
        delegatedBy: { select: { name: true } },
      },
      orderBy: { startsAt: 'asc' },
    }),
  ]);

  let headedDivisionOptions: HeadedDivisionOption[] = [];
  if (headedDirect.length > 0) {
    const [activeUsers, directHeadRows] = await Promise.all([
      prisma.user.findMany({
        where: { isActive: true, id: { not: me.id } },
        select: {
          id: true,
          name: true,
          designation: true,
          divisionId: true,
          division: { select: { name: true } },
          divisionAccess: { select: { divisionId: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.division.findMany({
        where: { headUserId: { not: null } },
        select: { id: true, headUserId: true },
      }),
    ]);
    const directHeadedByUser = new Map<string, string[]>();
    for (const d of directHeadRows) {
      if (!d.headUserId) continue;
      const list = directHeadedByUser.get(d.headUserId) ?? [];
      list.push(d.id);
      directHeadedByUser.set(d.headUserId, list);
    }
    headedDivisionOptions = headedDirect.map((division) => ({
      id: division.id,
      name: division.name,
      targets: activeUsers
        .filter((u) =>
          isEligibleDelegate(
            {
              id: u.id,
              isActive: true,
              memberDivisionIds: [u.divisionId, ...u.divisionAccess.map((a) => a.divisionId)],
              directHeadedDivisionIds: directHeadedByUser.get(u.id) ?? [],
            },
            {
              divisionId: division.id,
              delegatorId: me.id,
              delegatorHomeDivisionId: me.divisionId,
            },
          ),
        )
        .map((u) => ({
          id: u.id,
          name: u.name,
          designation: u.designation,
          divisionName: u.division.name,
          badge: (directHeadedByUser.get(u.id) ?? []).length > 0 ? 'Division head' : null,
        })),
    }));
  }

  const windowLabelOf = (startsAt: Date, endsAt: Date) =>
    `${format(startsAt, 'd LLL yyyy')} – ${format(endsAt, 'd LLL yyyy')}`;

  const givenRows: DelegationRow[] = delegationsGiven.map((d) => ({
    id: d.id,
    divisionName: d.division.name,
    personName: d.delegatedTo.name,
    windowLabel: windowLabelOf(d.startsAt, d.endsAt),
    upcoming: d.startsAt.getTime() > now.getTime(),
    canRevoke: true,
  }));
  const receivedRows: DelegationRow[] = delegationsReceived.map((d) => ({
    id: d.id,
    divisionName: d.division.name,
    personName: d.delegatedBy.name,
    windowLabel: windowLabelOf(d.startsAt, d.endsAt),
    upcoming: d.startsAt.getTime() > now.getTime(),
    canRevoke: false,
  }));

  return (
    <div className="max-w-2xl mx-auto pb-16 px-4 md:px-6 lg:px-8">
      {/* Page header */}
      <div className="pt-4 md:pt-6 pb-4 md:pb-5">
        <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-1">
          Account
        </p>
        <h1 className="font-serif text-[22px] md:text-[26px] leading-tight text-ink">
          Profile
        </h1>
      </div>

      {/* Identity card */}
      <section className="bg-panel border border-line rounded-2xl p-5 md:p-6 flex items-center gap-4 md:gap-5">
        <Avatar
          initials={initialsOf(me.name)}
          colour={me.division.avatarColour}
          size="lg"
          ariaLabel={me.name}
        />
        <div className="min-w-0">
          <h2 className="font-serif text-[20px] md:text-[22px] leading-tight text-ink truncate">
            {me.name}
          </h2>
          <p className="text-[12px] md:text-[13px] text-ink-2 mt-0.5 truncate">
            {me.designation}
          </p>
          {me.isSuperAdmin ? (
            <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.08em] text-primary bg-primary-soft border border-primary-line/40 px-1.5 py-0.5 rounded">
              <i className="ti ti-shield-check text-[11px]" aria-hidden="true" />
              Super Admin
            </span>
          ) : null}
        </div>
      </section>

      {/* Details */}
      <section className="mt-4 bg-panel border border-line rounded-2xl">
        <h3 className="px-5 md:px-6 pt-5 pb-2 section-label">Profile</h3>
        <dl className="px-2 pb-2">
          <DetailRow icon="ti-id" label="Hierarchy slot">
            <span>{HIERARCHY_SLOT_LABEL[me.hierarchySlot]}</span>
            {HIERARCHY_SLOT_LEVEL[me.hierarchySlot] != null ? (
              <span className="ml-2 inline-flex text-[10px] font-medium text-primary bg-primary-soft border border-primary-line/40 px-1.5 py-0.5 rounded">
                Level {HIERARCHY_SLOT_LEVEL[me.hierarchySlot]}
              </span>
            ) : (
              <span className="ml-2 inline-flex text-[10px] font-medium text-ink-3 bg-line-2 border border-line px-1.5 py-0.5 rounded">
                Support role
              </span>
            )}
          </DetailRow>

          {me.contractRole ? (
            <DetailRow icon="ti-bookmark" label="Contract role">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent bg-accent-soft border border-accent-line px-2 py-0.5 rounded-md">
                {CONTRACT_ROLE_LABEL[me.contractRole]}
              </span>
            </DetailRow>
          ) : null}

          {me.isPmu && me.pmuRole ? (
            <DetailRow icon="ti-building-bridge" label="PMU role">
              <span>{PMU_ROLE_LABEL[me.pmuRole]}</span>
            </DetailRow>
          ) : null}

          <DetailRow icon="ti-building" label="Division">
            <span className="inline-flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: me.division.avatarColour }}
                aria-hidden="true"
              />
              {me.division.name}
            </span>
          </DetailRow>

          {me.subDivision ? (
            <DetailRow icon="ti-arrow-right" label="Sub-division">
              <span>{me.subDivision.name}</span>
            </DetailRow>
          ) : null}

          {me.section ? (
            <DetailRow icon="ti-arrow-right" label="Section">
              <span>{me.section.name}</span>
            </DetailRow>
          ) : null}

          <DetailRow icon="ti-user" label="Username">
            <span className="font-mono text-[12px]">{me.username}</span>
          </DetailRow>

          {me.email ? (
            <DetailRow icon="ti-mail" label="Email" muted>
              <span>{me.email}</span>
            </DetailRow>
          ) : null}

          <DetailRow icon="ti-phone" label="Phone" muted>
            <PhoneEditor phone={me.phone} />
          </DetailRow>

          <DetailRow icon="ti-brand-whatsapp" label="WhatsApp alerts" muted>
            <WhatsappOptInToggle enabled={me.whatsappOptIn} hasPhone={!!me.phone} />
          </DetailRow>

          {me.supervisor ? (
            <DetailRow icon="ti-arrow-up" label="Reports to">
              <span className="inline-flex items-center gap-2">
                <Avatar
                  initials={initialsOf(me.supervisor.name)}
                  colour={me.supervisor.division.avatarColour}
                  size="xs"
                  ariaLabel={me.supervisor.name}
                />
                {me.supervisor.name}
              </span>
            </DetailRow>
          ) : null}

          <DetailRow icon="ti-login" label="Last sign-in" muted>
            <span>
              {me.lastLogin ? (
                <>
                  {format(me.lastLogin, 'd LLL yyyy, h:mm a')}{' '}
                  <span className="text-ink-3 text-[11px]">
                    ({formatDistanceToNow(me.lastLogin, { addSuffix: true })})
                  </span>
                </>
              ) : (
                'No previous sign-in recorded'
              )}
            </span>
          </DetailRow>
        </dl>
      </section>

      {/* Work activities — self-editable */}
      <WorkActivitiesEditor workActivities={me.workActivities} />

      {/* Division access — delegation for division heads */}
      <DelegationManager
        headedDivisions={headedDivisionOptions}
        given={givenRows}
        received={receivedRows}
      />

      {/* Actions */}
      <section className="mt-4 bg-panel border border-line rounded-2xl p-2">
        <Link
          href="/profile/change-password"
          className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-bg transition-colors"
        >
          <span className="w-9 h-9 grid place-items-center rounded-lg bg-bg">
            <i className="ti ti-lock-cog text-[18px] text-ink-2" aria-hidden="true" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[14px] font-medium text-ink">
              Change password
            </span>
            <span className="block text-[12px] text-ink-3 mt-0.5">
              Pick a new password. You will be signed out if the change was required by Super Admin.
            </span>
          </span>
          <i className="ti ti-chevron-right text-[16px] text-ink-4" aria-hidden="true" />
        </Link>

        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/login' });
          }}
        >
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-bg transition-colors text-left"
          >
            <span className="w-9 h-9 grid place-items-center rounded-lg bg-bg">
              <i className="ti ti-logout text-[18px] text-ink-2" aria-hidden="true" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-medium text-ink">Sign out</span>
              <span className="block text-[12px] text-ink-3 mt-0.5">
                Ends your current session.
              </span>
            </span>
            <i className="ti ti-chevron-right text-[16px] text-ink-4" aria-hidden="true" />
          </button>
        </form>
      </section>

      <p className="mt-4 text-[11px] text-ink-3 leading-relaxed">
        Your phone number and work activities are yours to edit. Other profile
        details (name, designation, division, hierarchy slot) are managed by
        your Super Admin — ask the Super Admin to change them.
      </p>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  muted,
  children,
}: {
  icon: string;
  label: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <i
        className={cn('ti', icon, 'text-[16px] text-ink-3 shrink-0 w-[18px]')}
        aria-hidden="true"
      />
      <dt className="text-[13px] text-ink-2 w-[130px] shrink-0">{label}</dt>
      <dd className={cn('flex-1 text-[13px] text-right font-medium', muted && 'text-ink-2 font-normal')}>
        {children}
      </dd>
    </div>
  );
}
