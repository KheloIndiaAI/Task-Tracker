import { describe, expect, it } from 'vitest';

import {
  canActAsHeadOf,
  canAssignTaskTo,
  canCreateTaskOutsideOwnDivisions,
  canDelegateDivision,
  canEditDivisionNotice,
  canManageTask,
  canSetJsPriorityLane,
  canSharePmuTeam,
  canTransferTaskTo,
  isEligibleDelegate,
  roleOf,
  type RbacActor,
  type RbacTarget,
} from '@/lib/rbac/rules';

// The production division layout: Zuber (home ABD) heads ABD + NSDF,
// Chanchal heads KI, Ayushman heads MEDIA, osd.myas is Super Admin.
const KI = 'div-ki';
const NSDF = 'div-nsdf';
const SGM = 'div-sgm';
const ABD = 'div-abd';
const MEDIA = 'div-media';
const OJS = 'div-ojs';

// memberDivisionIds always includes the home division; unless a test grants an
// extra membership explicitly, it defaults to just the home division so the
// single-division cases read exactly as before.
function actor(overrides: Partial<RbacActor> = {}): RbacActor {
  const divisionId = overrides.divisionId ?? KI;
  return {
    id: 'actor-1',
    divisionId,
    isSuperAdmin: false,
    headedDivisionIds: [],
    memberDivisionIds: [divisionId],
    ...overrides,
  };
}

function target(overrides: Partial<RbacTarget> = {}): RbacTarget {
  const divisionId = overrides.divisionId ?? KI;
  return {
    id: 'target-1',
    divisionId,
    isSuperAdmin: false,
    headedDivisionIds: [],
    memberDivisionIds: [divisionId],
    isActive: true,
    ...overrides,
  };
}

describe('roleOf', () => {
  it('maps the three roles', () => {
    expect(roleOf({ isSuperAdmin: true, headedDivisionIds: [] })).toBe('super_admin');
    expect(roleOf({ isSuperAdmin: false, headedDivisionIds: [KI] })).toBe('division_head');
    expect(roleOf({ isSuperAdmin: false, headedDivisionIds: [] })).toBe('division_user');
  });

  it('super admin wins over headship', () => {
    expect(roleOf({ isSuperAdmin: true, headedDivisionIds: [KI] })).toBe('super_admin');
  });

  it('membership never promotes to division_head', () => {
    // A member of many divisions but head of none stays a division_user.
    expect(
      roleOf({ isSuperAdmin: false, headedDivisionIds: [] }),
    ).toBe('division_user');
  });
});

describe('canTransferTaskTo — division user', () => {
  const user = actor({ divisionId: KI });

  it('allows a user in the same division', () => {
    expect(canTransferTaskTo(user, target({ divisionId: KI }))).toBe(true);
  });

  it('allows their own division head, even one homed in another division', () => {
    // Zuber-style: head of KI whose own row lives elsewhere.
    expect(
      canTransferTaskTo(user, target({ divisionId: ABD, headedDivisionIds: [KI] })),
    ).toBe(true);
  });

  it('allows Super Admin', () => {
    expect(
      canTransferTaskTo(user, target({ divisionId: OJS, isSuperAdmin: true })),
    ).toBe(true);
  });

  it('rejects a user in another division', () => {
    expect(canTransferTaskTo(user, target({ divisionId: SGM }))).toBe(false);
  });

  it("rejects another division's head", () => {
    expect(
      canTransferTaskTo(user, target({ divisionId: SGM, headedDivisionIds: [SGM] })),
    ).toBe(false);
  });

  it('rejects inactive users and self-transfers', () => {
    expect(canTransferTaskTo(user, target({ isActive: false }))).toBe(false);
    expect(canTransferTaskTo(user, target({ id: user.id }))).toBe(false);
  });
});

describe('canTransferTaskTo — division head', () => {
  // Zuber: home ABD, heads ABD + NSDF.
  const head = actor({ id: 'zuber', divisionId: ABD, headedDivisionIds: [ABD, NSDF] });

  it('allows users in every division they head', () => {
    expect(canTransferTaskTo(head, target({ divisionId: ABD }))).toBe(true);
    expect(canTransferTaskTo(head, target({ divisionId: NSDF }))).toBe(true);
  });

  it('allows another division head', () => {
    expect(
      canTransferTaskTo(head, target({ divisionId: SGM, headedDivisionIds: [SGM] })),
    ).toBe(true);
  });

  it('allows Super Admin', () => {
    expect(canTransferTaskTo(head, target({ divisionId: OJS, isSuperAdmin: true }))).toBe(true);
  });

  it('rejects a regular user of an unheaded division', () => {
    expect(canTransferTaskTo(head, target({ divisionId: MEDIA }))).toBe(false);
  });

  it('allows home-division users for a delegate homed outside their headed set', () => {
    // A KI user holding a delegation over SGM keeps their KI reach.
    const delegate = actor({ divisionId: KI, headedDivisionIds: [SGM] });
    expect(canTransferTaskTo(delegate, target({ divisionId: KI }))).toBe(true);
    expect(canTransferTaskTo(delegate, target({ divisionId: SGM }))).toBe(true);
  });
});

