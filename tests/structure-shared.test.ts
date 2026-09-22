import { describe, expect, it } from 'vitest';

import {
  allowedParentKinds,
  expandHeadedToDescendants,
  groupDivisionsByOrganization,
  isStructuralKind,
  isTaskBoardKind,
  organizationOf,
  STRUCTURE_KINDS,
  type NamedStructureNode,
  type StructureTreeNode,
} from '@/lib/structure-shared';

/**
 * A tree shaped like the real one after 2026-09-21:
 *
 *   HQ  (organization "Ministry Headquarter")
 *    ├─ KIS  (division)  ── COACH (sub_division) ── NIS_SEC (section)
 *    │        └─ KIS_PMU  (pmu, by pmu_parent_division_id)
 *    └─ NSDF (division)
 *             └─ NSDF_PMU (pmu)
 *
 *   RC  (organization "Regional Centre")
 *    ├─ DIR_N (directorate) ── KIC (division) ── KIC_PMU (pmu, parent_id only)
 *    │                      └─ STC (division)
 *    ├─ DIR_S (directorate) ── NCOE (division)
 *    └─ KISCE (division, directly under the organization)
 */
function node(
  id: string,
  kind: StructureTreeNode['kind'],
  parentId: string | null,
  pmuParentDivisionId: string | null = null,
): StructureTreeNode {
  return { id, kind, parentId, pmuParentDivisionId };
}

const TREE: StructureTreeNode[] = [
  node('HQ', 'organization', null),
  node('KIS', 'division', 'HQ'),
  node('COACH', 'sub_division', 'KIS'),
  node('NIS_SEC', 'section', 'COACH'),
  node('KIS_PMU', 'pmu', null, 'KIS'),
  node('NSDF', 'division', 'HQ'),
  node('NSDF_PMU', 'pmu', null, 'NSDF'),
  node('RC', 'organization', null),
  node('DIR_N', 'directorate', 'RC'),
  node('KIC', 'division', 'DIR_N'),
  node('KIC_PMU', 'pmu', 'KIC'),
  node('STC', 'division', 'DIR_N'),
  node('DIR_S', 'directorate', 'RC'),
  node('NCOE', 'division', 'DIR_S'),
  node('KISCE', 'division', 'RC'),
];

const sorted = (xs: string[]) => [...xs].sort();

describe('expandHeadedToDescendants — the cascade', () => {
  it('an organization head heads every division in it, directly under', () => {
    expect(sorted(expandHeadedToDescendants(['HQ'], TREE))).toEqual(sorted(['HQ', 'KIS', 'NSDF']));
  });

  it('reaches through directorates to the divisions beneath them', () => {
    expect(sorted(expandHeadedToDescendants(['RC'], TREE))).toEqual(
      sorted(['RC', 'KIC', 'STC', 'NCOE', 'KISCE']),
    );
  });

  it('a directorate head heads only that directorate’s divisions', () => {
    expect(sorted(expandHeadedToDescendants(['DIR_N'], TREE))).toEqual(
      sorted(['DIR_N', 'KIC', 'STC']),
    );
  });

  it('adds divisions only — never PMUs, sub-divisions or sections', () => {
    // An organization head reaches PMUs the way any division head does, via the
    // existing PMU rules; the cascade itself must not introduce a new path.
    const out = expandHeadedToDescendants(['HQ', 'RC'], TREE);
    for (const id of ['KIS_PMU', 'NSDF_PMU', 'KIC_PMU', 'COACH', 'NIS_SEC']) {
      expect(out).not.toContain(id);
    }
  });

  it('leaves an ordinary division head EXACTLY as they were', () => {
    // The guarantee that existing heads gain nothing from this change.
    expect(expandHeadedToDescendants(['KIS'], TREE)).toEqual(['KIS']);
    expect(expandHeadedToDescendants(['KIS', 'NSDF'], TREE)).toEqual(['KIS', 'NSDF']);
  });

  it('passes non-structural ids through untouched — PMU, sub-division, unknown', () => {
    expect(expandHeadedToDescendants(['KIS_PMU'], TREE)).toEqual(['KIS_PMU']);
    expect(expandHeadedToDescendants(['COACH'], TREE)).toEqual(['COACH']);
    expect(expandHeadedToDescendants(['nope'], TREE)).toEqual(['nope']);
    expect(expandHeadedToDescendants([], TREE)).toEqual([]);
  });

  it('merges a mix without duplicates', () => {
    expect(sorted(expandHeadedToDescendants(['KIC', 'DIR_N', 'DIR_S'], TREE))).toEqual(
      sorted(['KIC', 'DIR_N', 'STC', 'DIR_S', 'NCOE']),
    );
  });

  it('terminates on a corrupted, cyclic tree', () => {
    const cyclic: StructureTreeNode[] = [
      node('A', 'organization', 'B'),
      node('B', 'directorate', 'A'),
      node('D', 'division', 'B'),
    ];
    expect(sorted(expandHeadedToDescendants(['A'], cyclic))).toEqual(sorted(['A', 'D']));
  });
});

