import { redirect } from 'next/navigation';
import { format } from 'date-fns';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

import { DivisionHeadCard, type HeadCandidate } from './_components/DivisionHeadCard';
import { PmuTeamHeadCard, type PmuHeadCandidate } from './_components/PmuTeamHeadCard';
import { HierarchyMapper, type OfficerNode } from './_components/HierarchyMapper';
import {
  OrganizationHeadsCard,
  StructureUnitsPanel,
  type StructureUnit,
} from './_components/OrganizationPanels';
import {
  PersonInspector,
  type InspectorUser,
} from './_components/PersonInspector';
import { StructureTree, type StructureNode, type TreeUser } from './_components/StructureTree';

import type {
  UserFormDivisionOption,
  UserFormSupervisorOption,
} from '@/app/(app)/admin/users/_components/UserFormFields';
import {
  expandHeadedToDescendants,
  isStructuralKind,
  organizationOf,
  type StructureKind,
} from '@/lib/structure-shared';

type PageProps = {
  searchParams?: { division?: string; selected?: string };
};

function headCandidateOf(
  u: {
    id: string;
    name: string;
    designation: string;
    division: { name: string; avatarColour: string };
  } | null,
): HeadCandidate | null {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    designation: u.designation,
    divisionName: u.division.name,
    divisionColour: u.division.avatarColour,
  };
}

function pmuHeadCandidateOf(u: {
  id: string;
  name: string;
  designation: string;
  division: { avatarColour: string };
}): PmuHeadCandidate {
  return {
    id: u.id,
    name: u.name,
    designation: u.designation,
    divisionColour: u.division.avatarColour,
  };
}