describe('canTransferTaskTo — super admin', () => {
  it('allows anyone active', () => {
    const sa = actor({ isSuperAdmin: true, divisionId: OJS });
    expect(canTransferTaskTo(sa, target({ divisionId: MEDIA }))).toBe(true);
    expect(canTransferTaskTo(sa, target({ divisionId: SGM }))).toBe(true);
  });

  it('still rejects inactive targets', () => {
    const sa = actor({ isSuperAdmin: true });
    expect(canTransferTaskTo(sa, target({ isActive: false }))).toBe(false);
  });
});

describe('canTransferTaskTo — multi-division membership', () => {
  it('a member of two divisions can transfer to a co-member of either', () => {
    // Home KI, also a full member of NSDF via an admin grant. This is the
    // membership-native replacement for the retired KI→NSDF allocation link.
    const dual = actor({ divisionId: KI, memberDivisionIds: [KI, NSDF] });
    expect(canTransferTaskTo(dual, target({ divisionId: NSDF }))).toBe(true);
    expect(canTransferTaskTo(dual, target({ divisionId: KI }))).toBe(true);
    // still not to an unrelated division
    expect(canTransferTaskTo(dual, target({ divisionId: MEDIA }))).toBe(false);
  });

  it('reaches a target via the target’s extra membership too', () => {
    // The target is homed in NSDF but also a member of KI — a KI user reaches them.
    const kiUser = actor({ divisionId: KI });
    expect(
      canTransferTaskTo(kiUser, target({ divisionId: NSDF, memberDivisionIds: [NSDF, KI] })),
    ).toBe(true);
  });

  it('a plain KI user cannot reach an NSDF member without a shared membership', () => {
    const kiUser = actor({ divisionId: KI, memberDivisionIds: [KI] });
    expect(
      canTransferTaskTo(kiUser, target({ divisionId: NSDF, memberDivisionIds: [NSDF] })),
    ).toBe(false);
  });
});

describe('canAssignTaskTo', () => {
  it('super admin assigns anywhere', () => {
    const sa = actor({ isSuperAdmin: true, divisionId: OJS });
    expect(canAssignTaskTo(sa, target({ divisionId: MEDIA }))).toBe(true);
  });

  it('head assigns only within headed divisions (plus home)', () => {
    const head = actor({ divisionId: ABD, headedDivisionIds: [ABD, NSDF] });
    expect(canAssignTaskTo(head, target({ divisionId: NSDF }))).toBe(true);
    expect(canAssignTaskTo(head, target({ divisionId: ABD }))).toBe(true);
    expect(canAssignTaskTo(head, target({ divisionId: KI }))).toBe(false);
  });

  it('division user cannot assign directly', () => {
    const user = actor({ headedDivisionIds: [] });
    expect(canAssignTaskTo(user, target({ divisionId: KI }))).toBe(false);
  });

  it('never assigns to inactive users', () => {
    const sa = actor({ isSuperAdmin: true });
    expect(canAssignTaskTo(sa, target({ isActive: false }))).toBe(false);
  });

  it('a head assigns to a member of a headed division, even one homed elsewhere', () => {
    // Membership replaces the old allocation link: a user homed in MEDIA but
    // granted NSDF membership is assignable by NSDF's head.
    const head = actor({ divisionId: ABD, headedDivisionIds: [ABD, NSDF] });
    expect(
      canAssignTaskTo(head, target({ divisionId: MEDIA, memberDivisionIds: [MEDIA, NSDF] })),
    ).toBe(true);
  });

  it('membership alone does not let a non-head assign (assignment is head-only)', () => {
    const member = actor({ divisionId: KI, headedDivisionIds: [], memberDivisionIds: [KI, NSDF] });
    expect(canAssignTaskTo(member, target({ divisionId: NSDF }))).toBe(false);
  });
});