describe('organizationOf', () => {
  it('finds the organization of a division, directly or through a directorate', () => {
    expect(organizationOf('KIS', TREE)).toBe('HQ');
    expect(organizationOf('KIC', TREE)).toBe('RC');
    expect(organizationOf('KISCE', TREE)).toBe('RC');
  });

  it('walks up from a sub-division or section', () => {
    expect(organizationOf('COACH', TREE)).toBe('HQ');
    expect(organizationOf('NIS_SEC', TREE)).toBe('HQ');
  });

  it('follows a PMU by its PMU parent, falling back to parent_id', () => {
    expect(organizationOf('KIS_PMU', TREE)).toBe('HQ');
    expect(organizationOf('KIC_PMU', TREE)).toBe('RC');
  });

  it('an organization is its own organization', () => {
    expect(organizationOf('RC', TREE)).toBe('RC');
  });

  it('fails closed — null for an unknown id, a legacy root, or a cycle', () => {
    expect(organizationOf('nope', TREE)).toBeNull();
    expect(organizationOf('LEGACY', [node('LEGACY', 'division', null)])).toBeNull();
    const cyclic = [node('X', 'division', 'Y'), node('Y', 'directorate', 'X')];
    expect(organizationOf('X', cyclic)).toBeNull();
  });
});

describe('allowedParentKinds — the tree’s shape', () => {
  it('an organization is always a root', () => {
    expect(allowedParentKinds('organization')).toEqual([null]);
  });

  it('a directorate sits in an organization', () => {
    expect(allowedParentKinds('directorate')).toEqual(['organization']);
  });

  it('a division sits in an organization or a directorate — never at the root', () => {
    expect(allowedParentKinds('division')).toEqual(['organization', 'directorate']);
    expect(allowedParentKinds('division')).not.toContain(null);
  });

  it('keeps the original lower levels exactly as they were', () => {
    expect(allowedParentKinds('sub_division')).toEqual(['division']);
    expect(allowedParentKinds('section')).toEqual(['sub_division']);
  });
});

describe('kind predicates', () => {
  it('only a division or a PMU can hold a task', () => {
    const boards = STRUCTURE_KINDS.filter(isTaskBoardKind);
    expect(boards).toEqual(['division', 'pmu']);
  });

  it('only an organization or a directorate is structural', () => {
    const structural = STRUCTURE_KINDS.filter(isStructuralKind);
    expect(structural).toEqual(['organization', 'directorate']);
  });

  it('lists every kind in tree order, root first', () => {
    expect(STRUCTURE_KINDS).toEqual([
      'organization',
      'directorate',
      'division',
      'sub_division',
      'section',
      'pmu',
    ]);
  });
});

