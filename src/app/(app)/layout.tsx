import { redirect } from 'next/navigation';

import { AppShell, type BellNotification } from '@/components/layout';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getOfficeOfJsDivisionId } from '@/lib/engagements';
import { initialsOf } from '@/lib/format';
import { buildNotificationTaskContext } from '@/lib/notification-context';
import { canAccessDocumentCentre as canAccessDocumentCentreShared } from '@/lib/document-centre-shared';
import { canAccessBusinessCards as canAccessBusinessCardsShared } from '@/lib/business-cards-shared';
import { canAccessTimelineFiles } from '@/lib/timeline-files-access';
import { getHeadedDivisionIds, getMemberDivisionIds } from '@/lib/rbac';
import { getPmusByParentDivision } from '@/lib/visibility';
import { groupByPlacement } from '@/lib/structure-shared';
import { isS3Configured } from '@/lib/s3';

import {
  QuickCreateFab,
  QuickCreateProvider,
  type TargetOrganization,
} from './tasks/_components/QuickCreate';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const [me, unreadCount, recentRaw, headedDivisionIds, officeOfJsDivisionId, memberDivisionIds] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: session.user.id },
        include: { division: true },
      }),
      prisma.notification.count({
        where: { userId: session.user.id, readAt: null },
      }),
      prisma.notification.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          type: true,
          payload: true,
          readAt: true,
          createdAt: true,
        },
      }),
      getHeadedDivisionIds(session.user.id),
      getOfficeOfJsDivisionId(),
      getMemberDivisionIds(session.user.id),
    ]);
  if (!me) redirect('/login');

  // Boards the caller may put a task on. Creating a task is no longer a head
  // power (the personal/division split was removed on 2026-09-17) — everyone
  // creates on a board they belong to, and the whole board reads it. Super
  // Admin / OSD reach everything; a head reaches the divisions they head plus
  // those divisions' PMUs; everyone else reaches their member divisions.
  //
  // A PMU member is the exception: their home division is the PARENT division,
  // whose board PMU isolation walls off from them — a task they created there
  // would vanish from their own list. So they target their PMU instead, which
  // is where their team actually reads. Mirrored by the server's create gate.
  const isPmuMember = me.isPmu && me.pmuId !== null;
  const ownTargetIds = isPmuMember
    ? [me.pmuId as string, ...headedDivisionIds]
    : [...memberDivisionIds, ...headedDivisionIds];

  const createTargetsRaw = await prisma.division.findMany({
        where:
          me.isSuperAdmin || me.hierarchySlot === 'osd'
            ? { kind: { in: ['division', 'pmu'] } }
            : {
                // Only divisions and PMUs carry tasks. Without this, an
                // organization or directorate head would be offered the
                // organization row itself — their headed ids include it, since
                // heading it is what cascades to the divisions beneath.
                kind: { in: ['division', 'pmu'] },
                OR: [
                  { id: { in: ownTargetIds } },
                  { kind: 'pmu', pmuParentDivisionId: { in: headedDivisionIds } },
                ],
              },
        orderBy: [{ kind: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          kind: true,
          headUserId: true,
          // Sub-divisions of this division (a task may be tagged with one).
          // PMUs have none, so this is naturally empty for them.
          children: {
            where: { kind: 'sub_division' },
            orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
            select: { id: true, name: true },
          },
        },
      });

  // The optional-owner pool for Quick Create: active members of those targets
  // (a division's members have divisionId === target; a PMU's have pmuId ===
  // target). Office-of-JS tasks may be owned by anyone, so if that division is
  // a target the pool is the whole active directory instead. pmuRole /
  // hierarchySlot ride along so we can pick out each target's default owner
  // (head or PMU team leader) and the OSD account without another query.
  const divisionTargetIds = createTargetsRaw.filter((t) => t.kind !== 'pmu').map((t) => t.id);
  const pmuTargetIds = createTargetsRaw.filter((t) => t.kind === 'pmu').map((t) => t.id);
  const canTargetOfficeOfJs =
    officeOfJsDivisionId !== null &&
    createTargetsRaw.some((t) => t.id === officeOfJsDivisionId);

  const candidatesRaw =
    createTargetsRaw.length > 0
      ? await prisma.user.findMany({
          where: {
            isActive: true,
            ...(canTargetOfficeOfJs
              ? {}
              : {
                  OR: [
                    { divisionId: { in: divisionTargetIds } },
                    { pmuId: { in: pmuTargetIds } },
                    // Admin-granted extra members of a target division are
                    // assignable owners there too.
                    { divisionAccess: { some: { divisionId: { in: divisionTargetIds } } } },
                  ],
                }),
          },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            designation: true,
            divisionId: true,
            pmuId: true,
            pmuRole: true,
            hierarchySlot: true,
            division: { select: { name: true, avatarColour: true } },
            divisionAccess: { select: { divisionId: true } },
          },
        })
      : [];

  const ownerCandidates = candidatesRaw.map((u) => ({
    id: u.id,
    name: u.name,
    designation: u.designation,
    divisionId: u.divisionId,
    pmuId: u.pmuId,
    // The target divisions this user may own tasks in — home + admin-granted
    // extras — so the Quick Create owner picker matches multi-division members.
    memberDivisionIds: [u.divisionId, ...u.divisionAccess.map((a) => a.divisionId)],
    divisionName: u.division.name,
    divisionColour: u.division.avatarColour,
  }));

  // Each target's default owner — the division head, or a PMU's team leader —
  // surfaced as a one-click pill in Quick Create. Derived from the pool above,
  // so no extra query; absent (null) when that person is inactive or unset.
  const candidateById = new Map(candidatesRaw.map((u) => [u.id, u]));
  // PMUs hanging off each division target — the "Show this task to PMU team"
  // switch in Quick Create appears only for a division that has one. Resolved
  // by the shared helper so `pmu_parent_division_id` and the `parent_id`
  // fallback are honoured the same way everywhere else honours them.
  const [pmusByDivision, structureNodes] = await Promise.all([
    getPmusByParentDivision(divisionTargetIds),
    // The whole tree (small: tens to hundreds of rows) — where each target sits,
    // so Quick Create can ask Organization, then Directorate, then Division.
    createTargetsRaw.length > 0
      ? prisma.division.findMany({
          select: { id: true, name: true, kind: true, parentId: true, pmuParentDivisionId: true },
          orderBy: [{ kind: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
        })
      : Promise.resolve([]),
  ]);

  const pmuLeadByPmu = new Map(
    candidatesRaw
      .filter((u) => u.pmuRole === 'pmu_team_leader' && u.pmuId)
      .map((u) => [u.pmuId as string, u]),
  );
  const createTargets = createTargetsRaw.map((t) => {
    const auto =
      t.kind === 'pmu'
        ? pmuLeadByPmu.get(t.id)
        : t.headUserId
          ? candidateById.get(t.headUserId)
          : undefined;
    return {
      id: t.id,
      name: t.name,
      kind: t.kind,
      isOfficeOfJs: t.id === officeOfJsDivisionId,
      autoOwnerId: auto?.id ?? null,
      autoOwnerName: auto?.name ?? null,
      subDivisions: t.children.map((c) => ({ id: c.id, name: c.name })),
      // Empty for a PMU target and for any division with no PMU under it —
      // which is exactly when the share switch must not be offered.
      pmuNames: (pmusByDivision.get(t.id) ?? []).map((p) => p.name),
    };
  });

  // The same targets, placed: organization, then directorate (or directly
  // under the organization), then the targets themselves in the order above
  // (divisions, then PMU teams). Only organizations holding a target appear,
  // so nobody is offered an organization they cannot create in.
  const targetGroups: TargetOrganization[] = groupByPlacement(
    createTargets.map((t) => ({ id: t.id })),
    structureNodes,
  ).map((o) => ({
    key: o.organization?.id ?? '__none__',
    name: o.organization?.name ?? 'Not in an organization',
    groups: o.groups.map((g) => ({
      key: g.key,
      directorate: g.path.length > 0 ? g.path.map((p) => p.name).join(' › ') : null,
      targetIds: g.units.map((u) => u.id),
    })),
  }));

  // The OSD account — a one-click pill on Office-of-JS tasks (present in the
  // pool whenever OJS is targetable, since that widens it to everyone).
  const osdCandidate = candidatesRaw.find((u) => u.hierarchySlot === 'osd');
  const osdAccount = osdCandidate ? { id: osdCandidate.id, name: osdCandidate.name } : null;

  const taskContext = await buildNotificationTaskContext(recentRaw);

  const recent: BellNotification[] = recentRaw.map((n) => ({
    id: n.id,
    type: n.type,
    payload: n.payload as Record<string, unknown> | null,
    readAt: n.readAt,
    createdAt: n.createdAt,
    taskContext: taskContext.get(n.id),
  }));

  const isOsd = me.hierarchySlot === 'osd' || me.isSuperAdmin;
  const isJs = me.hierarchySlot === 'js' || isOsd;
  const canSwitchRole = isOsd && me.isSuperAdmin;
  // Tour report (external platform) — Super Admins plus the osd.myas
  // account specifically, which is narrower than the OSD-slot gate.
  const showTourReport = me.isSuperAdmin || me.username === 'osd.myas';
  // Document Centre — Super Admins plus any user granted the
  // can_access_document_centre flag (see src/lib/document-centre-shared.ts).
  const canAccessDocumentCentre = canAccessDocumentCentreShared({
    isSuperAdmin: me.isSuperAdmin,
    canAccessDocumentCentre: me.canAccessDocumentCentre,
  });
  const canAccessBusinessCards = canAccessBusinessCardsShared({
    isSuperAdmin: me.isSuperAdmin,
    canAccessBusinessCards: me.canAccessBusinessCards,
  });
  // Timeline Files are hidden from barred slots (PMU Consultant) — drop the nav
  // link so it does not lead to an empty list. Enforcement is server-side in
  // buildTfVisibilityClause; this is the matching UI gate.
  const canAccessTf = canAccessTimelineFiles(me.hierarchySlot);

  return (
    <AppShell
      user={{
        name: me.name,
        initials: initialsOf(me.name),
        colour: me.division.avatarColour,
        designation: me.designation,
        isSuperAdmin: me.isSuperAdmin,
        isOsd,
        isJs,
        showTourReport,
        canAccessDocumentCentre,
        canAccessBusinessCards,
        canAccessTimelineFiles: canAccessTf,
        canSwitchRole,
      }}
      notifications={{ unreadCount, recent }}
    >
      <QuickCreateProvider
        // Prefilled from where the person sits: their home division — or, for a
        // PMU member, their PMU, which is the board they create on (see
        // ownTargetIds above).
        defaultDivisionId={isPmuMember ? (me.pmuId as string) : me.divisionId}
        targetGroups={targetGroups}
        s3Configured={isS3Configured()}
        createTargets={createTargets}
        ownerCandidates={ownerCandidates}
        osdAccount={osdAccount}
      >
        {children}
        <QuickCreateFab />
      </QuickCreateProvider>
    </AppShell>
  );
}
