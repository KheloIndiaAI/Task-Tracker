import { describe, expect, it } from 'vitest';

import {
  allowedParentKinds,
  expandHeadedToDescendants,
  isStructuralKind,
  isTaskBoardKind,
  organizationOf,
  STRUCTURE_KINDS,
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