describe('groupDivisionsByOrganization — the user form pickers', () => {
  // The shape in production on 2026-09-22: the ministry, and SAI with two
  // regional centres that each run divisions of the SAME names. Input order is
  // what the pages pass: kind, then display order, then name.
  function named(
    id: string,
    name: string,
    kind: StructureTreeNode['kind'],
    parentId: string | null,
    pmuParentDivisionId: string | null = null,
  ): NamedStructureNode {
    return { id, name, kind, parentId, pmuParentDivisionId };
  }
  const ORGS: NamedStructureNode[] = [
    named('HQ', 'Ministry Headquarter', 'organization', null),
    named('SAI', 'SAI', 'organization', null),
    named('EMPTY', 'New organization', 'organization', null),
    named('RC_S', 'RC South', 'directorate', 'SAI'),
    named('RC_N', 'RC North', 'directorate', 'SAI'),
    named('NSDF', 'NSDF', 'division', 'HQ'),
    // RC North's division comes first here, so the test below proves groups
    // follow the directorates' order, not the order divisions turn up in.
    named('NCOE_N', 'NCOE', 'division', 'RC_N'),
    named('INFRA', 'Infrastructure', 'division', 'SAI'),
    named('NCOE_S', 'NCOE', 'division', 'RC_S'),
    named('KIS', 'Khelo India Scheme', 'division', 'HQ'),
    named('STC_N', 'STC', 'division', 'RC_N'),
    named('OPS', 'Operations', 'division', 'SAI'),
    named('KIS_SUB', 'Coaching', 'sub_division', 'KIS'),
    named('KIS_PMU', 'KIS_PMU', 'pmu', null, 'KIS'),
  ];

  const result = groupDivisionsByOrganization(ORGS);
  const byName = (name: string) => result.find((o) => o.organization?.name === name)!;
  const shape = (name: string) =>
    byName(name).groups.map((g) => ({
      under: g.path.map((p) => p.name),
      divisions: g.divisions.map((d) => d.id),
    }));

  it('lists every organization, in input order — even one with no divisions yet', () => {
    expect(result.map((o) => o.organization?.id)).toEqual(['HQ', 'SAI', 'EMPTY']);
    expect(byName('New organization')).toEqual({
      organization: { id: 'EMPTY', name: 'New organization' },
      groups: [],
      divisionCount: 0,
    });
  });

  it('keeps an organization without directorates to one flat group', () => {
    expect(shape('Ministry Headquarter')).toEqual([{ under: [], divisions: ['NSDF', 'KIS'] }]);
    expect(byName('Ministry Headquarter').divisionCount).toBe(2);
  });

  it('tells same-named divisions apart by the directorate they sit in', () => {
    // Direct divisions first, then the directorates in THEIR input order
    // (RC South before RC North), not in the order their divisions appeared.
    expect(shape('SAI')).toEqual([
      { under: [], divisions: ['INFRA', 'OPS'] },
      { under: ['RC South'], divisions: ['NCOE_S'] },
      { under: ['RC North'], divisions: ['NCOE_N', 'STC_N'] },
    ]);
    expect(byName('SAI').divisionCount).toBe(5);
  });

  it('groups only divisions — never sub-divisions, sections or PMUs', () => {
    const ids = result.flatMap((o) => o.groups.flatMap((g) => g.divisions.map((d) => d.id)));
    expect(ids).not.toContain('KIS_SUB');
    expect(ids).not.toContain('KIS_PMU');
    expect(sorted(ids)).toEqual(sorted(['NSDF', 'KIS', 'NCOE_S', 'INFRA', 'NCOE_N', 'STC_N', 'OPS']));
  });

  it('collects a division outside any organization, last, rather than dropping it', () => {
    const withLegacy = groupDivisionsByOrganization([
      ...ORGS,
      named('LEGACY', 'Legacy root', 'division', null),
      named('BROKEN', 'Broken chain', 'division', 'GONE'),
    ]);
    const last = withLegacy[withLegacy.length - 1];
    expect(last.organization).toBeNull();
    expect(last.groups.flatMap((g) => g.divisions.map((d) => d.id))).toEqual(['LEGACY', 'BROKEN']);
  });

  it('survives a cycle in the parent chain', () => {
    const cyclic = groupDivisionsByOrganization([
      named('A', 'Loop A', 'directorate', 'B'),
      named('B', 'Loop B', 'directorate', 'A'),
      named('D', 'Stuck', 'division', 'A'),
    ]);
    expect(cyclic).toHaveLength(1);
    expect(cyclic[0].organization).toBeNull();
    expect(cyclic[0].divisionCount).toBe(1);
  });
});
