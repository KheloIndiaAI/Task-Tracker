import { describe, expect, it } from 'vitest';

import {
  buildVisibilityClausesFrom,
  type CallerSummary,
} from '@/lib/visibility-rules';

/**
 * Clauses every caller gets before any role branch: owner, collaborator,
 * personal-created, and @mentioned. Named so adding another base clause does
 * not mean re-counting by hand in every role test below.
 */
const BASE_CLAUSES = 4;

const KI = 'div-ki';
const NSDF = 'div-nsdf';
const ABD = 'div-abd';

function caller(overrides: Partial<CallerSummary> = {}): CallerSummary {
  return {
    id: 'me',
    hierarchySlot: 'aso',
    isSuperAdmin: false,
    divisionId: KI,
    isPmu: false,
    pmuId: null,
    ...overrides,
  };
}

/** The division-scope clause pushed after the own/collaborator pair. */
function divisionClause(clauses: ReturnType<typeof buildVisibilityClausesFrom>) {
  return clauses.find(
    (c) => 'divisionId' in c && c.visibility === 'division',
  ) as { divisionId?: { in?: string[] } } | undefined;
}

/**
 * The ROLE-based personal clause, if the caller's role grants one. Skips the
 * base clauses, so the creator's own `{ createdById, personal }` clause is
 * never mistaken for a leadership grant.
 */
function personalRoleClause(clauses: ReturnType<typeof buildVisibilityClausesFrom>) {
  return clauses.slice(BASE_CLAUSES).find((c) => c.visibility === 'personal') as
    | { visibility?: string; divisionId?: { in?: string[] } }
    | undefined;
}

describe('buildVisibilityClausesFrom — base clauses', () => {
  it('always includes own, collaborated, and personal-created tasks first', () => {
    const clauses = buildVisibilityClausesFrom(caller(), []);
    expect(clauses[0]).toEqual({ ownerId: 'me' });
    expect(clauses[1]).toEqual({ collaborators: { some: { userId: 'me' } } });
    expect(clauses[2]).toEqual({ createdById: 'me', visibility: 'personal' });
  });

  it('the creator can see a personal task they created but assigned away', () => {
    // A Division Head / Super Admin who sets a task Personal and assigns it
    // to someone else keeps it in their own Personal list.
    const clauses = buildVisibilityClausesFrom(caller(), []);
    expect(clauses).toContainEqual({ createdById: 'me', visibility: 'personal' });
  });

  it('emits no role-based personal clause for non-leadership roles', () => {
    // Personal tasks reach these roles only via the base clauses (owner /
    // collaborator / creator / mentioned). Leadership is covered separately in
    // "personal-task visibility for leadership" below.
    const variants: CallerSummary[] = [
      caller({ hierarchySlot: 'section_officer' }),
      caller({ hierarchySlot: 'aso' }),
      caller({ hierarchySlot: 'consultant' }),
      caller({ isPmu: true }),
    ];
    for (const v of variants) {
      // No headship — headship grants personal reach on its own, whatever the slot.
      const clauses = buildVisibilityClausesFrom(v, []);
      for (const c of clauses.slice(BASE_CLAUSES)) {
        expect(c.visibility).toBe('division');
      }
    }
  });
});