describe('canActAsHeadOf', () => {
  it('matches headed divisions and super admin', () => {
    const head = actor({ headedDivisionIds: [NSDF] });
    expect(canActAsHeadOf(head, NSDF)).toBe(true);
    expect(canActAsHeadOf(head, KI)).toBe(false);
    expect(canActAsHeadOf(actor({ isSuperAdmin: true }), KI)).toBe(true);
  });

  it('membership does NOT confer head powers', () => {
    // A member of NSDF (not its head) gets no head powers there — no delete,
    // no free reassignment of NSDF's own tasks, no delegation.
    const member = actor({ headedDivisionIds: [KI], memberDivisionIds: [KI, NSDF] });
    expect(canActAsHeadOf(member, NSDF)).toBe(false);
  });
});

describe('canCreateTaskOutsideOwnDivisions', () => {
  // Creating a task is no longer a head power — anyone may create on a board
  // they belong to (the create action checks membership itself). This rule
  // answers only the narrower question: may I create on a board that is NOT
  // mine? So "false" here does not mean "cannot create a task", it means
  // "only within your own divisions".

  it('super admin reaches any board', () => {
    const sa = actor({ isSuperAdmin: true, divisionId: OJS });
    expect(canCreateTaskOutsideOwnDivisions(sa, MEDIA)).toBe(true);
    expect(canCreateTaskOutsideOwnDivisions(sa, KI)).toBe(true);
  });

  it('OSD reaches any board', () => {
    const osd = actor({ isOsd: true, divisionId: OJS });
    expect(canCreateTaskOutsideOwnDivisions(osd, MEDIA)).toBe(true);
    expect(canCreateTaskOutsideOwnDivisions(osd, KI)).toBe(true);
  });

  it('a head reaches the divisions they head', () => {
    // Zuber-style: home ABD, heads NSDF only. ABD is reached as a MEMBER by
    // the create action, not by this rule.
    const head = actor({ divisionId: ABD, headedDivisionIds: [NSDF] });
    expect(canCreateTaskOutsideOwnDivisions(head, NSDF)).toBe(true);
    expect(canCreateTaskOutsideOwnDivisions(head, KI)).toBe(false);
  });

  it('an active delegate reaches the delegated division', () => {
    // headedDivisionIds already folds in active delegations.
    const delegate = actor({ divisionId: KI, headedDivisionIds: [SGM] });
    expect(canCreateTaskOutsideOwnDivisions(delegate, SGM)).toBe(true);
  });

  it('a plain user reaches nothing beyond their own divisions', () => {
    const user = actor({ divisionId: KI });
    expect(canCreateTaskOutsideOwnDivisions(user, SGM)).toBe(false);
    expect(canCreateTaskOutsideOwnDivisions(user, MEDIA)).toBe(false);
  });

  it('membership alone does not widen this rule', () => {
    // The member reaches NSDF through membership in the create action; this
    // rule stays false, which is what keeps the two paths distinct.
    const member = actor({ divisionId: KI, headedDivisionIds: [], memberDivisionIds: [KI, NSDF] });
    expect(canCreateTaskOutsideOwnDivisions(member, NSDF)).toBe(false);
  });
});

describe('canEditDivisionNotice', () => {
  it('super admin edits any division notice board', () => {
    const sa = actor({ isSuperAdmin: true, divisionId: OJS });
    expect(canEditDivisionNotice(sa, MEDIA)).toBe(true);
    expect(canEditDivisionNotice(sa, KI)).toBe(true);
  });

  it('OSD edits any division notice board', () => {
    const osd = actor({ isOsd: true, divisionId: OJS });
    expect(canEditDivisionNotice(osd, MEDIA)).toBe(true);
    expect(canEditDivisionNotice(osd, KI)).toBe(true);
  });

  it('a head only within divisions they head — home does not count', () => {
    const head = actor({ divisionId: ABD, headedDivisionIds: [NSDF] });
    expect(canEditDivisionNotice(head, NSDF)).toBe(true);
    expect(canEditDivisionNotice(head, ABD)).toBe(false);
    expect(canEditDivisionNotice(head, KI)).toBe(false);
  });

  it('an active delegate gains the power for the delegated division', () => {
    const delegate = actor({ divisionId: KI, headedDivisionIds: [SGM] });
    expect(canEditDivisionNotice(delegate, SGM)).toBe(true);
    expect(canEditDivisionNotice(delegate, KI)).toBe(false);
  });

  it('membership does NOT grant notice-board edit rights (a non-head member)', () => {
    const member = actor({ divisionId: KI, headedDivisionIds: [], memberDivisionIds: [KI, NSDF] });
    expect(canEditDivisionNotice(member, NSDF)).toBe(false);
    expect(canEditDivisionNotice(member, KI)).toBe(false);
  });
});