export default async function StructurePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // Pull every division + every user, then derive everything client-side.
  const [divisions, allUsers] = await Promise.all([
    prisma.division.findMany({
      orderBy: [{ kind: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.user.findMany({
      include: {
        division: true,
        subDivision: true,
        section: true,
        supervisor: { include: { division: true } },
        subordinates: { include: { division: true } },
      },
      orderBy: { name: 'asc' },
    }),
  ]);

  // User counts per node. A user attached to a PMU team counts on the PMU
  // node only — not on the ministry division tree. (The division head is
  // the one deliberate repeat: they count on their division AND appear at
  // the top of each of their PMU teams.)
  const headUserIdByDivision = new Map<string, string>();
  for (const d of divisions) {
    if (d.kind === 'division' && d.headUserId) headUserIdByDivision.set(d.id, d.headUserId);
  }

  const pmuIdByUser = new Map(allUsers.map((u) => [u.id, u.pmuId]));
  const userCountsByDivision = new Map<string, number>();
  const bump = (key: string) =>
    userCountsByDivision.set(key, (userCountsByDivision.get(key) ?? 0) + 1);
  for (const u of allUsers) {
    if (u.pmuId) {
      bump(u.pmuId);
      continue;
    }
    bump(u.divisionId);
    if (u.subDivisionId) bump(u.subDivisionId);
    if (u.sectionId) bump(u.sectionId);
  }
  // Each PMU also shows its home division's head — but only add them if
  // they aren't already counted as a member of this same PMU (a head who
  // also sits in their division's PMU would otherwise be double-counted,
  // making the badge disagree with the chart, which dedupes for free).
  for (const d of divisions) {
    if (d.kind !== 'pmu') continue;
    const homeId = d.pmuParentDivisionId ?? d.parentId;
    if (!homeId) continue;
    const headId = headUserIdByDivision.get(homeId);
    if (!headId || pmuIdByUser.get(headId) === d.id) continue;
    bump(d.id);
  }

  // Organizations and directorates hold nobody directly — people are homed in
  // divisions — so their badge is a roll-up: every person whose home division
  // sits anywhere beneath them. That is a headcount, so PMU members are in it
  // (a PMU member's home division is the PMU's parent division) even though
  // the division badges leave them to their PMU node; an organization's badge
  // is therefore the sum of its divisions' AND their PMUs' members, less the
  // division heads each PMU badge repeats.
  const structureTree = divisions.map((d) => ({
    id: d.id,
    kind: d.kind,
    parentId: d.parentId,
    pmuParentDivisionId: d.pmuParentDivisionId,
  }));
  const divisionsUnder = new Map<string, Set<string>>();
  for (const d of divisions) {
    if (!isStructuralKind(d.kind)) continue;
    const beneath = new Set(expandHeadedToDescendants([d.id], structureTree));
    beneath.delete(d.id);
    divisionsUnder.set(d.id, beneath);
  }
  for (const [id, beneath] of divisionsUnder) {
    userCountsByDivision.set(id, allUsers.filter((u) => beneath.has(u.divisionId)).length);
  }

  const treeNodes: StructureNode[] = divisions.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind as StructureNode['kind'],
    parentId: d.parentId,
    pmuParentDivisionId: d.pmuParentDivisionId,
    avatarColour: d.avatarColour,
    userCount: userCountsByDivision.get(d.id) ?? 0,
  }));

  const treeUsers: TreeUser[] = allUsers.filter((u) => u.isActive).map((u) => ({
    id: u.id,
    name: u.name,
    username: u.username,
    designation: u.designation,
    divisionId: u.divisionId,
    divisionName: u.division.name,
    divisionColour: u.division.avatarColour,
    pmuId: u.pmuId,
  }));

  // Pick the active division — default to the first top-level division.
  const activeDivision =
    (searchParams?.division &&
      divisions.find((d) => d.id === searchParams.division)) ||
    divisions.find((d) => d.kind === 'division') ||
    divisions[0] ||
    null;

  if (!activeDivision) {
    // No divisions exist — show an empty-state page that nudges creation.
    return (
      <div className="max-w-6xl mx-auto py-10 text-center">
        <i className="ti ti-building text-[40px] text-ink-3 block mb-3" aria-hidden="true" />
        <h2 className="font-serif text-[22px] text-ink mb-2">No organizations yet</h2>
        <p className="text-[13px] text-ink-2 max-w-md mx-auto leading-relaxed">
          Add an organization first, then the divisions inside it, to start mapping the
          hierarchy.
        </p>
      </div>
    );
  }

  // Active delegations on the shown division. A live delegation makes its
  // recipient the temporary head (all head powers) for the window, so the
  // Structure head card surfaces who currently holds that access next to the
  // Change control. Only meaningful for the units that can be headed —
  // divisions, directorates and organizations; sub-divisions, sections and
  // PMU teams are never delegated. Expiry is purely time-based — the window
  // filter is the single source of "active".
  const now = new Date();
  const activeHeadDelegations =
    activeDivision.kind === 'division' ||
    activeDivision.kind === 'directorate' ||
    activeDivision.kind === 'organization'
      ? await prisma.divisionAccessDelegation.findMany({
          where: {
            divisionId: activeDivision.id,
            revokedAt: null,
            startsAt: { lte: now },
            endsAt: { gte: now },
          },
          include: { delegatedTo: { select: { id: true, name: true, designation: true } } },
          orderBy: { endsAt: 'asc' },
        })
      : [];
  const activeDelegates = activeHeadDelegations.map((d) => ({
    id: d.delegatedTo.id,
    name: d.delegatedTo.name,
    designation: d.delegatedTo.designation,
    until: format(d.endsAt, 'd LLL yyyy'),
  }));

  // Officers shown in the chart. PMU-team members appear only under their
  // PMU node — never in the ministry division chart. A PMU chart is the
  // team plus the home division's head at the top; the head deliberately
  // repeats between the division tree and the PMU tree.
  const pmuHomeDivisionId =
    activeDivision.kind === 'pmu'
      ? activeDivision.pmuParentDivisionId ?? activeDivision.parentId
      : null;
  const pmuHeadUserId = pmuHomeDivisionId
    ? headUserIdByDivision.get(pmuHomeDivisionId) ?? null
    : null;

  const officersInActive = allUsers.filter((u) => {
    if (activeDivision.kind === 'pmu') {
      return u.pmuId === activeDivision.id || u.id === pmuHeadUserId;
    }
    if (u.pmuId) return false;
    if (activeDivision.kind === 'division') return u.divisionId === activeDivision.id;
    if (activeDivision.kind === 'sub_division') return u.subDivisionId === activeDivision.id;
    return u.sectionId === activeDivision.id;
  });

  // The PMUs this page shows a Team Head card for — one card each.
  //
  //   - on a DIVISION: every PMU hanging off it (pmu_parent_division_id, with
  //     the parent_id fallback the rest of the codebase uses). A division can
  //     carry several, and each runs its own team, so each needs its own head.
  //   - on a PMU itself: just that PMU, so the control also sits where you
  //     would look for it after clicking the PMU in the tree.
  //
  // Candidates are keyed on users.pmu_id, never the home division: every
  // member of every PMU under a division shares that division as their home,
  // so pooling by division mixed the teams together.
  const pmusToHead =
    activeDivision.kind === 'pmu'
      ? [activeDivision]
      : activeDivision.kind === 'division'
        ? divisions.filter(
            (d) =>
              d.kind === 'pmu' &&
              (d.pmuParentDivisionId ?? d.parentId) === activeDivision.id,
          )
        : [];
  const pmuMembersByPmu = new Map<string, typeof allUsers>();
  for (const u of allUsers) {
    if (!u.isActive || !u.isPmu || !u.pmuId) continue;
    const list = pmuMembersByPmu.get(u.pmuId) ?? [];
    list.push(u);
    pmuMembersByPmu.set(u.pmuId, list);
  }

  // Pool/roots/reachability are computed inside HierarchyMapper, which
  // guarantees every officer renders exactly once.
  const officerNodes: OfficerNode[] = officersInActive.map((u) => ({
    id: u.id,
    name: u.name,
    designation: u.designation,
    hierarchySlot: u.hierarchySlot,
    contractRole: u.contractRole,
    divisionColour: u.division.avatarColour,
    supervisorId: u.supervisorId,
    isActive: u.isActive,
    isSelf: u.id === session.user.id,
  }));

  // Build the inspector data for the selected user.
  const selectedUser = searchParams?.selected
    ? allUsers.find((u) => u.id === searchParams.selected) ?? null
    : null;
  // The inspector's Edit saves the WHOLE user form (updateUserAction), and a
  // switch or checkbox missing from its defaults posts as off. So the defaults
  // carry every access grant and extra division exactly as Users does
  // (rowToDefaults) — otherwise saving from here would silently revoke them.
  const selectedExtraDivisionIds = selectedUser
    ? (
        await prisma.userDivisionAccess.findMany({
          where: { userId: selectedUser.id },
          select: { divisionId: true },
        })
      ).map((a) => a.divisionId)
    : [];

  let inspectorUser: InspectorUser | null = null;
  if (selectedUser) {
    inspectorUser = {
      id: selectedUser.id,
      name: selectedUser.name,
      username: selectedUser.username,
      designation: selectedUser.designation,
      hierarchySlot: selectedUser.hierarchySlot,
      contractRole: selectedUser.contractRole,
      isPmu: selectedUser.isPmu,
      pmuRole: selectedUser.pmuRole,
      isActive: selectedUser.isActive,
      isSuperAdmin: selectedUser.isSuperAdmin,
      lastLogin: selectedUser.lastLogin,
      division: {
        id: selectedUser.division.id,
        name: selectedUser.division.name,
        avatarColour: selectedUser.division.avatarColour,
      },
      subDivision: selectedUser.subDivision
        ? { name: selectedUser.subDivision.name }
        : null,
      section: selectedUser.section ? { name: selectedUser.section.name } : null,
      supervisor: selectedUser.supervisor
        ? {
            id: selectedUser.supervisor.id,
            name: selectedUser.supervisor.name,
            designation: selectedUser.supervisor.designation,
            division: { avatarColour: selectedUser.supervisor.division.avatarColour },
          }
        : null,
      directReports: selectedUser.subordinates.map((s) => ({
        id: s.id,
        name: s.name,
        designation: s.designation,
        division: { avatarColour: s.division.avatarColour },
      })),
      defaults: {
        name: selectedUser.name,
        username: selectedUser.username,
        designation: selectedUser.designation,
        hierarchySlot: selectedUser.hierarchySlot,
        contractRole: selectedUser.contractRole ?? '',
        divisionId: selectedUser.divisionId,
        subDivisionId: selectedUser.subDivisionId,
        sectionId: selectedUser.sectionId,
        pmuId: selectedUser.pmuId,
        supervisorId: selectedUser.supervisorId,
        isSuperAdmin: selectedUser.isSuperAdmin,
        extraDivisionIds: selectedExtraDivisionIds,
        canAccessDocumentCentre: selectedUser.canAccessDocumentCentre,
        canAccessBusinessCards: selectedUser.canAccessBusinessCards,
        canAddJsComment: selectedUser.canAddJsComment,
        canGenerateReports: selectedUser.canGenerateReports,
        isOrganizationHead: selectedUser.isOrganizationHead,
      },
    };
  }

  // Form options for the dialogs.
  const divisionOptions: UserFormDivisionOption[] = divisions.map((d) => ({
    id: d.id,
    name: d.name,
    parentId: d.parentId,
    pmuParentDivisionId: d.pmuParentDivisionId,
    kind: d.kind as StructureKind,
  }));

  const supervisorOptions: UserFormSupervisorOption[] = allUsers
    .filter((u) => u.isActive)
    .map((u) => ({ id: u.id, name: u.name, designation: u.designation }));

  // For an organization or directorate, the centre column shows what it holds
  // and who heads it, instead of the per-division reporting chart.
  const activeIsStructural = isStructuralKind(activeDivision.kind);
  const structureUnits: StructureUnit[] = activeIsStructural
    ? divisions
        .filter((d) => d.parentId === activeDivision.id && d.kind !== 'pmu')
        .map((d) => ({
          id: d.id,
          name: d.name,
          kind: d.kind as StructureKind,
          userCount: userCountsByDivision.get(d.id) ?? 0,
        }))
    : [];
  // Organization heads: every Super Admin, by role, plus anyone whose
  // Organization-head toggle is on and whose home division sits in THIS one.
  const orgSuperAdmins =
    activeDivision.kind === 'organization'
      ? allUsers
          .filter((u) => u.isActive && u.isSuperAdmin)
          .map((u) => ({ id: u.id, name: u.name, designation: u.designation }))
      : [];
  const orgHeads =
    activeDivision.kind === 'organization'
      ? allUsers
          .filter(
            (u) =>
              u.isActive &&
              u.isOrganizationHead &&
              organizationOf(u.divisionId, structureTree) === activeDivision.id,
          )
          .map((u) => ({ id: u.id, name: u.name, designation: u.designation }))
      : [];

  // Breadcrumb for the active node.
  const parentBreadcrumb = (() => {
    const parts: string[] = [];
    let current: typeof activeDivision | null = activeDivision;
    while (current && current.parentId) {
      const parent = divisions.find((d) => d.id === current!.parentId) ?? null;
      if (!parent) break;
      parts.unshift(parent.name);
      current = parent;
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  })();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px] gap-4">
      {/* Left — Structure Tree */}
      <aside className="lg:sticky lg:top-[7rem] self-start">
        <StructureTree
          nodes={treeNodes}
          activeId={activeDivision.id}
          allUsers={treeUsers}
          divisions={divisionOptions}
          supervisors={supervisorOptions}
        />
      </aside>

      {/* Centre — Division head + Hierarchy Mapper */}
      <section>
        {activeDivision.kind === 'organization' ? (
          <OrganizationHeadsCard
            superAdmins={orgSuperAdmins}
            heads={orgHeads}
            activeDelegates={activeDelegates}
          />
        ) : null}
        {activeDivision.kind === 'division' || activeDivision.kind === 'directorate' ? (
          <DivisionHeadCard
            kind={activeDivision.kind}
            divisionId={activeDivision.id}
            divisionName={activeDivision.name}
            currentHead={headCandidateOf(
              allUsers.find((u) => u.id === activeDivision.headUserId) ?? null,
            )}
            candidates={allUsers
              .filter((u) => u.isActive)
              .map((u) => ({
                id: u.id,
                name: u.name,
                designation: u.designation,
                divisionName: u.division.name,
                divisionColour: u.division.avatarColour,
              }))}
            activeDelegates={activeDelegates}
            canEdit={session.user.isSuperAdmin === true}
          />
        ) : null}
        {pmusToHead.map((pmu) => {
          const members = pmuMembersByPmu.get(pmu.id) ?? [];
          return (
            <PmuTeamHeadCard
              key={pmu.id}
              pmuId={pmu.id}
              pmuName={pmu.name}
              currentHead={
                members
                  .filter((u) => u.pmuRole === 'pmu_team_leader')
                  .map(pmuHeadCandidateOf)[0] ?? null
              }
              candidates={members.map(pmuHeadCandidateOf)}
              canEdit={session.user.isSuperAdmin === true}
            />
          );
        })}
        {activeIsStructural ? (
          <StructureUnitsPanel
            name={activeDivision.name}
            kind={activeDivision.kind as StructureKind}
            parentBreadcrumb={parentBreadcrumb}
            units={structureUnits}
            divisionCount={divisionsUnder.get(activeDivision.id)?.size ?? 0}
            peopleCount={userCountsByDivision.get(activeDivision.id) ?? 0}
          />
        ) : (
          <HierarchyMapper
            divisionName={activeDivision.name}
            parentBreadcrumb={parentBreadcrumb}
            officers={officerNodes}
          />
        )}
      </section>

      {/* Right — Person Inspector */}
      <aside className="lg:sticky lg:top-[7rem] self-start">
        <PersonInspector
          user={inspectorUser}
          divisions={divisionOptions}
          supervisors={supervisorOptions}
          selfId={session.user.id}
          activeDivision={{
            id: activeDivision.id,
            name: activeDivision.name,
            kind: activeDivision.kind as StructureKind,
          }}
          allUsers={treeUsers}
        />
      </aside>
    </div>
  );
}