describe('buildVisibilityClausesFrom — @mention grants sight', () => {
  const MENTION_CLAUSE = { comments: { some: { mentions: { has: 'me' } } } };

  it('is a base clause, so it reaches every role', () => {
    // Including the branches that return before the division clauses — a
    // mention has to work for a PMU member and a JS user too, or the
    // notification points at a task they cannot open.
    for (const me of [
      caller({ isSuperAdmin: true }),
      caller({ hierarchySlot: 'osd' }),
      caller({ hierarchySlot: 'js' }),
      caller({ hierarchySlot: 'director' }),
      caller({ hierarchySlot: 'aso' }),
      caller({ hierarchySlot: 'consultant' }),
      caller({ isPmu: true, pmuId: 'div-pmu' }),
    ]) {
      expect(buildVisibilityClausesFrom(me, [])).toContainEqual(MENTION_CLAUSE);
    }
  });

  it('matches the caller only — never a mention of someone else', () => {
    const clauses = buildVisibilityClausesFrom(caller({ id: 'me' }), []);
    const mention = clauses.find((c) => 'comments' in c) as
      | { comments?: { some?: { mentions?: { has?: string } } } }
      | undefined;
    expect(mention?.comments?.some?.mentions?.has).toBe('me');
  });

  it('does not widen anything else — it is scoped to the comments relation', () => {
    // The clause must not carry a bare visibility or divisionId, which would
    // hand over more than the one task the caller was named on.
    const clauses = buildVisibilityClausesFrom(caller(), []);
    const mention = clauses.find((c) => 'comments' in c) as Record<string, unknown>;
    expect(Object.keys(mention)).toEqual(['comments']);
  });
});

describe('buildVisibilityClausesFrom — multi-division membership', () => {
  it('an officer sees the full board of every member division (home + granted)', () => {
    // Home KI, granted an extra membership in NSDF — the membership-native
    // replacement for the retired cross-division view/allocation link.
    const clauses = buildVisibilityClausesFrom(
      caller({ hierarchySlot: 'aso', divisionId: KI }),
      [],
      [],
      { memberDivisionIds: [KI, NSDF] },
    );
    expect(divisionClause(clauses)?.divisionId?.in?.sort()).toEqual([KI, NSDF].sort());
  });

  it('unions member divisions with headed divisions', () => {
    // A head of ABD who is also granted membership in KI.
    const clauses = buildVisibilityClausesFrom(
      caller({ hierarchySlot: 'director', divisionId: ABD }),
      [ABD],
      [],
      { memberDivisionIds: [ABD, KI] },
    );
    expect(divisionClause(clauses)?.divisionId?.in?.sort()).toEqual([ABD, KI].sort());
  });

  it('defaults to the home division when no member set is given', () => {
    const clauses = buildVisibilityClausesFrom(caller({ hierarchySlot: 'aso' }), []);
    expect(divisionClause(clauses)?.divisionId?.in).toEqual([KI]);
  });

  it('a granted extra division widens the PMU branch without leaking the PMU home board', () => {
    // A PMU member granted membership in NSDF sees NSDF's board via the extra,
    // while their own ministry (home) division board stays hidden — PMU
    // isolation is preserved because only the EXTRA grants widen this branch.
    const clauses = buildVisibilityClausesFrom(
      caller({ isPmu: true, divisionId: KI }),
      [],
      ['me'],
      { memberDivisionIds: [KI, NSDF] },
    );
    // The extra (NSDF) board is visible…
    expect(divisionClause(clauses)?.divisionId?.in).toEqual([NSDF]);
    // …alongside the PMU-team owner clause, and the home (KI) board is NOT leaked.
    expect(clauses).toContainEqual({ visibility: 'division', ownerId: { in: ['me'] } });
  });
});