describe('canManageTask — edit fields + manage collaborators', () => {
  // A task created by the SGM head, then handed to a plain SGM member.
  const task = { ownerId: 'member-x', createdById: 'sgm-head', divisionId: SGM };

  const caller = (
    overrides: Partial<{
      id: string;
      isSuperAdmin: boolean;
      hierarchySlot: string;
      memberDivisionIds: string[];
      headedDivisionIds: string[];
    }> = {},
  ) => ({
    id: 'caller-1',
    isSuperAdmin: false,
    hierarchySlot: 'under_secretary',
    memberDivisionIds: [SGM],
    headedDivisionIds: [] as string[],
    ...overrides,
  });

  it('allows the current owner', () => {
    expect(canManageTask(caller({ id: 'member-x' }), task)).toBe(true);
  });

  it('lets the original creator keep it AFTER ownership is handed off', () => {
    // The crux of the requirement: the SGM head created the task, no longer
    // owns it, is not currently a head here — yet still manages it as creator.
    expect(
      canManageTask(caller({ id: 'sgm-head', headedDivisionIds: [] }), task),
    ).toBe(true);
  });

  it('allows Super Admin, OSD, and JS', () => {
    expect(canManageTask(caller({ isSuperAdmin: true }), task)).toBe(true);
    expect(canManageTask(caller({ hierarchySlot: 'osd' }), task)).toBe(true);
    expect(canManageTask(caller({ hierarchySlot: 'js' }), task)).toBe(true);
  });

  it("allows a Director who is a member of the task's division (home or granted)", () => {
    expect(
      canManageTask(caller({ hierarchySlot: 'director', memberDivisionIds: [SGM] }), task),
    ).toBe(true);
    // A Director homed in KI but granted SGM membership manages SGM tasks.
    expect(
      canManageTask(caller({ hierarchySlot: 'director', memberDivisionIds: [KI, SGM] }), task),
    ).toBe(true);
    // A Director who is not a member of the task's division cannot.
    expect(
      canManageTask(caller({ hierarchySlot: 'director', memberDivisionIds: [KI] }), task),
    ).toBe(false);
  });

  it('allows the division head', () => {
    expect(canManageTask(caller({ headedDivisionIds: [SGM] }), task)).toBe(true);
  });

  it('allows an active DELEGATE of the division (delegation folds into headedDivisionIds)', () => {
    // A user homed elsewhere, holding a live delegation over SGM, is the
    // temporary head and manages SGM tasks — including their collaborators.
    const delegate = caller({ id: 'deleg', memberDivisionIds: [MEDIA], headedDivisionIds: [SGM] });
    expect(canManageTask(delegate, task)).toBe(true);
  });

  it('rejects a plain member who is neither owner, creator, nor head', () => {
    expect(
      canManageTask(caller({ id: 'someone-else', memberDivisionIds: [SGM] }), task),
    ).toBe(false);
  });

  it('rejects a head of a different division', () => {
    expect(canManageTask(caller({ headedDivisionIds: [KI] }), task)).toBe(false);
  });
});

describe('canManageTask — PMU team leader', () => {
  // A PMU team leader (not a division head) manages tasks OWNED BY a member of
  // their PMU team. `pmuTeamMemberIds` carries that team; team scope is owner-
  // based, independent of the task's division.
  const TEAM = ['leader-1', 'teammate-a', 'teammate-b'];
  const leader = (overrides: Record<string, unknown> = {}) => ({
    id: 'leader-1',
    isSuperAdmin: false,
    hierarchySlot: 'aso',
    memberDivisionIds: [KI],
    headedDivisionIds: [] as string[],
    pmuTeamMemberIds: TEAM,
    ...overrides,
  });

  it("manages a DIVISION task owned by a team member (not the leader's own)", () => {
    const task = { ownerId: 'teammate-a', createdById: 'teammate-a', divisionId: KI };
    expect(canManageTask(leader(), task)).toBe(true);
  });

  it('does NOT manage a task owned by a non-team member in the same division', () => {
    // A non-PMU ministry task in the same division: owner is not on the team.
    const task = { ownerId: 'ministry-officer', createdById: 'ministry-officer', divisionId: KI };
    expect(canManageTask(leader(), task)).toBe(false);
  });

  it('is inert for a normal caller with no team (undefined/empty)', () => {
    const task = { ownerId: 'teammate-a', createdById: 'teammate-a', divisionId: KI };
    expect(canManageTask(leader({ pmuTeamMemberIds: undefined }), task)).toBe(false);
    expect(canManageTask(leader({ pmuTeamMemberIds: [] }), task)).toBe(false);
  });

  it('still lets the leader manage their own / created tasks (ownership rule)', () => {
    expect(
      canManageTask(leader(), { ownerId: 'leader-1', createdById: 'x', divisionId: MEDIA }),
    ).toBe(true);
  });
});

