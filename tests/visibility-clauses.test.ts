import { describe, expect, it } from 'vitest';

import {
  buildVisibilityClausesFrom,
  type CallerSummary,
} from '@/lib/visibility-rules';

/**
 * Clauses every caller gets before any role branch: owner, collaborator,
 * created, and @mentioned. Named so adding another base clause does
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
    (c) => 'divisionId' in c && typeof c.divisionId === 'object',
  ) as { divisionId?: { in?: string[] } } | undefined;
}

describe('buildVisibilityClausesFrom — base clauses', () => {
  it('always includes own, collaborated, and created tasks first', () => {
    const clauses = buildVisibilityClausesFrom(caller(), []);
    expect(clauses[0]).toEqual({ ownerId: 'me' });
    expect(clauses[1]).toEqual({ collaborators: { some: { userId: 'me' } } });
    expect(clauses[2]).toEqual({ createdById: 'me' });
  });

  it('the creator keeps sight of a task they created but assigned away', () => {
    const clauses = buildVisibilityClausesFrom(caller(), []);
    expect(clauses).toContainEqual({ createdById: 'me' });
  });

  it('no clause anywhere still mentions the removed visibility field', () => {
    // The personal/division split is gone (2026-09-17). A stray
    // `visibility` key would now be a Prisma error, not a filter.
    const variants: CallerSummary[] = [
      caller({ hierarchySlot: 'section_officer' }),
      caller({ hierarchySlot: 'aso' }),
      caller({ hierarchySlot: 'consultant' }),
      caller({ hierarchySlot: 'js' }),
      caller({ hierarchySlot: 'osd' }),
      caller({ isSuperAdmin: true }),
      caller({ isPmu: true, pmuId: 'div-pmu' }),
    ];
    for (const v of variants) {
      const clauses = buildVisibilityClausesFrom(v, [NSDF], ['me'], {
        pmuParentDivisionId: KI,
        pmuDivisionIds: [NSDF],
      });
      for (const c of clauses) expect('visibility' in c).toBe(false);
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
    expect(clauses).toContainEqual({ ownerId: { in: ['me'] } });
  });
});

describe('buildVisibilityClausesFrom — roles', () => {
  it('super admin and OSD see everything — one unfiltered clause', () => {
    for (const me of [caller({ isSuperAdmin: true }), caller({ hierarchySlot: 'osd' })]) {
      const clauses = buildVisibilityClausesFrom(me, []);
      expect(clauses).toHaveLength(BASE_CLAUSES + 1);
      // Prisma reads {} as "no filter", so this OR branch matches every task.
      expect(clauses[BASE_CLAUSES]).toEqual({});
    }
  });

  it('a ministry officer sees their own division', () => {
    const clauses = buildVisibilityClausesFrom(caller({ hierarchySlot: 'aso' }), []);
    expect(divisionClause(clauses)?.divisionId?.in).toEqual([KI]);
  });

  it('all division users see division tasks regardless of who created them', () => {
    // The clause filters on divisionId only — no ownerId or createdById
    // restriction, so Super Admin- or head-created tasks in the division are
    // visible to every division user.
    const clauses = buildVisibilityClausesFrom(caller({ hierarchySlot: 'section_officer' }), []);
    const clause = divisionClause(clauses);
    expect(clause).toBeDefined();
    expect(Object.keys(clause as object)).toEqual(['divisionId']);
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
    expect(clauses[BASE_CLAUSES]).toEqual({ jsPriorityLane: { not: null } });
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
    expect(clauses[BASE_CLAUSES]).toEqual({ ownerId: { in: team } });
    // Crucially, no bare divisionId clause that would leak the division board.
    expect(clauses.some((c) => 'divisionId' in c)).toBe(false);
  });

  it('a PMU delegate still gains the delegated division on top of their team', () => {
    const clauses = buildVisibilityClausesFrom(caller({ isPmu: true }), [NSDF], ['me']);
    // The delegated-division clause is still present…
    expect(divisionClause(clauses)?.divisionId?.in).toEqual([NSDF]);
    // …alongside the PMU-team owner clause.
    expect(clauses).toContainEqual({ ownerId: { in: ['me'] } });
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

  it('a PMU board folds into the officer’s own division clause', () => {
    const clauses = buildVisibilityClausesFrom(
      caller({ hierarchySlot: 'director', divisionId: KI }),
      [],
      [],
      { pmuDivisionIds: [KI_PMU] },
    );
    expect(divisionClause(clauses)?.divisionId?.in).toContain(KI_PMU);
  });

  it('a PMU member gains nothing — isolation is unaffected', () => {
    // The PMU branch returns before the officer branch, so a stray
    // pmuDivisionIds never hands one team another team's board.
    const clauses = buildVisibilityClausesFrom(
      caller({ isPmu: true, divisionId: KI }),
      [],
      ['me'],
      { pmuDivisionIds: ['div-other-pmu'] },
    );
    expect(clauses.some((c) => 'divisionId' in c)).toBe(false);
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
    expect(clauses).toContainEqual({ ownerId: { in: team } });
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

describe('buildVisibilityClausesFrom — a division task shown DOWN to its PMU', () => {
  const PMU = 'div-pmu';

  it('a PMU member sees the parent division tasks marked shared', () => {
    const clauses = buildVisibilityClausesFrom(
      caller({ isPmu: true, pmuId: PMU }),
      [],
      ['me'],
      { pmuParentDivisionId: NSDF },
    );
    expect(clauses).toContainEqual({
      sharedWithPmuTeam: true,
      divisionId: NSDF,
    });
  });

  it('is scoped to the PMU parent — never another division', () => {
    const clauses = buildVisibilityClausesFrom(
      caller({ isPmu: true, pmuId: PMU }),
      [],
      ['me'],
      { pmuParentDivisionId: NSDF },
    );
    const shared = clauses.filter((c) => 'sharedWithPmuTeam' in c) as {
      divisionId?: string;
    }[];
    // Exactly two: the PMU's own team share, and the parent division's.
    expect(shared.map((c) => c.divisionId).sort()).toEqual([NSDF, PMU].sort());
    expect(shared.some((c) => c.divisionId === KI)).toBe(false);
  });

  it('never opens the whole parent-division board, only shared tasks', () => {
    // The crux of PMU isolation: no bare { divisionId: parent } clause appears.
    const clauses = buildVisibilityClausesFrom(
      caller({ isPmu: true, pmuId: PMU }),
      [],
      ['me'],
      { pmuParentDivisionId: NSDF },
    );
    const unrestricted = clauses.filter(
      (c) => 'divisionId' in c && !('sharedWithPmuTeam' in c),
    );
    expect(unrestricted).toHaveLength(0);
  });

  it('emits nothing when the PMU has no parent division', () => {
    for (const opts of [{}, { pmuParentDivisionId: null }]) {
      const clauses = buildVisibilityClausesFrom(
        caller({ isPmu: true, pmuId: null }),
        [],
        ['me'],
        opts,
      );
      expect(clauses.some((c) => 'sharedWithPmuTeam' in c)).toBe(false);
    }
  });

  it('is never emitted for a non-PMU caller, whatever the opt says', () => {
    for (const me of [
      caller({ hierarchySlot: 'aso' }),
      caller({ isSuperAdmin: true }),
      caller({ hierarchySlot: 'osd' }),
      caller({ hierarchySlot: 'js' }),
    ]) {
      const clauses = buildVisibilityClausesFrom(me, [], [], {
        pmuParentDivisionId: NSDF,
      });
      expect(clauses.some((c) => 'sharedWithPmuTeam' in c)).toBe(false);
    }
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
    expect(clauses).toContainEqual({ ownerId: { in: ['me'] } });
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