describe('buildVisibilityClausesFrom — roles', () => {
  it('super admin and OSD see everything, division-unfiltered, personal included', () => {
    for (const me of [caller({ isSuperAdmin: true }), caller({ hierarchySlot: 'osd' })]) {
      const clauses = buildVisibilityClausesFrom(me, []);
      expect(clauses).toHaveLength(BASE_CLAUSES + 2);
      expect(clauses[BASE_CLAUSES]).toEqual({ visibility: 'division' });
      expect(clauses[BASE_CLAUSES + 1]).toEqual({ visibility: 'personal' });
    }
  });

  it('a ministry officer sees their own division', () => {
    const clauses = buildVisibilityClausesFrom(caller({ hierarchySlot: 'aso' }), []);
    expect(divisionClause(clauses)?.divisionId?.in).toEqual([KI]);
  });

  it('all division users see division tasks regardless of who created them', () => {
    // The clause filters on divisionId + visibility only — no ownerId or
    // createdById restriction, so Super Admin- or head-created tasks in
    // the division are visible to every division user.
    const clauses = buildVisibilityClausesFrom(caller({ hierarchySlot: 'section_officer' }), []);
    const clause = divisionClause(clauses);
    expect(clause).toBeDefined();
    expect(Object.keys(clause as object).sort()).toEqual(['divisionId', 'visibility']);
  });

  it('a division head sees home plus every headed division', () => {
    // Zuber: home ABD, heads ABD + NSDF.
    const clauses = buildVisibilityClausesFrom(
      caller({ divisionId: ABD, hierarchySlot: 'deputy_secretary' }),
      [ABD, NSDF],
    );
    expect(divisionClause(clauses)?.divisionId?.in?.sort()).toEqual([ABD, NSDF].sort());
  });

  it('a delegate gains the delegated division for the window', () => {
    const clauses = buildVisibilityClausesFrom(caller({ divisionId: KI }), [NSDF]);
    expect(divisionClause(clauses)?.divisionId?.in?.sort()).toEqual([KI, NSDF].sort());
  });

  it('JS keeps the priority-board surface', () => {
    const clauses = buildVisibilityClausesFrom(caller({ hierarchySlot: 'js' }), []);
    expect(clauses[BASE_CLAUSES]).toEqual({
      visibility: 'division',
      jsPriorityLane: { not: null },
    });
    expect(clauses).toHaveLength(BASE_CLAUSES + 1);
  });

  it('a PMU member with no teammates loaded sees own + collaborated + created only', () => {
    const clauses = buildVisibilityClausesFrom(caller({ isPmu: true }), []);
    expect(clauses).toHaveLength(BASE_CLAUSES);
  });

  it("PMU members see their PMU team's tasks, never the whole division", () => {
    const team = ['me', 'mate-1', 'mate-2'];
    const clauses = buildVisibilityClausesFrom(caller({ isPmu: true }), [], team);
    // Base clauses + the owner-scoped PMU clause — no division clause.
    expect(clauses).toHaveLength(BASE_CLAUSES + 1);
    expect(clauses[BASE_CLAUSES]).toEqual({ visibility: 'division', ownerId: { in: team } });
    // Crucially, no bare divisionId clause that would leak the division board.
    expect(clauses.some((c) => 'divisionId' in c)).toBe(false);
  });

  it('a PMU delegate still gains the delegated division on top of their team', () => {
    const clauses = buildVisibilityClausesFrom(caller({ isPmu: true }), [NSDF], ['me']);
    // The delegated-division clause is still present…
    expect(divisionClause(clauses)?.divisionId?.in).toEqual([NSDF]);
    // …alongside the PMU-team owner clause.
    expect(clauses).toContainEqual({ visibility: 'division', ownerId: { in: ['me'] } });
  });
});