describe('canSetJsPriorityLane — the Daily/Weekly/FortNight/Monthly/Watchlist pills', () => {
  const PMU = 'div-nsdf-pmu';
  const caller = (overrides: Record<string, unknown> = {}) => ({
    isSuperAdmin: false,
    hierarchySlot: 'under_secretary',
    memberDivisionIds: [KI],
    headedDivisionIds: [] as string[],
    ...overrides,
  });

  it('lets leadership curate a division they are not even a member of', () => {
    const away = { divisionId: NSDF };
    expect(canSetJsPriorityLane(caller({ isSuperAdmin: true, memberDivisionIds: [OJS] }), away)).toBe(true);
    expect(canSetJsPriorityLane(caller({ hierarchySlot: 'osd', memberDivisionIds: [OJS] }), away)).toBe(true);
  });

  it('scopes a Director to their own member divisions', () => {
    const director = caller({ hierarchySlot: 'director' });
    expect(canSetJsPriorityLane(director, { divisionId: KI })).toBe(true);
    expect(canSetJsPriorityLane(director, { divisionId: NSDF })).toBe(false);
  });

  it('lets a head — or an active delegate, same set — curate what they head', () => {
    expect(canSetJsPriorityLane(caller({ headedDivisionIds: [NSDF] }), { divisionId: NSDF })).toBe(true);
  });

  it('gives a PMU member no pills anywhere', () => {
    // Why the tasks list renders a PMU's segment lane board read-only: a PMU
    // member is neither leadership, a Director, nor a head, so every division
    // they can see fails this. A PMU team leader is no different — team scope
    // buys task management (canManageTask above), never curation.
    const pmuMember = caller({ hierarchySlot: 'consultant', memberDivisionIds: [PMU] });
    expect(canSetJsPriorityLane(pmuMember, { divisionId: PMU })).toBe(false);
    expect(canSetJsPriorityLane(pmuMember, { divisionId: NSDF })).toBe(false);
  });

  it('gives a plain officer none, even in their own division', () => {
    expect(canSetJsPriorityLane(caller(), { divisionId: KI })).toBe(false);
  });
});