describe('buildVisibilityClausesFrom — personal-task visibility grant', () => {
  it('super admin and OSD read personal tasks by role, without the grant', () => {
    for (const me of [caller({ isSuperAdmin: true }), caller({ hierarchySlot: 'osd' })]) {
      // canSeePersonalTasks deliberately omitted — their access is role-based.
      expect(buildVisibilityClausesFrom(me, [])).toContainEqual({ visibility: 'personal' });
    }
  });

  it('the grant covers every member division', () => {
    const clauses = buildVisibilityClausesFrom(
      caller({ hierarchySlot: 'director', divisionId: KI }),
      [],
      [],
      { memberDivisionIds: [KI, NSDF], canSeePersonalTasks: true },
    );
    expect(personalRoleClause(clauses)?.divisionId?.in?.sort()).toEqual([KI, NSDF].sort());
  });

  it('the grant covers headed divisions alongside member ones', () => {
    const clauses = buildVisibilityClausesFrom(
      caller({ hierarchySlot: 'deputy_secretary', divisionId: ABD }),
      [NSDF],
      [],
      { memberDivisionIds: [ABD], canSeePersonalTasks: true },
    );
    expect(personalRoleClause(clauses)?.divisionId?.in?.sort()).toEqual([ABD, NSDF].sort());
  });

  it('works for any slot — the flag decides, not the rank', () => {
    // A Section Officer the Super Admin has explicitly granted it.
    const clauses = buildVisibilityClausesFrom(
      caller({ hierarchySlot: 'section_officer', divisionId: KI }),
      [],
      [],
      { canSeePersonalTasks: true },
    );
    expect(personalRoleClause(clauses)?.divisionId?.in).toEqual([KI]);
  });

  it('grants nothing without the flag, whatever the slot or headship', () => {
    // Turning the toggle off genuinely removes the access — there is no
    // slot-shaped hole left behind for leadership ranks.
    for (const me of [
      caller({ hierarchySlot: 'director' }),
      caller({ hierarchySlot: 'deputy_secretary' }),
      caller({ hierarchySlot: 'under_secretary' }),
      caller({ hierarchySlot: 'section_officer' }),
      caller({ hierarchySlot: 'aso' }),
      caller({ hierarchySlot: 'js' }),
      caller({ hierarchySlot: 'hmyas' }),
    ]) {
      expect(personalRoleClause(buildVisibilityClausesFrom(me, [NSDF]))).toBeUndefined();
    }
  });

  it('never lets a PMU member reach personal tasks, even with the flag set', () => {
    const clauses = buildVisibilityClausesFrom(
      caller({ isPmu: true, pmuId: 'div-pmu', hierarchySlot: 'director' }),
      [],
      ['me', 'mate-1'],
      { memberDivisionIds: [KI], canSeePersonalTasks: true },
    );
    // The PMU branch returns before the grant is considered — isolation wins.
    expect(personalRoleClause(clauses)).toBeUndefined();
  });

  it('never lets a JS user reach personal tasks, even with the flag set', () => {
    const clauses = buildVisibilityClausesFrom(
      caller({ hierarchySlot: 'js', divisionId: KI }),
      [],
      [],
      { canSeePersonalTasks: true },
    );
    // The JS branch also returns early; JS keeps its priority-board surface.
    expect(personalRoleClause(clauses)).toBeUndefined();
  });
});

describe('buildVisibilityClausesFrom — a division’s PMUs', () => {
  const KI_PMU = 'div-ki-pmu';

  it('an officer reads their division’s PMU board alongside their own', () => {
    const clauses = buildVisibilityClausesFrom(
      caller({ hierarchySlot: 'aso', divisionId: KI }),
      [],
      [],
      { pmuDivisionIds: [KI_PMU] },
    );
    expect(divisionClause(clauses)?.divisionId?.in?.sort()).toEqual([KI, KI_PMU].sort());
  });

  it('a head reads the PMUs of every division they head', () => {
    const clauses = buildVisibilityClausesFrom(
      caller({ hierarchySlot: 'director', divisionId: ABD }),
      [NSDF],
      [],
      { pmuDivisionIds: [KI_PMU] },
    );
    expect(divisionClause(clauses)?.divisionId?.in?.sort()).toEqual(
      [ABD, NSDF, KI_PMU].sort(),
    );
  });

  it('the personal grant reaches PMU members’ personal tasks', () => {
    // The point of the change: a PMU team's private work is visible to the
    // same division leadership as everyone else's in that division.
    const clauses = buildVisibilityClausesFrom(
      caller({ hierarchySlot: 'director', divisionId: KI }),
      [],
      [],
      { canSeePersonalTasks: true, pmuDivisionIds: [KI_PMU] },
    );
    expect(personalRoleClause(clauses)?.divisionId?.in?.sort()).toEqual([KI, KI_PMU].sort());
  });

  it('without the grant, a PMU board is visible but its personal tasks are not', () => {
    const clauses = buildVisibilityClausesFrom(
      caller({ hierarchySlot: 'director', divisionId: KI }),
      [],
      [],
      { pmuDivisionIds: [KI_PMU] },
    );
    expect(divisionClause(clauses)?.divisionId?.in).toContain(KI_PMU);
    expect(personalRoleClause(clauses)).toBeUndefined();
  });

  it('a PMU member gains nothing — isolation is unaffected', () => {
    // The PMU branch returns before the officer branch, so a stray
    // pmuDivisionIds never hands one team another team's board.
    const clauses = buildVisibilityClausesFrom(
      caller({ isPmu: true, divisionId: KI }),
      [],
      ['me'],
      { pmuDivisionIds: ['div-other-pmu'], canSeePersonalTasks: true },
    );
    expect(clauses.some((c) => 'divisionId' in c)).toBe(false);
    expect(personalRoleClause(clauses)).toBeUndefined();
  });

  it('is inert when the caller’s divisions have no PMU', () => {
    const clauses = buildVisibilityClausesFrom(
      caller({ hierarchySlot: 'aso', divisionId: KI }),
      [],
      [],
      { pmuDivisionIds: [] },
    );
    expect(divisionClause(clauses)?.divisionId?.in).toEqual([KI]);
  });
});

describe('buildVisibilityClausesFrom — PMU team leader read access', () => {
  it("adds an owner-scoped clause for the leader's team, division-only", () => {
    const team = ['leader', 'mate-1', 'mate-2'];
    const clauses = buildVisibilityClausesFrom(
      caller({ isPmu: true, id: 'leader' }),
      [],
      [],
      { pmuTeamLeaderMemberIds: team },
    );
    expect(clauses).toContainEqual({ visibility: 'division', ownerId: { in: team } });
    // It never surfaces a bare division board, so non-PMU ministry tasks stay hidden.
    expect(clauses.some((c) => 'divisionId' in c)).toBe(false);
  });

  it('is inert when the caller is not a team leader (empty list)', () => {
    const clauses = buildVisibilityClausesFrom(
      caller({ isPmu: true }),
      [],
      [],
      { pmuTeamLeaderMemberIds: [] },
    );
    expect(clauses).toHaveLength(BASE_CLAUSES);
  });
});

describe('buildVisibilityClausesFrom — PMU team share', () => {
  const PMU = 'div-pmu';

  it('a PMU member sees tasks shared with their PMU team', () => {
    const clauses = buildVisibilityClausesFrom(
      caller({ isPmu: true, pmuId: PMU }),
      [],
      ['me'],
    );
    expect(clauses).toContainEqual({
      visibility: 'division',
      sharedWithPmuTeam: true,
      divisionId: PMU,
    });
  });

  it("the PMU's home-division head is excluded from the team-share clause", () => {
    const clauses = buildVisibilityClausesFrom(
      caller({ isPmu: true, pmuId: PMU }),
      [],
      ['me'],
      { isPmuParentDivisionHead: true },
    );
    // The head still sees the task via the owner-scoped PMU clause, but it is
    // never surfaced to them as a whole-team share.
    expect(clauses.some((c) => 'sharedWithPmuTeam' in c)).toBe(false);
    expect(clauses).toContainEqual({ visibility: 'division', ownerId: { in: ['me'] } });
  });

  it('emits no team-share clause when the PMU id is unknown', () => {
    const clauses = buildVisibilityClausesFrom(
      caller({ isPmu: true, pmuId: null }),
      [],
      ['me'],
    );
    expect(clauses.some((c) => 'sharedWithPmuTeam' in c)).toBe(false);
  });

  it('never emits a team-share clause for non-PMU users', () => {
    for (const me of [
      caller({ hierarchySlot: 'aso', pmuId: PMU }),
      caller({ isSuperAdmin: true, pmuId: PMU }),
      caller({ hierarchySlot: 'osd', pmuId: PMU }),
      caller({ hierarchySlot: 'js', pmuId: PMU }),
    ]) {
      const clauses = buildVisibilityClausesFrom(me, []);
      expect(clauses.some((c) => 'sharedWithPmuTeam' in c)).toBe(false);
    }
  });
});