describe('canSharePmuTeam — the "Show this task to PMU team" switch', () => {
  const PMU = 'div-ki-pmu';
  const caller = (overrides: Record<string, unknown> = {}) => ({
    id: 'caller-1',
    isSuperAdmin: false,
    hierarchySlot: 'under_secretary',
    headedDivisionIds: [] as string[],
    pmuId: null as string | null,
    pmuRole: null as string | null,
    ...overrides,
  });
  /** A task on a division that HAS a PMU under it. */
  const divisionTask = {
    ownerId: 'someone',
    divisionId: KI,
    divisionKind: 'division',
    divisionHasPmu: true,
  };
  /** The same division, but with no PMU — the "else do not show this" case. */
  const noPmuTask = { ...divisionTask, divisionHasPmu: false };
  /** A PMU's own task. */
  const pmuTask = {
    ownerId: 'leader-1',
    divisionId: PMU,
    divisionKind: 'pmu',
    divisionHasPmu: false,
  };

  it('is refused outright on a division with no PMU, for everyone', () => {
    expect(canSharePmuTeam(caller({ isSuperAdmin: true }), noPmuTask)).toBe(false);
    expect(canSharePmuTeam(caller({ hierarchySlot: 'osd' }), noPmuTask)).toBe(false);
    expect(canSharePmuTeam(caller({ headedDivisionIds: [KI] }), noPmuTask)).toBe(false);
  });

  it("lets the division's head — or an active delegate — share a division task", () => {
    expect(canSharePmuTeam(caller({ headedDivisionIds: [KI] }), divisionTask)).toBe(true);
  });

  it('refuses a head of some OTHER division', () => {
    expect(canSharePmuTeam(caller({ headedDivisionIds: [NSDF] }), divisionTask)).toBe(false);
  });

  it('refuses a plain member, a Director, and even the task owner', () => {
    expect(canSharePmuTeam(caller(), divisionTask)).toBe(false);
    expect(canSharePmuTeam(caller({ hierarchySlot: 'director' }), divisionTask)).toBe(false);
    // Ownership is not enough: widening who sees the board is a head power.
    expect(canSharePmuTeam(caller({ id: 'someone' }), divisionTask)).toBe(false);
  });

  it('lets OSD and Super Admin share wherever there is an audience', () => {
    expect(canSharePmuTeam(caller({ isSuperAdmin: true }), divisionTask)).toBe(true);
    expect(canSharePmuTeam(caller({ hierarchySlot: 'osd' }), divisionTask)).toBe(true);
    expect(canSharePmuTeam(caller({ isSuperAdmin: true }), pmuTask)).toBe(true);
    expect(canSharePmuTeam(caller({ hierarchySlot: 'osd' }), pmuTask)).toBe(true);
  });

  it('keeps the original PMU-task rule: the team leader who owns it', () => {
    const leader = caller({ id: 'leader-1', pmuRole: 'pmu_team_leader', pmuId: PMU });
    expect(canSharePmuTeam(leader, pmuTask)).toBe(true);
    // Not the owner…
    expect(canSharePmuTeam({ ...leader, id: 'other' }, pmuTask)).toBe(false);
    // …not a leader…
    expect(canSharePmuTeam({ ...leader, pmuRole: 'pmu_senior_consultant' }, pmuTask)).toBe(false);
    // …and not a leader of a DIFFERENT PMU.
    expect(canSharePmuTeam({ ...leader, pmuId: 'div-other-pmu' }, pmuTask)).toBe(false);
  });

  it('does not let a division head reach into a PMU\'s own task', () => {
    // A head manages the PMU's board elsewhere, but the whole-team share on a
    // PMU task stays the team leader's call.
    expect(canSharePmuTeam(caller({ headedDivisionIds: [KI, PMU] }), pmuTask)).toBe(false);
  });
});

describe('canDelegateDivision', () => {
  it('only the direct head or super admin can delegate', () => {
    expect(canDelegateDivision({ id: 'u1', isSuperAdmin: false }, { headUserId: 'u1' })).toBe(true);
    expect(canDelegateDivision({ id: 'u2', isSuperAdmin: false }, { headUserId: 'u1' })).toBe(false);
    expect(canDelegateDivision({ id: 'u2', isSuperAdmin: true }, { headUserId: 'u1' })).toBe(true);
    expect(canDelegateDivision({ id: 'u1', isSuperAdmin: false }, { headUserId: null })).toBe(false);
  });
});

describe('isEligibleDelegate', () => {
  const ctx = { divisionId: NSDF, delegatorId: 'zuber', delegatorHomeDivisionId: ABD };

  const person = (overrides: {
    id?: string;
    isActive?: boolean;
    divisionId?: string;
    memberDivisionIds?: string[];
    directHeadedDivisionIds?: string[];
  }) => ({
    id: overrides.id ?? 'p1',
    isActive: overrides.isActive ?? true,
    memberDivisionIds: overrides.memberDivisionIds ?? [overrides.divisionId ?? KI],
    directHeadedDivisionIds: overrides.directHeadedDivisionIds ?? [],
  });

  it('accepts another direct division head', () => {
    expect(isEligibleDelegate(person({ directHeadedDivisionIds: [SGM] }), ctx)).toBe(true);
  });

  it('accepts a member of the delegated division', () => {
    expect(isEligibleDelegate(person({ divisionId: NSDF }), ctx)).toBe(true);
  });

  it("accepts a member of the delegator's home division", () => {
    expect(isEligibleDelegate(person({ divisionId: ABD }), ctx)).toBe(true);
  });

  it('accepts a member of the delegated division via an admin-granted extra membership', () => {
    expect(
      isEligibleDelegate(person({ divisionId: KI, memberDivisionIds: [KI, NSDF] }), ctx),
    ).toBe(true);
  });

  it('rejects outsiders, the delegator, and inactive users', () => {
    expect(isEligibleDelegate(person({ divisionId: KI }), ctx)).toBe(false);
    expect(isEligibleDelegate(person({ id: 'zuber', divisionId: NSDF }), ctx)).toBe(false);
    expect(isEligibleDelegate(person({ divisionId: NSDF, isActive: false }), ctx)).toBe(false);
  });
});
